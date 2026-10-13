import {
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import { Spring3 } from '../core/springs';
import { defineTunables } from '../dev/tuning';
import { SHIELD, type WeaponDef } from './defs';
import { buildGunModel, buildKnife, buildShield, type GunModel, type ShieldModel } from './models';
import type { WeaponSystem } from './weapon';

/** Viewmodel feel. Rotations radians, offsets meters (camera space). */
export const VM = defineTunables(
  'viewmodel',
  {
    fov: 62,
    adsFov: 46,
    swayPerPxPerSec: 0.00006,
    swayMax: 0.09,
    swayFrequency: 5,
    swayDamping: 0.6,
    bobAmount: 0.009,
    bobSide: 0.012,
    bobAdsMul: 0.12,
    bobSprintMul: 1.7,
    bobStride: 2.6,
    poseRate: 12,
    landKick: 0.0035,
    strafeTilt: 0.05,
    slideTilt: -0.35,
    adsKickMul: 0.45,
    breathe: 0.0015,
    reloadIntensity: 1,
  },
  { swayPerPxPerSec: [0, 0.0003, 0.000005] },
);

export interface ViewModelInput {
  weapons: WeaponSystem;
  lookDx: number;
  lookDy: number;
  /** Horizontal speed m/s and lateral component (right +). */
  speed: number;
  lateral: number;
  grounded: boolean;
  sprint: number;
  sliding: boolean;
  mantling: boolean;
  landedSpeed: number;
}

/** Per-weapon pose deltas relative to hip (position m, rotation rad). */
const POSES = {
  ar: {
    sprint: { pos: [-0.03, -0.045, 0.03], rot: [-0.35, 0.75, 0.35] },
    tac: { pos: [-0.04, 0.0, 0.06], rot: [0.95, 0.3, -0.55] },
    reload: { pos: [-0.05, -0.07, 0.05], rot: [0.32, 0.3, 0.8] },
  },
  pistol: {
    sprint: { pos: [-0.02, -0.07, 0.04], rot: [-0.65, 0.25, 0.1] },
    tac: { pos: [-0.03, 0.03, 0.06], rot: [0.9, 0.05, 0.1] },
    reload: { pos: [-0.04, -0.05, 0.04], rot: [0.45, 0.25, 0.6] },
  },
} as const;
const SWAP_POSE = { pos: [0, -0.28, 0.05], rot: [-0.9, 0.1, 0.2] } as const;
/** Rifle-butt bash: the gun swings left and the stock drives forward. */
const BASH_POSE = { pos: [-0.13, 0.05, -0.12], rot: [0.3, 1.05, 0.75] } as const;
/** Pistol dips while the off hand slashes. */
const KNIFE_GUN_POSE = { pos: [0.03, -0.06, 0.03], rot: [-0.35, -0.1, -0.15] } as const;
/** Guns tuck down-right behind the shield. */
const SHIELD_GUN_POSE = { pos: [0.06, -0.14, 0.06], rot: [-0.6, -0.25, -0.3] } as const;
/** Knife keyframes (camera space): rest low-left, wind back, slash across to the right. */
const KNIFE_REST = { pos: [-0.17, -0.19, -0.3], rot: [0.35, 0.25, 0.5] } as const;
const KNIFE_WIND = { pos: [-0.24, -0.1, -0.24], rot: [0.55, 0.9, 1.1] } as const;
const KNIFE_STRIKE = { pos: [0.06, -0.08, -0.46], rot: [0.1, -0.9, 1.4] } as const;

const smooth = (t: number) => t * t * (3 - 2 * t);
/** 0→1→0 envelope over [a, b] with `ramp` fade in/out. */
const window01 = (t: number, a: number, b: number, ramp: number) =>
  smooth(Math.min(1, Math.max(0, (t - a) / ramp))) *
  smooth(Math.min(1, Math.max(0, (b - t) / ramp)));

export class ViewModel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(VM.fov, 1, 0.01, 10);
  private readonly rig = new Group();
  private readonly guns = new Map<string, GunModel>();
  private readonly knife = buildKnife();
  private readonly shield: ShieldModel = buildShield();
  private shieldFlash = 0;
  private active: GunModel | null = null;
  private activeId = '';

  private readonly kickPos = new Spring3(9, 0.42);
  private readonly kickRot = new Spring3(9, 0.42);
  private readonly sway = new Spring3(5, 0.6);
  private readonly shakeSpring = new Spring3(14, 0.35);
  private readonly flashLight = new PointLight(0xffb060, 0, 3, 2);
  private flashT = 0;
  private sprintW = 0;
  private tacW = 0;
  private slideW = 0;
  private mantleW = 0;
  private bobPhase = 0;
  private bobW = 0;
  private time = 0;
  /** Visual camera shake from firing (degrees: pitch, yaw, roll). Not aim. */
  readonly cameraShake = new Vector3();
  /** Muzzle position in viewmodel-camera space (for tracers). */
  readonly muzzleView = new Vector3();

  constructor(defs: WeaponDef[]) {
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x30343c, 1.3));
    const key = new DirectionalLight(0xfff1e0, 1.6);
    key.position.set(-1, 2, 1);
    this.scene.add(key);
    this.scene.add(this.flashLight);
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.knife.visible = false;
    this.shield.root.visible = false;
    this.rig.add(this.knife, this.shield.root);
    for (const def of defs) {
      const gun = buildGunModel(def);
      gun.root.visible = false;
      this.rig.add(gun.root);
      this.guns.set(def.id, gun);
    }
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Call once per shot. */
  onFire(def: WeaponDef, ads: number) {
    const s = def.stats;
    const k = 1 + (VM.adsKickMul - 1) * ads;
    const w = 2 * Math.PI * s.kickFrequency;
    this.kickPos.impulse(0, s.kickUp * w * k, s.kickBack * w * k);
    const roll = (Math.random() - 0.5) * 2 * s.kickRoll;
    this.kickRot.impulse(
      ((s.kickPitch * Math.PI) / 180) * w * k,
      (((Math.random() - 0.5) * 0.5 * Math.PI) / 180) * w,
      ((roll * Math.PI) / 180) * w * k,
    );
    const sh = s.shake * 2 * Math.PI * 14;
    this.shakeSpring.impulse(
      sh * (0.6 + Math.random() * 0.4),
      (Math.random() - 0.5) * sh * 0.6,
      (Math.random() - 0.5) * sh,
    );
    this.flashT = 0.045;
    if (this.active) {
      this.active.flash.rotation.z = Math.random() * Math.PI * 2;
      this.active.flash.scale.setScalar(
        (def.id === 'ar' ? 0.16 : 0.12) * (0.8 + Math.random() * 0.4),
      );
    }
  }

  /** A projectile hit the shield: flash + shove. */
  onShieldBlock() {
    this.shieldFlash = 1;
    this.kickPos.impulse(0, 0.2, 1.4);
    this.shakeSpring.impulse(6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
  }

  /** The melee swing connected with something. */
  onMeleeHit() {
    this.shakeSpring.impulse(14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16);
  }

  /** Palm slap when the new mag seats: the gun jolts up. */
  onMagIn() {
    const k = VM.reloadIntensity;
    this.kickPos.impulse(0, 0.9 * k, 0.2 * k);
    this.kickRot.impulse(2.5 * k, 0, -1.5 * k);
  }

  /** Charging-handle pull on empty reloads: yank back and twist. */
  onChamber() {
    const k = VM.reloadIntensity;
    this.kickRot.impulse(-3 * k, 0.8 * k, 3 * k);
    this.kickPos.impulse(0, 0, 1.2 * k);
  }

  update(dt: number, p: ViewModelInput) {
    this.time += dt;
    const ws = p.weapons;
    const def = ws.def;
    if (def.id !== this.activeId) {
      if (this.active) this.active.root.visible = false;
      this.active = this.guns.get(def.id) ?? null;
      if (this.active) this.active.root.visible = true;
      this.activeId = def.id;
    }
    const gun = this.active;
    if (!gun) return;
    const s = def.stats;
    for (const sp of [this.kickPos, this.kickRot]) {
      sp.frequency = s.kickFrequency;
      sp.damping = s.kickDamping;
    }
    this.sway.frequency = VM.swayFrequency;
    this.sway.damping = VM.swayDamping;

    // --- pose weights
    const rate = 1 - Math.exp(-VM.poseRate * dt);
    this.sprintW += ((p.sprint === 1 ? 1 : 0) - this.sprintW) * rate;
    this.tacW += ((p.sprint === 2 ? 1 : 0) - this.tacW) * rate;
    this.slideW += ((p.sliding ? 1 : 0) - this.slideW) * rate;
    this.mantleW += ((p.mantling ? 1 : 0) - this.mantleW) * rate;
    const ads = smooth(ws.ads);
    const progress = ws.phaseProgress ?? 0;
    const reloadW = ws.phase === 'reload' ? window01(progress, 0, 1, 0.18) : 0;
    const swapW =
      ws.phase === 'swapOut' ? smooth(progress) : ws.phase === 'swapIn' ? 1 - smooth(progress) : 0;

    // --- base pose: hip → ADS
    const hip = def.hipOffset;
    const pos = new Vector3(
      hip[0] * (1 - ads),
      hip[1] + (-def.sightHeight - hip[1]) * ads,
      hip[2] + (-def.adsDistance - hip[2]) * ads,
    );
    const rot = new Vector3();
    const poses = POSES[def.id];
    const add = (pose: { pos: readonly number[]; rot: readonly number[] }, w: number) => {
      if (w <= 1e-4) return;
      pos.x += pose.pos[0] * w;
      pos.y += pose.pos[1] * w;
      pos.z += pose.pos[2] * w;
      rot.x += pose.rot[0] * w;
      rot.y += pose.rot[1] * w;
      rot.z += pose.rot[2] * w;
    };
    add(poses.sprint, this.sprintW * (1 - ads));
    add(poses.tac, this.tacW * (1 - ads));
    add(poses.reload, reloadW * (1 - ads * 0.5) * VM.reloadIntensity);
    if (ws.phase === 'reload') {
      // The gun dips while the hand pushes the new mag in, then rises as it seats.
      const addAt = s.reloadAddAt;
      pos.y -= window01(progress, addAt - 0.25, addAt + 0.02, 0.1) * 0.025 * VM.reloadIntensity;
    }
    add(SWAP_POSE, Math.max(swapW, this.mantleW * 0.8));
    // melee: bash (AR) or the pistol dipping for the off-hand knife
    const melee = ws.melee;
    const meleeP = ws.phase === 'melee' ? progress : -1;
    const meleeW =
      meleeP < 0
        ? 0
        : smooth(Math.min(1, meleeP / Math.max(0.05, melee.hitAt))) *
          (1 - smooth(Math.min(1, Math.max(0, (meleeP - melee.hitAt - 0.12) / (0.88 - melee.hitAt)))));
    add(melee.kind === 'bash' ? BASH_POSE : KNIFE_GUN_POSE, meleeW);
    const shieldW = smooth(ws.shieldRaise);
    add(SHIELD_GUN_POSE, shieldW);
    rot.z += VM.slideTilt * this.slideW * (1 - ads * 0.7);

    // --- sway (lags behind mouse motion)
    const swayX = Math.max(
      -VM.swayMax,
      Math.min(VM.swayMax, (p.lookDy / Math.max(dt, 1e-3)) * VM.swayPerPxPerSec),
    );
    const swayY = Math.max(
      -VM.swayMax,
      Math.min(VM.swayMax, (p.lookDx / Math.max(dt, 1e-3)) * VM.swayPerPxPerSec),
    );
    const swayMul = 1 - ads * 0.75;
    this.sway.target.set(swayX * swayMul, swayY * swayMul, -swayY * 0.5 * swayMul);
    this.sway.step(dt);
    // hand motion (sway + bob) shared by gun, knife and shield
    const handPos = new Vector3(-this.sway.value.y * 0.08, this.sway.value.x * 0.05, 0);
    const handRot = this.sway.value.clone();

    // --- bob + strafe tilt + breathing
    const moving = p.grounded && !p.sliding && !p.mantling;
    const bobTarget = moving ? Math.min(p.speed / 5, 2) : 0;
    this.bobW += (bobTarget - this.bobW) * rate;
    this.bobPhase += (p.speed * dt * 2 * Math.PI) / VM.bobStride;
    const bobMul = this.bobW * (1 + (VM.bobAdsMul - 1) * ads) * (p.sprint ? VM.bobSprintMul : 1);
    handPos.x += Math.sin(this.bobPhase) * VM.bobSide * bobMul;
    handPos.y += -Math.abs(Math.cos(this.bobPhase)) * VM.bobAmount * bobMul;
    handRot.z += Math.sin(this.bobPhase) * 0.025 * bobMul;
    pos.add(handPos);
    rot.add(handRot);
    rot.z -= (p.lateral / 5) * VM.strafeTilt * (1 - ads * 0.8);
    pos.y += Math.sin(this.time * 1.3) * VM.breathe * (1 - ads * 0.8);

    // --- kick + landing
    if (p.landedSpeed > 2) this.kickPos.impulse(0, -p.landedSpeed * VM.landKick * 60, 0);
    this.kickPos.step(dt);
    this.kickRot.step(dt);
    this.shakeSpring.step(dt);
    pos.add(this.kickPos.value);
    rot.add(this.kickRot.value);
    this.cameraShake.copy(this.shakeSpring.value);

    gun.root.position.copy(pos);
    gun.root.rotation.copy(new Euler(rot.x, rot.y, rot.z, 'YXZ'));

    this.updateKnife(def, meleeP, melee.hitAt, swapW, ads, handPos, handRot);
    this.updateShield(dt, ws, shieldW, handPos, handRot);

    // --- reload: magazine out/in
    // The old mag drops out tumbling; the new one arrives from below-left and seats exactly at
    // reloadAddAt (when the ammo is actually added).
    const home = (gun.mag.userData.home ??= {
      pos: gun.mag.position.clone(),
      rotX: gun.mag.rotation.x,
    }) as { pos: Vector3; rotX: number };
    gun.mag.position.copy(home.pos);
    gun.mag.rotation.set(home.rotX, 0, 0);
    gun.mag.visible = true;
    if (ws.phase === 'reload') {
      const addAt = s.reloadAddAt;
      const out = smooth(Math.min(1, Math.max(0, (progress - 0.06) / 0.2)));
      const inT = smooth(Math.min(1, Math.max(0, (progress - (addAt - 0.24)) / 0.24)));
      if (inT <= 0) {
        // old mag falling away
        gun.mag.position.y -= out * 0.35;
        gun.mag.position.z += out * 0.06;
        gun.mag.rotation.x += out * 0.9;
        gun.mag.visible = out < 0.98;
      } else {
        // new mag coming in
        const away = 1 - inT;
        gun.mag.position.y -= away * 0.22;
        gun.mag.position.x -= away * 0.08;
        gun.mag.rotation.z = away * 0.5;
      }
    }

    // --- muzzle flash
    this.flashT -= dt;
    gun.flash.visible = this.flashT > 0;
    gun.muzzle.updateWorldMatrix(true, false);
    gun.muzzle.getWorldPosition(this.flashLight.position);
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;
    // Muzzle in camera space (camera is the scene root of the rig, at the origin).
    this.muzzleView.copy(this.flashLight.position).applyMatrix4(this.camera.matrixWorldInverse);

    const fov = VM.fov + (VM.adsFov - VM.fov) * ads;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Off-hand knife: visible with the pistol; rest → wind → slash → rest over the melee. */
  private updateKnife(
    def: WeaponDef,
    p: number,
    hitAt: number,
    swapW: number,
    ads: number,
    handPos: Vector3,
    handRot: Vector3,
  ) {
    const k = this.knife;
    k.visible = def.melee === 'knife' && swapW < 0.6;
    if (!k.visible) return;
    const lerpPose = (
      a: { pos: readonly number[]; rot: readonly number[] },
      b: { pos: readonly number[]; rot: readonly number[] },
      t: number,
    ) => {
      const e = smooth(Math.min(1, Math.max(0, t)));
      const f = (i: number, arr: 'pos' | 'rot') => a[arr][i] + (b[arr][i] - a[arr][i]) * e;
      return { pos: [f(0, 'pos'), f(1, 'pos'), f(2, 'pos')], rot: [f(0, 'rot'), f(1, 'rot'), f(2, 'rot')] };
    };
    let pose: { pos: readonly number[]; rot: readonly number[] } = KNIFE_REST;
    if (p >= 0) {
      const wind = hitAt * 0.65;
      const strikeEnd = hitAt + 0.12;
      if (p < wind) pose = lerpPose(KNIFE_REST, KNIFE_WIND, p / wind);
      else if (p < strikeEnd) pose = lerpPose(KNIFE_WIND, KNIFE_STRIKE, (p - wind) / (strikeEnd - wind));
      else pose = lerpPose(KNIFE_STRIKE, KNIFE_REST, (p - strikeEnd) / (1 - strikeEnd));
    }
    // aiming tucks the knife further down out of the way; swapping drops it
    const tuck = ads * 0.12 + swapW * 0.3;
    k.position.set(pose.pos[0] + handPos.x, pose.pos[1] + handPos.y - tuck, pose.pos[2] + handPos.z);
    k.rotation.copy(new Euler(pose.rot[0] + handRot.x, pose.rot[1] + handRot.y, pose.rot[2] + handRot.z, 'YXZ'));
  }

  /** Shield raise (from below), hit flash, health tint, broken fade. */
  private updateShield(dt: number, ws: WeaponSystem, w: number, handPos: Vector3, handRot: Vector3) {
    const sh = this.shield;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 5);
    sh.root.visible = w > 0.01;
    if (!sh.root.visible) return;
    const down = 1 - w;
    sh.root.position.set(-0.1 + handPos.x * 0.5, -0.02 - down * 0.6 + handPos.y * 0.5, down * 0.1);
    sh.root.rotation.copy(new Euler(down * 0.7 + handRot.x * 0.4, 0.1 + handRot.y * 0.4, handRot.z * 0.3, 'YXZ'));
    const u = sh.material.uniforms;
    u.uTime.value = this.time;
    u.uFlash.value = this.shieldFlash;
    u.uHealth.value = Math.max(0, ws.shieldHp / Math.max(1, SHIELD.hp));
    u.uAlpha.value = w;
  }

  /** World-space light for the muzzle flash in the level (copy its intensity each frame). */
  get flashing() {
    return this.flashT > 0;
  }
}
