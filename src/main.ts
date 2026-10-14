import {
  DirectionalLight,
  Euler,
  FogExp2,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sfx, type SfxName } from './audio/audio';
import { SYNTHS } from './audio/synth';
import { BrowserInput, ScriptedInput, type InputSource, type InputState } from './core/input';
import { FixedLoop } from './core/loop';
import { debug, getFps, mountStats, statsFrame } from './dev/stats';
import { defineTunables, mountTuningPanel } from './dev/tuning';
import { updateCorruptionUniforms } from './fx/corruption';
import { Embers } from './fx/embers';
import { Gore } from './fx/gore';
import { RenderPipeline } from './render/pipeline';
import {
  applyShaderDetail,
  initialAutoQuality,
  QualityGovernor,
  TIER_NAMES,
  type Quality,
  type Tier,
} from './render/quality';
import { GameWorld } from './game/session';
import type { StageEvents } from './game/stage';
import { CameraRig, type CameraPose } from './player/camera';
import { PlayerController } from './player/controller';
import { DebugFly } from './player/debugFly';
import { HEALTH, PlayerHealth } from './player/health';
import { SETTINGS } from './settings';
import { SMOKE_RUNS } from './test/smokeScript';
import { showStageClear } from './ui/stageClear';
import { toast } from './ui/toast';
import { Combat } from './weapons/combat';
import { Backdrop, backdropOptionsFor } from './world/backdrop';
import { fetchMapSource, onMapChanged } from './world/mapLoader';
import { updateSurfaceUniforms } from './world/materials';

const SIM_HZ = 120;
const DEG = Math.PI / 180;

const params = new URLSearchParams(location.search);
const smoke = params.get('test') === 'smoke';
/** `?shot=x,y,z,yawDeg,pitchDeg`: fixed free camera, no input/HUD — for scripts/shots.mjs stills. */
const shot = params.get('shot')?.split(',').map(Number) ?? null;
const mapName = params.get('map') ?? 'stage1';
const smokeRun = SMOKE_RUNS[mapName] ?? SMOKE_RUNS.default;

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Smoke runs on SwiftShader (CPU): half resolution keeps it fast enough; screenshots stay readable.
const basePixelRatio = smoke ? 0.5 : Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(basePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.autoClear = false;
// Shadows only from the key light, rendered once per level load (static world).
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
document.body.appendChild(renderer.domElement);

// Ember Noir two-light rule: cold human fill vs a red key from the hell-spire side.
const LIGHT = defineTunables(
  'look: lighting',
  { fill: 0.7, key: 1.3, env: 0.2, fogDensity: 0.016, vmEnv: 0.35 },
  {
    fill: [0, 3, 0.01],
    key: [0, 5, 0.01],
    env: [0, 2, 0.01],
    fogDensity: [0, 0.08, 0.0005],
    vmEnv: [0, 2, 0.01],
  },
);
const FOG_COLOR = 0x1a0e0e;
const scene = new Scene();
scene.fog = new FogExp2(FOG_COLOR, LIGHT.fogDensity);
const fill = new HemisphereLight(0xa9bccf, 0x1a1615, LIGHT.fill);
scene.add(fill);
const key = new DirectionalLight(0xff3d1c, LIGHT.key);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const embers = new Embers();
scene.add(embers.points);

const camera = new PerspectiveCamera(SETTINGS.fov, innerWidth / innerHeight, 0.05, 400);
const pmrem = new PMREMGenerator(renderer);
const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
let backdrop!: Backdrop;
let cityEnv: Texture | null = null;
let corruption = 0.5;
let pipeline!: RenderPipeline; // created once the viewmodel exists

const overlay = document.getElementById('overlay')!;
// Map links on the start screen navigate instead of grabbing the mouse; highlight the current map.
overlay.querySelectorAll<HTMLAnchorElement>('a[data-map]').forEach((a) => {
  a.classList.toggle('current', a.dataset.map === mapName);
  a.addEventListener('click', (e) => e.stopPropagation());
});
let input: InputSource;
if (shot) {
  overlay.classList.add('hidden');
  input = new ScriptedInput([{ t: 0 }]);
} else if (smoke) {
  overlay.classList.add('hidden');
  input = new ScriptedInput(smokeRun.script);
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
const stats = { encounters: 0, kills: 0, playerHits: 0, blocked: 0, enemyShots: 0, deaths: 0 };
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
  onMessage(text) {
    toast(text.replace(/\\n/g, '\n'));
  },
  onSound(name, position, volume) {
    if (name in SYNTHS) playAt(name as SfxName, position, volume);
  },
  onStageEnd(seconds) {
    if (smoke || shot) return;
    showStageClear({
      title: world.level.data.worldProps.message ?? mapName.toUpperCase(),
      seconds,
      kills: stats.kills,
      deaths: stats.deaths,
      shots: combat.shotsFired,
      hits: combat.hits,
      blocked: stats.blocked,
    });
  },
};

// The world must exist before the controller (it needs the colliders).
let world = await GameWorld.create(await fetchMapSource(mapName), stageEvents);
world.addTo(scene);
setupAtmosphere();
const player = new PlayerController(world.colliders);
const health = new PlayerHealth();
const rig = new CameraRig();
const fly = new DebugFly();
const combat = new Combat(scene);
const gore = new Gore();
scene.add(gore.root);
combat.gore = gore;
pipeline = new RenderPipeline(
  renderer,
  {
    backdrop,
    world: { scene, camera },
    viewmodel: combat.viewmodel,
  },
  { lowQuality: smoke },
);

// --- graphics quality: auto governor (default) or manual (settings / ?quality=1..3) ---------------
const urlQuality = Number(params.get('quality') ?? 0);
const governor = new QualityGovernor(initialAutoQuality(renderer));
let applied: Quality | null = null;
/** What quality should be in effect right now. Tests/stills always render at full quality. */
function wantedQuality(): Quality {
  if (smoke || shot) return { tier: 3, scale: 1 };
  const manual = urlQuality || SETTINGS.quality;
  if (manual) return { tier: Math.min(3, Math.max(1, manual)) as Tier, scale: SETTINGS.renderScale };
  return governor.q;
}
function applyQuality(q: Quality) {
  if (applied && applied.tier === q.tier && applied.scale === q.scale) return;
  applied = { ...q };
  pipeline.tier = q.tier;
  renderer.setPixelRatio(basePixelRatio * q.scale);
  pipeline.setSize(innerWidth, innerHeight);
  applyShaderDetail([scene, backdrop.scene, combat.viewmodel.scene], q.tier === 1 ? 1 : 4);
}
function updateQuality(frameDt: number) {
  const auto = !(smoke || shot || urlQuality || SETTINGS.quality);
  if (auto && !noclip) {
    const lowered = governor.frame(frameDt);
    if (lowered)
      toast(
        `GRAPHICS → ${TIER_NAMES[lowered.tier].toUpperCase()} ${Math.round(lowered.scale * 100)}% (low frame rate)\nsettings › quality to override`,
      );
  }
  applyQuality(wantedQuality());
  debug('gfx', `${TIER_NAMES[applied!.tier]} ${Math.round(applied!.scale * 100)}%${auto ? ' auto' : ''}`);
}

/** Backdrop, environment reflections, key light and fog for the loaded level (load + hot reload). */
function setupAtmosphere() {
  const bounds = world.level.data.collision.boundingBox!;
  const opts = backdropOptionsFor(world.level.data.worldProps, bounds, FOG_COLOR);
  backdrop?.dispose();
  backdrop = new Backdrop(opts);
  corruption = opts.corruption;
  cityEnv?.dispose();
  cityEnv = null;
  if (opts.mode === 'city') {
    // Reflections of the burning skyline (wet floors, metal) instead of a neutral studio.
    cityEnv = pmrem.fromScene(backdrop.scene, 0.02, 1, 9000, {
      position: opts.center.clone().setY(bounds.max.y),
    }).texture;
  }
  scene.environment = cityEnv ?? studioEnv;
  // Low red "sun" from the spire side; ortho shadow frustum fitted to the level.
  const span = opts.radius * 1.15;
  key.position.copy(opts.center).addScaledVector(opts.spireDir, span * 1.6).setY(opts.center.y + span * 0.55);
  key.target.position.copy(opts.center);
  key.target.updateMatrixWorld();
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -span;
  sc.right = sc.top = span;
  sc.near = 1;
  sc.far = span * 4;
  sc.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
  if (pipeline) pipeline.setBackdrop(backdrop.scene, backdrop.camera);
}
let noclip = false;
let yaw = 0;
let pitch = 0;
spawnAt(world.stage.checkpoint.position, world.stage.checkpoint.yaw);
if (shot) {
  noclip = true;
  fly.position.set(shot[0], shot[1], shot[2]);
  fly.prevPosition.copy(fly.position);
  yaw = (shot[3] ?? 0) * DEG;
  pitch = (shot[4] ?? 0) * DEG;
  // &enc=x,y,z: park the (invisible) player there, e.g. in an encounter trigger, to get enemies in shot
  const enc = params.get('enc')?.split(',').map(Number);
  if (enc?.length === 3) player.teleport(new Vector3(enc[0], enc[1], enc[2]));
}
let shotFrames = 0;
/** &track=<m>: shot camera follows the nearest enemy from the player's side at that distance. */
const shotTrack = shot ? Number(params.get('track') ?? 0) : 0;
const shotTrackKind = params.get('trackKind');
function trackNearestEnemy(dist: number) {
  let best: { position: Vector3 } | null = null;
  let bestD = Infinity;
  for (const e of world.enemies.list) {
    if (shotTrackKind && e.kind !== shotTrackKind) continue;
    const d = e.position.distanceTo(player.position);
    if (d < bestD) [best, bestD] = [e, d];
  }
  if (!best) return;
  const target = best.position.clone();
  if (shotTrackKind === 'possessed') target.y += 1.2;
  else if (shotTrackKind === 'hound') target.y += 0.6;
  const from = player.position.clone().setY(player.position.y + 1.6).sub(target).normalize();
  fly.position.copy(target).addScaledVector(from, dist).add(new Vector3(0.6, 0.35, 0));
  fly.prevPosition.copy(fly.position);
  const d = target.clone().sub(fly.position);
  yaw = Math.atan2(-d.x, -d.z);
  pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}

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
      if (!shot) return; // shot stills keep the world (enemies, encounters) running
    }
    const state = health.dead || shot ? NO_INPUT : raw;
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
    for (const f of result.enemies.fired) {
      stats.enemyShots++;
      if (f.kind === 'grunt') playAt('pistol_shot', f.position, 0.9, 0.62);
      else playAt('fireball', f.position, 0.9, 0.9 + Math.random() * 0.2);
    }
    for (const c of result.enemies.charging) {
      if (c.kind === 'drone') playAt('demon_screech', c.position, 0.7, 0.9 + Math.random() * 0.2);
      else if (c.kind === 'possessed') playAt('possessed_shriek', c.position, 0.9, 0.85 + Math.random() * 0.3);
      else if (c.kind === 'hound') playAt('hound_snarl', c.position, 1, 0.9 + Math.random() * 0.2);
      else playAt('headshot', c.position, 0.35, 0.45);
    }
    for (const a of result.enemies.alerts)
      if (a.kind !== 'grunt') playAt('demon_growl', a.position, 0.8, a.kind === 'hound' ? 1.3 : 0.8 + Math.random() * 0.3);
    for (const d of result.enemies.deaths) {
      stats.kills++;
      playAt('kill', d.position, 1.2, 0.7);
      if (d.kind === 'grunt') {
        playAt('impact_metal', d.position, 1, 0.6);
        combat.impacts.spawn(d.position, new Vector3(0, 1, 0), 'target', new Vector3(0, -1, 0));
      } else {
        playAt('demon_death', d.position, 1, d.kind === 'hound' ? 1.25 : d.kind === 'drone' ? 0.75 : 1);
        playAt('gore_splat', d.position, 1);
        gore.burst(d.position, world.colliders, d.size);
      }
    }
    const viewDir = new Vector3(0, 0, -1).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
    /** Damage to the player from `from` (shield first); returns true when something got through. */
    const hurtPlayer = (hit: { point: Vector3; normal: Vector3; damage: number; from: Vector3 }) => {
      stats.playerHits++;
      const dmg = combat.tryBlock(hit, eyeNow, viewDir);
      if (dmg <= 0) {
        stats.blocked++;
        return false;
      }
      if (!shot && health.damage(dmg, hit.from, player.position)) stats.deaths++;
      sfx.play('land', { volume: 0.7, pitch: 1.4 });
      rig.hurt(hit.from.clone().sub(player.position), yaw);
      return true;
    };
    for (const hit of result.impacts) {
      if (hit.hitPlayer) hurtPlayer(hit);
      else {
        combat.impacts.spawn(hit.point, hit.normal, 'target', hit.normal.clone().negate());
        playAt('fire_impact', hit.point, 0.5, 0.9 + Math.random() * 0.2);
      }
    }
    for (const a of result.enemies.attacks) {
      const toAttacker = a.from.clone().sub(eyeNow).normalize();
      const through = hurtPlayer({ point: eyeNow, normal: toAttacker, damage: a.damage, from: a.from });
      sfx.play(through ? 'melee_hit' : 'shield_block', { volume: 0.9, pitch: 0.8 });
      if (a.knock) {
        // the shield takes most of the shove too
        const k = through ? 1 : 0.35;
        player.velocity.x += a.knock.x * k;
        player.velocity.z += a.knock.z * k;
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
    if (shotTrack > 0) trackNearestEnemy(shotTrack);
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
    world.enemies.updateDebris(frameDt * loop.timeScale, {
      trail: (p) => gore.trail(p),
      land: (p) => gore.land(p, world.colliders),
    });
    gore.update(frameDt * loop.timeScale);
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
    const time = performance.now() / 1000;
    camera.updateMatrixWorld();
    fill.intensity = LIGHT.fill;
    key.intensity = LIGHT.key;
    scene.environmentIntensity = LIGHT.env;
    combat.viewmodel.scene.environmentIntensity = LIGHT.vmEnv;
    (scene.fog as FogExp2).density = LIGHT.fogDensity;
    updateSurfaceUniforms(time);
    updateCorruptionUniforms(time);
    embers.update(time, camera.position, corruption);
    backdrop.update(time, camera);
    const showVm = !noclip && !health.dead;
    if (showVm) combat.render(frameDt, camera, player, look, yaw);
    pipeline.showViewmodel = showVm;
    pipeline.damage = health.dead ? 1 : Math.max(0, 1 - health.fraction / 0.7);
    updateQuality(frameDt);
    pipeline.render(frameDt);
    statsFrame(frameDt);
    if (smoke) reportSmoke(frameDt);
    if (shot) (window as unknown as { __shot: unknown }).__shot = { frames: ++shotFrames };
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
  pipeline.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  combat.viewmodel.setAspect(camera.aspect);
});
combat.viewmodel.setAspect(camera.aspect);
combat.viewmodel.scene.environment = studioEnv;

/** Hot reload: rebuild the world in place (enemies/encounters restart), keep the player's pose. */
onMapChanged(async (name) => {
  if (name !== mapName) return;
  try {
    const next = await GameWorld.create(await fetchMapSource(name), stageEvents);
    world.dispose();
    gore.clear();
    world = next;
    world.addTo(scene);
    setupAtmosphere();
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
// Available in published builds too: players can set sensitivity/FOV and testers can tweak feel.
void mountTuningPanel();
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
  const checks = smokeRun.checks({
    states: statesSeen,
    maxSpeed,
    maxEnemies,
    encounters: stats.encounters,
    enemyShots: stats.enemyShots,
    shots: combat.shotsFired,
    reloads: combat.reloads,
    melees: combat.melees,
    shieldRaises: combat.shieldRaises,
  });
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
    const v = smokeRun.overview;
    fly.position.set(...v.pos);
    yaw = v.yaw;
    pitch = v.pitch;
    fly.prevPosition.copy(fly.position);
  }
  (window as unknown as { __smoke: unknown }).__smoke = report;
}
