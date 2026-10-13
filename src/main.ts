import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sfx, type SfxName } from './audio/audio';
import { BrowserInput, ScriptedInput, type InputSource, type InputState } from './core/input';
import { FixedLoop } from './core/loop';
import { debug, getFps, mountStats, statsFrame } from './dev/stats';
import { mountTuningPanel } from './dev/tuning';
import { GameWorld } from './game/session';
import type { StageEvents } from './game/stage';
import { CameraRig, type CameraPose } from './player/camera';
import { PlayerController } from './player/controller';
import { DebugFly } from './player/debugFly';
import { HEALTH, PlayerHealth } from './player/health';
import { SETTINGS } from './settings';
import { COMBAT_SMOKE_SCRIPT, SMOKE_SCRIPT } from './test/smokeScript';
import { toast } from './ui/toast';
import { Combat } from './weapons/combat';
import { fetchMapSource, onMapChanged } from './world/mapLoader';

const SIM_HZ = 120;
const DEG = Math.PI / 180;

const params = new URLSearchParams(location.search);
const smoke = params.get('test') === 'smoke';
const mapName = params.get('map') ?? 'test_course';

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x0b0d12);
scene.fog = new Fog(0x0b0d12, 20, 80);
scene.add(new HemisphereLight(0xdfe9ff, 0x20242c, 1.2));
const sun = new DirectionalLight(0xfff1e0, 1.4);
sun.position.set(-20, 40, 15);
scene.add(sun);

// Soft studio reflections for metals (world + viewmodel). Cheap: rendered once.
const envMap = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envMap;
scene.environmentIntensity = 0.2;

const camera = new PerspectiveCamera(SETTINGS.fov, innerWidth / innerHeight, 0.05, 500);

const overlay = document.getElementById('overlay')!;
let input: InputSource;
if (smoke) {
  overlay.classList.add('hidden');
  input = new ScriptedInput(mapName === 'arena_test' ? COMBAT_SMOKE_SCRIPT : SMOKE_SCRIPT);
} else {
  const browser = new BrowserInput(renderer.domElement, (locked) =>
    overlay.classList.toggle('hidden', locked),
  );
  overlay.addEventListener('click', () => {
    void browser.lock();
    sfx.unlock();
    sfx.prewarm();
  });
  input = browser;
}
const NO_INPUT: InputState = { down: new Set(), pressed: new Set(), released: new Set() };

// --- stage events → feedback ------------------------------------------------
let slowmoT = 0;
const stats = { encounters: 0, kills: 0, playerHits: 0, enemyShots: 0, deaths: 0 };
const stageEvents: StageEvents = {
  onEncounterStart() {
    stats.encounters++;
  },
  onWave() {},
  onEncounterCleared(_name, stageComplete) {
    slowmoT = 0.7; // last kill of the area: brief slow-mo
    toast(stageComplete ? 'ALL AREAS CLEARED — find the exit' : 'AREA CLEARED');
  },
  onCheckpoint() {
    toast('CHECKPOINT');
  },
  onStageEnd(seconds) {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1).padStart(4, '0');
    toast(`STAGE CLEAR  ${m}:${s}`);
  },
};

// The world must exist before the controller (it needs the colliders).
let world = await GameWorld.create(await fetchMapSource(mapName), stageEvents);
world.addTo(scene);
const player = new PlayerController(world.colliders);
const health = new PlayerHealth();
const rig = new CameraRig();
const fly = new DebugFly();
const combat = new Combat(scene);
let noclip = false;
let yaw = 0;
let pitch = 0;
spawnAt(world.stage.checkpoint.position, world.stage.checkpoint.yaw);

function spawnAt(pos: Vector3, viewYaw: number) {
  player.teleport(pos);
  yaw = viewYaw;
  pitch = 0;
  rig.reset();
  combat.weapons.refill();
}

/** Death → back to the last checkpoint with the in-progress encounter reset. */
function respawn() {
  world.stage.resetToCheckpoint();
  health.respawn();
  spawnAt(world.stage.checkpoint.position, world.stage.checkpoint.yaw);
}

/** Positional one-shot: distance attenuation + stereo pan relative to the view. */
function playAt(name: SfxName, pos: Vector3, volume = 1, pitchMul = 1) {
  const rel = pos.clone().sub(camera.position);
  const dist = rel.length();
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const pan = dist > 0.1 ? rel.dot(right) / dist : 0;
  sfx.play(name, { volume: volume / (1 + dist * 0.08), pan: pan * 0.8, pitch: pitchMul });
}

const pose: CameraPose = { eyeY: 0, roll: 0, pitchOffset: 0, fovDelta: 0 };
const eye = new Vector3();

const loop = new FixedLoop(1 / SIM_HZ, {
  step(dt) {
    input.advance?.(dt);
    const raw = input.sample();
    if (import.meta.env.DEV && raw.pressed.has('noclip')) toggleNoclip();
    if (noclip) {
      fly.step(dt, raw, yaw, pitch);
      return;
    }
    const state = health.dead ? NO_INPUT : raw;
    combat.preStep(state, player);
    player.step(dt, state, yaw);
    world.pushPlayerOut(player);
    rig.update(dt, player, yaw);
    const eyeNow = player.position.clone().setY(player.position.y + rig.current.eyeY);
    combat.step(dt, state, player, { pitch, yaw }, eyeNow, {
      colliders: world.colliders,
      surfaceAt: world.level.data.surfaceAt,
      targets: world.targets(),
    });
    if (combat.weapons.events.shots.length) world.enemies.hearGunfire(eyeNow);
    // Fold recovered recoil into the base view (invisible: punch drops by the same amount).
    pitch += combat.weapons.foldPitch * DEG;
    yaw -= combat.weapons.foldYaw * DEG;

    health.step(dt);
    const result = world.step(dt, player, eyeNow, !health.dead);
    for (const p of result.enemies.fired) {
      stats.enemyShots++;
      playAt('pistol_shot', p, 0.9, 0.62);
    }
    for (const p of result.enemies.charging) playAt('headshot', p, 0.35, 0.45);
    for (const d of result.enemies.deaths) {
      stats.kills++;
      playAt('kill', d.position, 1.2, 0.7);
      playAt('impact_metal', d.position, 1, 0.6);
      combat.impacts.spawn(d.position, new Vector3(0, 1, 0), 'target', new Vector3(0, -1, 0));
    }
    for (const hit of result.impacts) {
      if (hit.hitPlayer) {
        stats.playerHits++;
        if (health.damage(hit.damage, hit.from, player.position)) stats.deaths++;
        sfx.play('land', { volume: 0.7, pitch: 1.4 });
        rig.hurt(hit.from.clone().sub(player.position), yaw);
      } else {
        combat.impacts.spawn(hit.point, hit.normal, 'target', hit.normal.clone().negate());
        playAt('impact_concrete', hit.point, 0.4, 1.3);
      }
    }
    for (const dir of health.hitsThisStep) {
      const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      combat.hud.damageIndicator(Math.atan2(dir.dot(right), dir.dot(fwd)));
    }

    if (health.respawnDue || player.position.y < -30) respawn();
    if (smoke) smokeTrack();
  },
  render(alpha, frameDt) {
    // Slow-mo: snap down, ease back to real time.
    if (slowmoT > 0) {
      slowmoT -= frameDt;
      loop.timeScale = slowmoT > 0.25 ? 0.3 : 0.3 + (1 - 0.3) * (1 - slowmoT / 0.25);
      if (slowmoT <= 0) loop.timeScale = 1;
    }
    const look = health.dead ? { dx: 0, dy: 0 } : input.consumeLook();
    if (health.dead) input.consumeLook();
    sfx.setVolume(SETTINGS.volume);
    const radPerPx = SETTINGS.sensitivity * 0.022 * DEG * combat.sensitivityMul(SETTINGS.fov);
    yaw -= look.dx * radPerPx;
    pitch = Math.max(
      -89 * DEG,
      Math.min(89 * DEG, pitch - look.dy * radPerPx * (SETTINGS.invertY ? -1 : 1)),
    );

    let fov = SETTINGS.fov;
    if (noclip) {
      eye.lerpVectors(fly.prevPosition, fly.position, alpha);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      rig.pose(alpha, pose);
      eye.lerpVectors(player.prevPosition, player.position, alpha);
      // Death cam: slump to the floor and roll over.
      const dk = health.dead ? Math.min(1, health.deadT / (HEALTH.deathTime * 0.6)) : 0;
      const slump = dk * dk * (3 - 2 * dk);
      eye.y += pose.eyeY * (1 - slump * 0.8);
      const shake = combat.viewmodel.cameraShake;
      camera.rotation.set(
        pitch + combat.punchPitch + (pose.pitchOffset + shake.x) * DEG,
        yaw - combat.punchYaw + shake.y * DEG,
        (pose.roll + shake.z) * DEG + slump * 1.1,
        'YXZ',
      );
      fov = (fov + pose.fovDelta) / combat.fovDivisor;
    }
    camera.position.copy(eye);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    world.enemies.updateDebris(frameDt * loop.timeScale);
    combat.hud.setDamageVignette(health.dead ? 1 : Math.max(0, 1 - health.fraction / 0.7));

    debug('state', noclip ? 'noclip' : player.state);
    debug('speed', player.horizontalSpeed);
    debug('hp', Math.round(health.hp));
    debug('enemies', world.enemies.list.length);
    debug(
      'pos',
      eye
        .toArray()
        .map((v) => v.toFixed(1))
        .join(' '),
    );
    renderer.clear();
    renderer.render(scene, camera);
    if (!noclip && !health.dead) {
      camera.updateMatrixWorld();
      combat.render(frameDt, camera, player, look, yaw);
      renderer.clearDepth();
      renderer.render(combat.viewmodel.scene, combat.viewmodel.camera);
    }
    statsFrame(frameDt);
    if (smoke) reportSmoke(frameDt);
  },
});

function toggleNoclip() {
  noclip = !noclip;
  if (noclip) {
    fly.position.copy(player.position).setY(player.position.y + rig.current.eyeY);
    fly.prevPosition.copy(fly.position);
  } else {
    player.teleport(fly.position.clone().setY(fly.position.y - 1.6));
  }
  toast(noclip ? 'noclip ON (V)' : 'noclip OFF');
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  combat.viewmodel.setAspect(camera.aspect);
});
combat.viewmodel.setAspect(camera.aspect);
combat.viewmodel.scene.environment = envMap;

/** Hot reload: rebuild the world in place (enemies/encounters restart), keep the player's pose. */
onMapChanged(async (name) => {
  if (name !== mapName) return;
  try {
    const next = await GameWorld.create(await fetchMapSource(name), stageEvents);
    world.dispose();
    world = next;
    world.addTo(scene);
    player.setCollider(world.colliders);
    const warn = world.level.data.warnings.length
      ? `  (${world.level.data.warnings.length} warnings, see console)`
      : '';
    toast(`map reloaded: ${name}${warn}`);
  } catch (err) {
    console.error(err);
    toast(`map "${name}" failed to load:\n${(err as Error).message}`, 'error');
  }
});

mountStats();
if (import.meta.env.DEV) void mountTuningPanel();
loop.start();

// ---------------------------------------------------------------------------
// Smoke test support (?test=smoke): track what happened, report checks to scripts/smoke.mjs.

const statesSeen = new Set<string>();
let maxSpeed = 0;
let maxEnemies = 0;
let smokeFrames = 0;
let smokeTime = 0;

function smokeTrack() {
  statesSeen.add(player.state);
  maxSpeed = Math.max(maxSpeed, player.horizontalSpeed);
  maxEnemies = Math.max(maxEnemies, world.enemies.list.length);
}

function reportSmoke(frameDt: number) {
  smokeFrames++;
  smokeTime += frameDt;
  const scripted = input as ScriptedInput;
  const checks: Record<string, boolean> =
    mapName === 'arena_test'
      ? {
          encounterStarted: stats.encounters > 0,
          enemiesSpawned: maxEnemies >= 3,
          enemiesFired: stats.enemyShots > 0,
          playerFired: combat.shotsFired > 3,
        }
      : {
          sprinted: statesSeen.has('sprint'),
          slid: statesSeen.has('slide'),
          jumped: statesSeen.has('air'),
          fastSlide: maxSpeed > 9,
          fired: combat.shotsFired > 3,
          reloaded: combat.reloads > 0,
        };
  const report = {
    done: scripted.done,
    t: scripted.elapsed,
    frames: smokeFrames,
    avgFps: smokeFrames / Math.max(smokeTime, 1e-6),
    fps: getFps(),
    states: [...statesSeen],
    maxSpeed,
    shots: combat.shotsFired,
    stats,
    /** Each must be true or the smoke test fails. */
    checks,
  };
  if (scripted.done && !noclip) {
    // Fixed vantage for the screenshot so visual changes are comparable run to run.
    noclip = true;
    if (mapName === 'arena_test') {
      fly.position.set(0, 14, -20);
      pitch = -0.6;
    } else {
      fly.position.set(0, 16, 16);
      pitch = -0.5;
    }
    fly.prevPosition.copy(fly.position);
    yaw = 0;
  }
  (window as unknown as { __smoke: unknown }).__smoke = report;
}
