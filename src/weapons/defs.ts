import { defineTunables } from '../dev/tuning';

/**
 * Weapon feel data. Every number is live-tunable in the dev panel (one folder per weapon).
 * Angles in degrees, distances meters, times seconds. Viewmodel offsets are camera-space meters.
 */
export interface WeaponStats {
  rpm: number;
  auto: boolean;
  damage: number;
  headMul: number;
  /** Damage falls off linearly from falloffStart to falloffEnd, down to damage * minDamageMul. */
  falloffStart: number;
  falloffEnd: number;
  minDamageMul: number;
  range: number;

  magSize: number;
  /** Show the RELOAD prompt when the mag is at or below this fraction. */
  lowAmmoFraction: number;
  reserve: number;
  reloadTime: number;
  emptyReloadTime: number;
  /** Fraction of the reload at which ammo is actually added (cancel before = no ammo). */
  reloadAddAt: number;

  adsTime: number;
  /** ADS-in time multipliers: at full walk speed, and when aiming straight out of a sprint / tac sprint. */
  adsTimeWalkMul: number;
  adsTimeSprintMul: number;
  adsTimeTacMul: number;
  /** FOV divisor while fully aimed. */
  adsZoom: number;
  adsMoveMul: number;
  /** ADS mouse sensitivity multiplier on top of FOV-relative scaling. */
  adsSensMul: number;
  sprintOutTime: number;
  tacSprintOutTime: number;
  swapInTime: number;
  swapOutTime: number;

  hipSpread: number;
  adsSpread: number;
  moveSpread: number;
  airSpread: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomDecay: number;

  /** Aim recoil per shot (degrees). Vertical always climbs; horizontal follows a fixed, learnable pattern. */
  recoilVertical: number;
  recoilHorizontal: number;
  recoilHorizontalBias: number;
  /** Multiplier on the first 3 shots (MW-style accurate first shots). */
  firstShotMul: number;
  adsRecoilMul: number;
  /** Fraction of the climbed recoil that recovers by itself after you stop firing. */
  recoilRecovery: number;
  recoveryRate: number;
  /** How snappily the aim follows each kick (Hz). */
  recoilSnap: number;
  /** Visual-only camera shake per shot (degrees). */
  shake: number;

  /** Viewmodel kick per shot. */
  kickBack: number;
  kickUp: number;
  kickPitch: number;
  kickRoll: number;
  kickFrequency: number;
  kickDamping: number;
}

export interface WeaponDef {
  id: 'ar' | 'pistol';
  name: string;
  sfx: 'ar_shot' | 'pistol_shot';
  /** Height of the sight line above the model origin (for ADS alignment). */
  sightHeight: number;
  /** Muzzle position in model space. */
  muzzle: [number, number, number];
  hipOffset: [number, number, number];
  adsDistance: number;
  stats: WeaponStats;
}

export const AR: WeaponDef = {
  id: 'ar',
  name: 'VX-9 RIFLE',
  sfx: 'ar_shot',
  sightHeight: 0.072,
  muzzle: [0, 0.012, -0.52],
  hipOffset: [0.13, -0.15, -0.3],
  adsDistance: 0.3,
  stats: defineTunables('weapon: AR', {
    rpm: 720,
    auto: true,
    damage: 28,
    headMul: 1.6,
    falloffStart: 25,
    falloffEnd: 50,
    minDamageMul: 0.7,
    range: 300,
    magSize: 30,
    lowAmmoFraction: 0.2,
    reserve: 150,
    reloadTime: 2.0,
    emptyReloadTime: 2.5,
    reloadAddAt: 0.62,
    adsTime: 0.22,
    adsTimeWalkMul: 1.12,
    adsTimeSprintMul: 1.25,
    adsTimeTacMul: 1.45,
    adsZoom: 1.35,
    adsMoveMul: 0.65,
    adsSensMul: 1,
    sprintOutTime: 0.14,
    tacSprintOutTime: 0.28,
    swapInTime: 0.4,
    swapOutTime: 0.2,
    hipSpread: 2.2,
    adsSpread: 0.0,
    moveSpread: 1.4,
    airSpread: 3.0,
    bloomPerShot: 0.25,
    bloomMax: 2.0,
    bloomDecay: 6,
    recoilVertical: 0.55,
    recoilHorizontal: 0.28,
    recoilHorizontalBias: 0.06,
    firstShotMul: 0.55,
    adsRecoilMul: 0.85,
    recoilRecovery: 0.7,
    recoveryRate: 7,
    recoilSnap: 18,
    shake: 0.5,
    kickBack: 0.04,
    kickUp: 0.01,
    kickPitch: 3,
    kickRoll: 1.6,
    kickFrequency: 9,
    kickDamping: 0.42,
  }),
};

export const PISTOL: WeaponDef = {
  id: 'pistol',
  name: 'K-12 SIDEARM',
  sfx: 'pistol_shot',
  sightHeight: 0.058,
  muzzle: [0, 0.035, -0.2],
  hipOffset: [0.12, -0.13, -0.28],
  adsDistance: 0.24,
  stats: defineTunables('weapon: pistol', {
    rpm: 420,
    auto: false,
    damage: 36,
    headMul: 1.8,
    falloffStart: 15,
    falloffEnd: 35,
    minDamageMul: 0.6,
    range: 200,
    magSize: 12,
    lowAmmoFraction: 0.25,
    reserve: 72,
    reloadTime: 1.35,
    emptyReloadTime: 1.7,
    reloadAddAt: 0.6,
    adsTime: 0.15,
    adsTimeWalkMul: 1.08,
    adsTimeSprintMul: 1.15,
    adsTimeTacMul: 1.3,
    adsZoom: 1.15,
    adsMoveMul: 0.85,
    adsSensMul: 1,
    sprintOutTime: 0.1,
    tacSprintOutTime: 0.2,
    swapInTime: 0.3,
    swapOutTime: 0.15,
    hipSpread: 1.6,
    adsSpread: 0.0,
    moveSpread: 0.9,
    airSpread: 2.0,
    bloomPerShot: 0.6,
    bloomMax: 2.0,
    bloomDecay: 5,
    recoilVertical: 1.8,
    recoilHorizontal: 0.45,
    recoilHorizontalBias: 0,
    firstShotMul: 1,
    adsRecoilMul: 0.85,
    recoilRecovery: 0.9,
    recoveryRate: 9,
    recoilSnap: 22,
    shake: 0.6,
    kickBack: 0.055,
    kickUp: 0.022,
    kickPitch: 8,
    kickRoll: 2.5,
    kickFrequency: 8,
    kickDamping: 0.45,
  }),
};

export const LOADOUT: WeaponDef[] = [AR, PISTOL];
