import { Euler, PerspectiveCamera, PointLight, Scene, Vector3 } from 'three';
import { sfx } from '../audio/audio';
import type { InputState } from '../core/input';
import { Impacts, type ImpactKind } from '../fx/impacts';
import { Tracers } from '../fx/tracers';
import { MOVE, type PlayerController } from '../player/controller';
import type { Colliders } from '../player/collision';
import { SETTINGS } from '../settings';
import { Hud } from '../ui/hud';
import { LOADOUT } from './defs';
import { traceBullet, type Hittable } from './hitscan';
import { ViewModel } from './viewmodel';
import { WeaponSystem } from './weapon';

const DEG = Math.PI / 180;
const METAL_SURFACES = new Set(['metal', 'black']);

export interface CombatWorld {
  colliders: Colliders;
  surfaceAt: (faceA: number) => string;
  targets: Hittable[];
}

/**
 * Glue between the player, weapons, viewmodel, hitscan, FX, HUD and audio.
 * `step` runs in the fixed sim; `render` once per frame.
 */
export class Combat {
  readonly weapons = new WeaponSystem(LOADOUT, (Math.random() * 1e9) | 0);
  readonly viewmodel = new ViewModel(LOADOUT);
  readonly hud = new Hud();
  readonly tracers = new Tracers();
  readonly impacts = new Impacts();
  /** World-space muzzle flash light (always in the scene; intensity pulses — no shader recompiles). */
  private readonly muzzleLight = new PointLight(0xffa64a, 0, 8, 2);
  private readonly muzzleWorld = new Vector3();
  private footstepDist = 0;
  shotsFired = 0;
  reloads = 0;
  hits = 0;

  constructor(scene: Scene) {
    scene.add(this.tracers.root, this.impacts.root, this.muzzleLight);
  }

  /** Aim punch in radians (add pitch, subtract yaw) for the view. */
  get punchPitch() {
    return this.weapons.punchPitch.value * DEG;
  }
  get punchYaw() {
    return this.weapons.punchYaw.value * DEG;
  }

  /**
   * One sim step. Mutates the player's sprint/speed modifiers before it steps (call before
   * `player.step`) via `preStep`, then `step` after. Returns the recoil to fold into the base view.
   */
  preStep(input: InputState, player: PlayerController) {
    player.sprintBlocked = this.weapons.wantsSprintBlocked(input);
    const s = this.weapons.stats;
    player.speedMul = 1 + (s.adsMoveMul - 1) * this.weapons.ads;
  }

  step(
    dt: number,
    input: InputState,
    player: PlayerController,
    view: { pitch: number; yaw: number },
    eye: Vector3,
    world: CombatWorld,
  ) {
    const ws = this.weapons;
    ws.step(dt, input, {
      sprint: player.sprint,
      grounded: player.grounded,
      mantling: !!player.mantle,
      moveFactor: player.horizontalSpeed / MOVE.walkSpeed,
    });
    const ev = ws.events;

    for (const shot of ev.shots) {
      this.shotsFired++;
      const dir = new Vector3(0, 0, -1).applyEuler(
        new Euler(
          view.pitch + this.punchPitch + shot.spreadPitch * DEG,
          view.yaw - this.punchYaw - shot.spreadYaw * DEG,
          0,
          'YXZ',
        ),
      );
      const s = ws.stats;
      const hit = traceBullet(world.colliders, world.surfaceAt, world.targets, eye, dir, s.range);
      const end = hit ? hit.point : eye.clone().addScaledVector(dir, s.range);
      this.tracers.spawn(this.muzzleWorld, end);
      this.viewmodel.onFire(ws.def, ws.ads);
      sfx.play(ws.def.sfx, { volume: 0.9 });
      if (!hit) continue;
      if (hit.target) {
        const head = hit.part === 'head';
        const killed = hit.target.damage(
          ws.damageAt(hit.distance, head),
          hit.part!,
          hit.point,
          dir,
        );
        this.hits++;
        this.hud.hitmarker(killed ? 'kill' : head ? 'head' : 'hit');
        sfx.play(killed ? 'kill' : head ? 'headshot' : 'hitmarker', { volume: 0.8 });
        this.impacts.spawn(hit.point, hit.normal, 'target', dir);
      } else {
        const kind: ImpactKind = METAL_SURFACES.has(hit.surface ?? '') ? 'metal' : 'concrete';
        this.impacts.spawn(hit.point, hit.normal, kind, dir);
        // Distant impacts are quieter; keeps full-auto from turning into noise.
        const vol = Math.max(0.15, 0.6 - hit.distance / 80);
        sfx.play(kind === 'metal' ? 'impact_metal' : 'impact_concrete', { volume: vol });
      }
    }
    if (ev.dryFire) sfx.play('dry_fire');
    if (ev.reloadStarted) this.reloads++;
    if (ev.magOut) sfx.play('reload_out', { volume: 0.7 });
    if (ev.magIn) {
      sfx.play('reload_in', { volume: 0.7 });
      this.viewmodel.onMagIn();
    }
    if (ev.chamber) {
      sfx.play('reload_chamber', { volume: 0.7 });
      this.viewmodel.onChamber();
    }
    if (ev.swapStarted) sfx.play('swap', { volume: 0.6 });

    // Movement sounds live here too: it's the one place that already hears every player event.
    if (player.jumped) sfx.play('jump', { volume: 0.5 });
    if (player.landedSpeed > 3) sfx.play('land', { volume: Math.min(1, player.landedSpeed / 12) });
    if (player.slideStarted) sfx.play('slide', { volume: 0.7 });
    if (player.mantleStarted) sfx.play('mantle', { volume: 0.7 });
    if (player.grounded && player.posture !== 'slide') {
      this.footstepDist += player.horizontalSpeed * dt;
      const stride = player.sprint ? 2.6 : 2.1;
      if (this.footstepDist > stride) {
        this.footstepDist = 0;
        sfx.play('footstep', { volume: player.posture === 'crouch' ? 0.15 : 0.35 });
      }
    }
  }

  /** Per frame: viewmodel, FX, HUD. `camera` is the world camera (already posed). */
  render(
    frameDt: number,
    camera: PerspectiveCamera,
    player: PlayerController,
    look: { dx: number; dy: number },
    yaw: number,
  ) {
    const ws = this.weapons;
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.viewmodel.update(frameDt, {
      weapons: ws,
      lookDx: look.dx,
      lookDy: look.dy,
      speed: player.horizontalSpeed,
      lateral: player.velocity.dot(right),
      grounded: player.grounded,
      sprint: player.sprint,
      sliding: player.posture === 'slide',
      mantling: !!player.mantle,
      landedSpeed: player.landedSpeed,
    });
    // Muzzle: viewmodel-camera space → world (FOVs differ, close enough for tracer origins).
    this.muzzleWorld.copy(this.viewmodel.muzzleView);
    camera.localToWorld(this.muzzleWorld);
    this.muzzleLight.position.copy(this.muzzleWorld);
    this.muzzleLight.intensity = this.viewmodel.flashing ? 30 : 0;

    this.tracers.update(frameDt);
    this.impacts.update(frameDt);

    // HUD
    const spread = ws.spread({
      sprint: player.sprint,
      grounded: player.grounded,
      mantling: !!player.mantle,
      moveFactor: player.horizontalSpeed / MOVE.walkSpeed,
    });
    const gap = (Math.tan(spread * DEG) / Math.tan((camera.fov * DEG) / 2)) * (innerHeight / 2) + 6;
    const crosshair = ws.ads < 0.4 && !player.sprint && ws.phase !== 'swapOut' && !player.mantle;
    this.hud.setCrosshair(gap, crosshair);
    const slot = ws.slot;
    this.hud.setAmmo(slot.mag, ws.stats.magSize, slot.reserve, ws.def.name);
    this.hud.setReload(ws.phase === 'reload' ? ws.phaseProgress : null);
    // MW-style prompts: RELOAD when the mag runs low (if there's ammo to reload with).
    const low = slot.mag <= Math.floor(ws.stats.magSize * ws.stats.lowAmmoFraction);
    if (slot.mag === 0 && slot.reserve === 0) this.hud.setHint('NO AMMO', undefined, true);
    else if (low && slot.reserve > 0 && ws.phase !== 'reload')
      this.hud.setHint('RELOAD', 'R', slot.mag === 0);
    else if (low && slot.reserve === 0) this.hud.setHint('LOW AMMO');
    else this.hud.setHint(null);
  }

  /** ADS zoom divisor for the world camera FOV, eased. */
  get fovDivisor() {
    const a = this.weapons.ads;
    const e = a * a * (3 - 2 * a);
    return 1 + (this.weapons.stats.adsZoom - 1) * e;
  }

  /**
   * Mouse sensitivity multiplier while aiming. Relative mode scales by the zoom (keeps on-screen
   * flick distances consistent, like MW's "relative"); then the player's ADS multiplier and the
   * weapon's own multiplier apply. Blends in with the ADS amount.
   */
  sensitivityMul(baseFov: number) {
    const a = this.weapons.ads;
    if (a <= 0) return 1;
    let mul = SETTINGS.adsSensitivity * this.weapons.stats.adsSensMul;
    if (SETTINGS.adsRelative) {
      const zoomed = 2 * Math.atan(Math.tan((baseFov * DEG) / 2) / this.fovDivisor);
      mul *= Math.tan(zoomed / 2) / Math.tan((baseFov * DEG) / 2);
    }
    return 1 + (mul - 1) * a;
  }
}
