import type { InputState } from '../core/input';
import { Spring } from '../core/springs';
import type { WeaponDef, WeaponStats } from './defs';

/** What the weapon needs to know about the player each step. */
export interface WeaponContext {
  /** 0 none, 1 sprint, 2 tac sprint (see PlayerController.sprint). */
  sprint: number;
  grounded: boolean;
  mantling: boolean;
  /** Horizontal speed / walk speed (0..~2). */
  moveFactor: number;
}

/** One bullet: angular offset from the view direction (degrees), from spread. */
export interface Shot {
  spreadYaw: number;
  spreadPitch: number;
}

/** Things that happened this step, for audio / viewmodel / HUD. Cleared every step. */
export interface WeaponEvents {
  shots: Shot[];
  dryFire: boolean;
  reloadStarted: boolean;
  magOut: boolean;
  magIn: boolean;
  chamber: boolean;
  swapStarted: boolean;
}

interface Slot {
  def: WeaponDef;
  mag: number;
  reserve: number;
}

type Phase = 'ready' | 'reload' | 'swapOut' | 'swapIn';

/** Aiming within this long after a sprint ended counts as "straight out of the sprint". */
const ADS_SPRINT_WINDOW = 0.35;

/** Seeded PRNG (mulberry32) so tests and recoil patterns are deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed horizontal recoil pattern in [-1, 1] per shot index: the same every spray, so it's learnable. */
function patternH(id: string, shot: number): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ shot, 2246822519);
  h ^= h >>> 13;
  // Smooth-ish: blend this shot's value with a slow sine so sprays snake rather than jitter.
  const noise = ((h >>> 0) / 4294967296) * 2 - 1;
  return 0.55 * noise + 0.45 * Math.sin(shot * 0.7 + (h & 7));
}

/**
 * Weapon logic: fire timing, ammo, reload, ADS, swapping, spread and aim recoil.
 * Pure state + numbers (no three.js / DOM) so it runs headless in tests.
 */
export class WeaponSystem {
  readonly slots: Slot[];
  current = 0;
  phase: Phase = 'swapIn';
  phaseT = 0;
  /** 0 = hip, 1 = fully aimed. */
  ads = 0;
  bloom = 0;
  /** Seconds until the gun can fire again (fire rate, sprint-out). */
  private cooldown = 0;
  private sprintOutT = 0;
  private wasSprint = 0;
  /** Sprint level we last came out of and how long ago (aiming straight out of a sprint is slower). */
  private lastSprint = 0;
  private sinceSprint = 999;
  /** ADS-in time multiplier, locked when the aim-in starts. */
  private adsInMul = 1;
  private adsRising = false;
  private triggerHeld = false;
  /** Semi-auto: a click buffered slightly before the gun is ready still fires. */
  private fireBufferT = 0;
  private pendingSlot = -1;
  private ammoAdded = false;
  private sprayShots = 0;
  private sinceShot = 999;
  private random: () => number;

  // Aim recoil (degrees). view = base + punch. `fold` is handed to the camera to absorb into base.
  private punchTargetPitch = 0;
  private punchTargetYaw = 0;
  private recoverToPitch = 0;
  private recoverToYaw = 0;
  readonly punchPitch = new Spring(18, 1);
  readonly punchYaw = new Spring(18, 1);
  foldPitch = 0;
  foldYaw = 0;

  readonly events: WeaponEvents = {
    shots: [],
    dryFire: false,
    reloadStarted: false,
    magOut: false,
    magIn: false,
    chamber: false,
    swapStarted: false,
  };

  constructor(loadout: WeaponDef[], seed = 1) {
    this.slots = loadout.map((def) => ({
      def,
      mag: def.stats.magSize,
      reserve: def.stats.reserve,
    }));
    this.random = rng(seed);
  }

  get slot() {
    return this.slots[this.current];
  }
  get def() {
    return this.slot.def;
  }
  get stats(): WeaponStats {
    return this.slot.def.stats;
  }

  /** True while the player is trying to use the gun: the controller should stop sprinting. */
  wantsSprintBlocked(input: InputState) {
    return input.down.has('fire') || input.down.has('ads');
  }

  /** 0..1 progress of a reload/swap, else null. */
  get phaseProgress(): number | null {
    if (this.phase === 'ready') return null;
    return Math.min(1, this.phaseT / this.phaseDuration());
  }

  private phaseDuration() {
    const s = this.stats;
    switch (this.phase) {
      case 'reload':
        return this.reloadEmpty ? s.emptyReloadTime : s.reloadTime;
      case 'swapOut':
        return s.swapOutTime;
      case 'swapIn':
        return s.swapInTime;
      default:
        return 0;
    }
  }
  private reloadEmpty = false;

  /** Current cone half-angle in degrees. */
  spread(ctx: WeaponContext) {
    const s = this.stats;
    const base = s.hipSpread + (s.adsSpread - s.hipSpread) * this.ads;
    const move = s.moveSpread * Math.min(ctx.moveFactor, 1.5) * (1 - this.ads * 0.85);
    const air = ctx.grounded ? 0 : s.airSpread * (1 - this.ads * 0.7);
    return Math.max(0, base + move + air + this.bloom * (1 - this.ads * 0.8));
  }

  step(dt: number, input: InputState, ctx: WeaponContext) {
    const ev = this.events;
    ev.shots = [];
    ev.dryFire = ev.reloadStarted = ev.magOut = ev.magIn = ev.chamber = ev.swapStarted = false;
    this.foldPitch = this.foldYaw = 0;
    const s = this.stats;

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.fireBufferT = Math.max(0, this.fireBufferT - dt);
    this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - s.bloomDecay * dt);

    // Coming out of a sprint, the gun needs a moment to come up.
    if (this.wasSprint && !ctx.sprint) {
      this.sprintOutT = this.wasSprint === 2 ? s.tacSprintOutTime : s.sprintOutTime;
      this.lastSprint = this.wasSprint;
      this.sinceSprint = 0;
    }
    this.sinceSprint += dt;
    this.wasSprint = ctx.sprint;
    this.sprintOutT = Math.max(0, this.sprintOutT - dt);

    // Weapon switching.
    const want = input.pressed.has('weapon1')
      ? 0
      : input.pressed.has('weapon2')
        ? 1
        : input.pressed.has('swap')
          ? (this.current + 1) % this.slots.length
          : -1;
    if (
      want >= 0 &&
      want < this.slots.length &&
      want !== this.current &&
      this.phase !== 'swapOut'
    ) {
      this.pendingSlot = want;
      this.phase = 'swapOut';
      this.phaseT = 0;
      ev.swapStarted = true;
    }

    // ADS: not while sprinting, swapping or mantling.
    const canAds =
      !ctx.sprint && !ctx.mantling && this.phase !== 'swapOut' && this.phase !== 'swapIn';
    const adsTarget = canAds && input.down.has('ads') ? 1 : 0;
    if (adsTarget === 1 && !this.adsRising) {
      // Aim-in speed depends on what you were doing when you started aiming.
      const walk = 1 + (s.adsTimeWalkMul - 1) * Math.min(1, ctx.moveFactor);
      const fromSprint =
        this.sinceSprint < ADS_SPRINT_WINDOW
          ? this.lastSprint === 2
            ? s.adsTimeTacMul
            : s.adsTimeSprintMul
          : 1;
      this.adsInMul = Math.max(walk, fromSprint);
    }
    this.adsRising = adsTarget === 1;
    if (adsTarget > this.ads)
      this.ads = Math.min(1, this.ads + dt / Math.max(0.01, s.adsTime * this.adsInMul));
    else if (adsTarget < this.ads)
      this.ads = Math.max(0, this.ads - dt / Math.max(0.01, s.adsTime));

    this.stepPhase(dt);

    // Reload request.
    if (
      input.pressed.has('reload') &&
      this.phase === 'ready' &&
      this.slot.mag < s.magSize &&
      this.slot.reserve > 0
    )
      this.startReload();

    // Mag ran dry (e.g. holding the trigger through the last round): reload as soon as the gun cycles.
    if (
      this.phase === 'ready' &&
      this.slot.mag === 0 &&
      this.slot.reserve > 0 &&
      this.cooldown <= 0
    )
      this.startReload();

    // Firing.
    if (input.pressed.has('fire')) this.fireBufferT = 0.12;
    const trigger = input.down.has('fire');
    const wantsShot = s.auto ? trigger : this.fireBufferT > 0;
    const ready =
      this.phase === 'ready' &&
      !ctx.sprint &&
      !ctx.mantling &&
      this.sprintOutT <= 0 &&
      this.cooldown <= 0;
    if (wantsShot && ready) {
      if (this.slot.mag > 0) this.fire(ctx);
      else if (input.pressed.has('fire') || !this.triggerHeld) {
        ev.dryFire = true;
        this.cooldown = 0.25;
        if (this.slot.reserve > 0) this.startReload(); // auto-reload on empty
      }
      this.fireBufferT = 0;
    }
    this.triggerHeld = trigger;

    this.stepRecoil(dt);
  }

  private fire(ctx: WeaponContext) {
    const s = this.stats;
    this.slot.mag--;
    this.cooldown += 60 / s.rpm;
    if (this.sinceShot > (60 / s.rpm) * 2.5) this.sprayShots = 0;
    this.sinceShot = 0;

    // Spread: uniform in a disc of the current cone.
    const cone = this.spread(ctx);
    const r = Math.sqrt(this.random()) * cone;
    const a = this.random() * Math.PI * 2;
    this.events.shots.push({ spreadYaw: Math.cos(a) * r, spreadPitch: Math.sin(a) * r });
    this.bloom = Math.min(s.bloomMax, this.bloom + s.bloomPerShot);

    // Aim recoil: climb + patterned horizontal drift (+ a little noise).
    const adsMul = 1 + (s.adsRecoilMul - 1) * this.ads;
    const first = this.sprayShots < 3 ? s.firstShotMul : 1;
    const v = s.recoilVertical * first * adsMul * (0.9 + this.random() * 0.2);
    const h =
      (s.recoilHorizontalBias + s.recoilHorizontal * patternH(this.def.id, this.sprayShots)) *
      first *
      adsMul;
    this.punchTargetPitch += v;
    this.punchTargetYaw += h + (this.random() - 0.5) * s.recoilHorizontal * 0.2;
    this.recoverToPitch = this.punchTargetPitch * (1 - s.recoilRecovery);
    this.recoverToYaw = this.punchTargetYaw * (1 - s.recoilRecovery);
    this.sprayShots++;
  }

  /**
   * Aim punch follows its target quickly. After a spray, the target eases back toward the
   * non-recovered remainder; once there, that remainder is folded into the base view.
   */
  private stepRecoil(dt: number) {
    const s = this.stats;
    this.punchPitch.frequency = this.punchYaw.frequency = s.recoilSnap;
    const firing = this.sinceShot < (60 / s.rpm) * 1.5;
    if (!firing) {
      const k = 1 - Math.exp(-s.recoveryRate * dt);
      this.punchTargetPitch += (this.recoverToPitch - this.punchTargetPitch) * k;
      this.punchTargetYaw += (this.recoverToYaw - this.punchTargetYaw) * k;
      if (
        Math.abs(this.punchTargetPitch - this.recoverToPitch) < 0.01 &&
        Math.abs(this.punchTargetYaw - this.recoverToYaw) < 0.01 &&
        Math.abs(this.punchPitch.value - this.punchTargetPitch) < 0.02
      ) {
        this.foldPitch = this.recoverToPitch;
        this.foldYaw = this.recoverToYaw;
        this.punchTargetPitch -= this.foldPitch;
        this.punchTargetYaw -= this.foldYaw;
        this.punchPitch.value -= this.foldPitch;
        this.punchPitch.target = this.punchTargetPitch;
        this.punchYaw.value -= this.foldYaw;
        this.recoverToPitch = this.recoverToYaw = 0;
      }
    }
    this.punchPitch.target = this.punchTargetPitch;
    this.punchYaw.target = this.punchTargetYaw;
    this.punchPitch.step(dt);
    this.punchYaw.step(dt);
  }

  private startReload() {
    this.phase = 'reload';
    this.phaseT = 0;
    this.ammoAdded = false;
    this.reloadEmpty = this.slot.mag === 0;
    this.events.reloadStarted = true;
    this.events.magOut = true;
  }

  private stepPhase(dt: number) {
    if (this.phase === 'ready') return;
    this.phaseT += dt;
    const dur = this.phaseDuration();
    const ev = this.events;
    if (this.phase === 'reload') {
      const s = this.stats;
      if (!this.ammoAdded && this.phaseT >= dur * s.reloadAddAt) {
        const need = s.magSize - this.slot.mag;
        const take = Math.min(need, this.slot.reserve);
        this.slot.mag += take;
        this.slot.reserve -= take;
        this.ammoAdded = true;
        ev.magIn = true;
      }
      if (this.reloadEmpty && this.phaseT - dt < dur * 0.85 && this.phaseT >= dur * 0.85)
        ev.chamber = true;
      if (this.phaseT >= dur) this.phase = 'ready';
    } else if (this.phase === 'swapOut' && this.phaseT >= dur) {
      this.current = this.pendingSlot;
      this.pendingSlot = -1;
      this.phase = 'swapIn';
      this.phaseT = 0;
      this.ads = 0;
      this.sprayShots = 0;
    } else if (this.phase === 'swapIn' && this.phaseT >= dur) {
      this.phase = 'ready';
    }
  }

  /** Refill everything (respawn). */
  refill() {
    for (const s of this.slots) {
      s.mag = s.def.stats.magSize;
      s.reserve = s.def.stats.reserve;
    }
  }

  /** Damage at a distance, with falloff. */
  damageAt(distance: number, head: boolean) {
    const s = this.stats;
    const t = Math.min(
      1,
      Math.max(0, (distance - s.falloffStart) / Math.max(1e-3, s.falloffEnd - s.falloffStart)),
    );
    const base = s.damage * (1 - t * (1 - s.minDamageMul));
    return head ? base * s.headMul : base;
  }
}
