import { describe, expect, it } from 'vitest';
import { ScriptedInput, type Action, type ScriptStep } from '../src/core/input';
import { AR, LOADOUT, PISTOL } from '../src/weapons/defs';
import { WeaponSystem, type WeaponContext } from '../src/weapons/weapon';

const DT = 1 / 120;
const CTX: WeaponContext = { sprint: 0, grounded: true, mantling: false, moveFactor: 0 };

interface Log {
  /** Times (s since run start) of each shot. */
  shotTimes: number[];
  dryTimes: number[];
  magInTimes: number[];
  reloadStartTimes: number[];
  phases: string[];
  /** Per-step ads values. */
  ads: number[];
  shotsDuringPhase: Record<string, number>;
  foldPitchSum: number;
  peakTargetPitch: number;
}

/** Step `ws` for `seconds` with a scripted input (times relative to run start). */
function run(
  ws: WeaponSystem,
  script: ScriptStep[],
  seconds: number,
  ctx: WeaponContext | ((t: number) => WeaponContext) = CTX,
  onStep?: (t: number, i: number) => void,
): Log {
  const input = new ScriptedInput(script);
  const log: Log = {
    shotTimes: [],
    dryTimes: [],
    magInTimes: [],
    reloadStartTimes: [],
    phases: [],
    ads: [],
    shotsDuringPhase: {},
    foldPitchSum: 0,
    peakTargetPitch: 0,
  };
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const t = (i + 1) * DT;
    input.advance(DT);
    const phaseBefore = ws.phase;
    ws.step(DT, input.sample(), typeof ctx === 'function' ? ctx(t) : ctx);
    for (let k = 0; k < ws.events.shots.length; k++) {
      log.shotTimes.push(t);
      log.shotsDuringPhase[phaseBefore] = (log.shotsDuringPhase[phaseBefore] ?? 0) + 1;
    }
    if (ws.events.dryFire) log.dryTimes.push(t);
    if (ws.events.magIn) log.magInTimes.push(t);
    if (ws.events.reloadStarted) log.reloadStartTimes.push(t);
    log.phases.push(ws.phase);
    log.ads.push(ws.ads);
    log.foldPitchSum += ws.foldPitch;
    log.peakTargetPitch = Math.max(
      log.peakTargetPitch,
      (ws as unknown as { punchTargetPitch: number }).punchTargetPitch,
    );
    onStep?.(t, i);
  }
  return log;
}

/** A fresh seeded system that has finished its initial swap-in. */
function ready(seed = 1): WeaponSystem {
  const ws = new WeaponSystem(LOADOUT, seed);
  expect(ws.phase).toBe('swapIn');
  run(ws, [], AR.stats.swapInTime + 0.05);
  expect(ws.phase).toBe('ready');
  return ws;
}

/** Ready system with the pistol equipped. */
function readyPistol(): WeaponSystem {
  const ws = ready();
  run(
    ws,
    [
      { t: 0, down: ['weapon2'] },
      { t: DT * 2, down: [] },
    ],
    0.8,
  );
  expect(ws.current).toBe(1);
  expect(ws.phase).toBe('ready');
  return ws;
}

const hold = (a: Action, from: number, to: number): ScriptStep[] => [
  { t: from, down: [a] },
  { t: to, down: [] },
];
/** Short taps (one press edge each) at the given times. */
const clicks = (times: number[], a: Action = 'fire'): ScriptStep[] =>
  times.flatMap((t) => [
    { t, down: [a] },
    { t: t + 0.02, down: [] as Action[] },
  ]);

describe('weapon system', () => {
  it('AR full-auto fires at rpm while fire is held, consuming ammo', () => {
    const ws = ready();
    const mag0 = ws.slot.mag;
    const log = run(ws, hold('fire', 0, 10), 1.0);
    const expected = Math.round(AR.stats.rpm / 60);
    expect(expected).toBe(12);
    expect(Math.abs(log.shotTimes.length - expected)).toBeLessThanOrEqual(1);
    expect(mag0 - ws.slot.mag).toBe(log.shotTimes.length);
  });

  it('pistol is semi-auto: hold fires once, spaced clicks each fire, fast clicks are buffered', () => {
    let ws = readyPistol();
    expect(run(ws, hold('fire', 0, 10), 1.5).shotTimes.length).toBe(1);

    ws = readyPistol();
    const spaced = run(ws, clicks([0, 0.25, 0.5, 0.75, 1.0]), 1.4);
    expect(spaced.shotTimes.length).toBe(5);

    // 420 rpm -> 0.143 s interval; the 0.1 s click lands 0.043 s before ready, inside the buffer.
    ws = readyPistol();
    const fast = run(ws, clicks([0, 0.1]), 0.6);
    expect(fast.shotTimes.length).toBe(2);
    // ...and it fired as soon as the gun was ready, not at the click time.
    expect(fast.shotTimes[1] - fast.shotTimes[0]).toBeGreaterThanOrEqual(
      60 / PISTOL.stats.rpm - DT,
    );
  });

  it('an empty mag with reserve auto-reloads, refills the mag and adds ammo once', () => {
    const ws = ready();
    ws.slot.mag = 0;
    const reserve0 = ws.slot.reserve;
    const s = AR.stats;
    const log = run(ws, clicks([0]), s.emptyReloadTime + 0.2);
    expect(log.dryTimes.length).toBe(0); // reload kicks in before the click can dry-fire
    expect(log.shotTimes.length).toBe(0);
    expect(log.reloadStartTimes.length).toBe(1);
    expect(log.phases[0]).toBe('reload');
    // magIn fires exactly once, at reloadAddAt of the empty-reload time.
    expect(log.magInTimes.length).toBe(1);
    const startT = log.reloadStartTimes[0];
    expect(log.magInTimes[0] - startT).toBeGreaterThanOrEqual(
      s.emptyReloadTime * s.reloadAddAt - 2 * DT,
    );
    expect(log.magInTimes[0] - startT).toBeLessThanOrEqual(
      s.emptyReloadTime * s.reloadAddAt + 2 * DT,
    );
    expect(ws.slot.mag).toBe(s.magSize);
    expect(ws.slot.reserve).toBe(reserve0 - s.magSize);
    expect(ws.phase).toBe('ready');
  });

  it('a fully empty gun (no reserve) dry-fires on click and does not reload', () => {
    const ws = ready();
    ws.slot.mag = 0;
    ws.slot.reserve = 0;
    const log = run(ws, clicks([0, 0.5]), 1);
    expect(log.dryTimes.length).toBe(2);
    expect(log.reloadStartTimes.length).toBe(0);
  });

  it('empty mag with reserve: reload is in progress and mag is still empty before magIn', () => {
    const ws = ready();
    ws.slot.mag = 0;
    run(ws, clicks([0]), AR.stats.emptyReloadTime * 0.3);
    expect(ws.phase).toBe('reload');
    expect(ws.slot.mag).toBe(0);
  });

  // SUSPECTED BUG: holding the trigger through the last round never dry-fires or auto-reloads, because
  // the empty branch requires `pressed('fire') || !triggerHeld`. The player must release and re-press.
  it('holding fire through the last round auto-reloads', () => {
    const ws = ready();
    ws.slot.mag = 3;
    const log = run(ws, hold('fire', 0, 10), 1.0);
    expect(log.shotTimes.length).toBe(3);
    expect(log.reloadStartTimes.length).toBe(1);
  });

  it('manual reload tops a partial mag up to exactly magSize; no reload when full', () => {
    const ws = ready();
    const s = AR.stats;
    ws.slot.mag = 11;
    const reserve0 = ws.slot.reserve;
    const log = run(ws, clicks([0], 'reload'), s.reloadTime + 0.2);
    expect(log.reloadStartTimes.length).toBe(1);
    expect(ws.slot.mag).toBe(s.magSize);
    expect(ws.slot.reserve).toBe(reserve0 - (s.magSize - 11));

    const full = run(ws, clicks([0], 'reload'), 0.5);
    expect(full.reloadStartTimes.length).toBe(0);
    expect(ws.phase).toBe('ready');
    expect(ws.slot.mag).toBe(s.magSize);
  });

  it('cannot fire while sprinting; first shot waits sprintOutTime after sprint ends', () => {
    const ws = ready();
    const s = AR.stats;
    const sprintEnd = 0.5;
    const log = run(ws, hold('fire', 0, 10), 1.0, (t) => ({
      ...CTX,
      sprint: t <= sprintEnd ? 1 : 0,
    }));
    expect(log.shotTimes.length).toBeGreaterThan(0);
    expect(log.shotTimes[0]).toBeGreaterThan(sprintEnd);
    const delay = log.shotTimes[0] - sprintEnd;
    expect(delay).toBeGreaterThanOrEqual(s.sprintOutTime - 2 * DT);
    expect(delay).toBeLessThanOrEqual(s.sprintOutTime + 3 * DT);
  });

  it('tac sprint uses the longer tacSprintOutTime', () => {
    const ws = ready();
    const s = AR.stats;
    const end = 0.5;
    const log = run(ws, hold('fire', 0, 10), 1.0, (t) => ({ ...CTX, sprint: t <= end ? 2 : 0 }));
    const delay = log.shotTimes[0] - end;
    expect(s.tacSprintOutTime).toBeGreaterThan(s.sprintOutTime);
    expect(delay).toBeGreaterThanOrEqual(s.tacSprintOutTime - 2 * DT);
    expect(delay).toBeLessThanOrEqual(s.tacSprintOutTime + 3 * DT);
  });

  it('swap (weapon2 / Q): swapOut -> swapIn -> ready, switches slot, no firing meanwhile', () => {
    for (const key of ['weapon2', 'swap'] as const) {
      const ws = ready();
      const total = AR.stats.swapOutTime + PISTOL.stats.swapInTime;
      const script: ScriptStep[] = [
        { t: 0, down: [key, 'fire'] },
        { t: DT * 2, down: ['fire'] },
      ];
      const log = run(ws, script, total + 0.1);
      expect(log.phases[0]).toBe('swapOut');
      const iOut = log.phases.lastIndexOf('swapOut');
      const iIn = log.phases.indexOf('swapIn');
      expect(iIn).toBe(iOut + 1);
      const iReady = log.phases.indexOf('ready');
      expect(iReady).toBeGreaterThan(iIn);
      expect((iReady + 1) * DT).toBeGreaterThanOrEqual(total - 2 * DT);
      expect((iReady + 1) * DT).toBeLessThanOrEqual(total + 3 * DT);
      expect(ws.current).toBe(1);
      expect(ws.def.id).toBe('pistol');
      expect(log.shotTimes.filter((t) => t <= iReady * DT).length).toBe(0);
    }
  });

  it('ADS reaches 1 after adsTime, is blocked while sprinting, and tightens spread', () => {
    const ws = ready();
    const s = AR.stats;
    const log = run(ws, hold('ads', 0, 10), s.adsTime + 0.1);
    const idx = Math.round(s.adsTime / DT);
    expect(log.ads[idx - 2]).toBeLessThan(1);
    expect(Math.max(...log.ads.slice(idx - 1, idx + 3))).toBeCloseTo(1, 6);
    const adsSpread = ws.spread(CTX);
    run(ws, [], 0.5); // release: back to hip
    expect(ws.ads).toBe(0);
    const hipSpread = ws.spread(CTX);
    expect(adsSpread).toBeLessThan(hipSpread);

    const sprinting = ready();
    const sl = run(sprinting, hold('ads', 0, 10), 0.6, { ...CTX, sprint: 1 });
    expect(Math.max(...sl.ads)).toBe(0);
  });

  // SUSPECTED BUG: with ads held and already at 1, `adsTarget > this.ads` is false so the else-branch
  // lowers ads by one step (1 -> 0.962), then next step raises it again: ads flickers 1, 0.962, 1, ...
  it('ADS stays at 1 while held (no flicker)', () => {
    const ws = ready();
    const log = run(ws, hold('ads', 0, 10), AR.stats.adsTime + 0.3);
    const settled = log.ads.slice(Math.round(AR.stats.adsTime / DT) + 2);
    for (const v of settled) expect(v).toBe(1);
  });

  it('recoil: a spray climbs, then partially recovers (rest folded into the view base)', () => {
    const ws = ready();
    const spray = run(ws, hold('fire', 0, 0.79), 0.8);
    expect(Math.abs(spray.shotTimes.length - 10)).toBeLessThanOrEqual(1);
    expect(ws.punchPitch.value).toBeGreaterThan(2);
    const peak = spray.peakTargetPitch;
    expect(peak).toBeGreaterThan(2);

    const after = run(ws, [], 2.0);
    const totalClimb = ws.punchPitch.value + spray.foldPitchSum + after.foldPitchSum;
    const expected = (1 - AR.stats.recoilRecovery) * peak;
    expect(Math.abs(totalClimb - expected)).toBeLessThanOrEqual(expected * 0.25);
    expect(totalClimb).toBeGreaterThan(0);
    expect(totalClimb).toBeLessThan(peak);
    expect(Math.abs(ws.punchPitch.value)).toBeLessThan(0.05);
  });

  it('recoil pattern is learnable: horizontal punch direction matches across seeds', () => {
    const trajectory = (seed: number) => {
      const ws = ready(seed);
      const ys: number[] = [];
      run(ws, hold('fire', 0, 0.79), 0.8, CTX, () => {
        if (ws.events.shots.length) ys.push(ws.punchYaw.value);
      });
      return ys;
    };
    const a = trajectory(3);
    const b = trajectory(12345);
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThanOrEqual(9);
    let same = 0;
    for (let i = 1; i < n; i++)
      if (Math.sign(a[i] - a[i - 1]) === Math.sign(b[i] - b[i - 1])) same++;
    expect(same / (n - 1)).toBeGreaterThanOrEqual(0.7);
  });

  it('damageAt applies falloff and headshot multiplier', () => {
    const ws = ready();
    const s = AR.stats;
    expect(ws.damageAt(0, false)).toBeCloseTo(s.damage);
    expect(ws.damageAt(s.falloffStart, false)).toBeCloseTo(s.damage);
    expect(ws.damageAt(s.falloffEnd, false)).toBeCloseTo(s.damage * s.minDamageMul);
    expect(ws.damageAt(s.falloffEnd + 100, false)).toBeCloseTo(s.damage * s.minDamageMul);
    const mid = (s.falloffStart + s.falloffEnd) / 2;
    expect(ws.damageAt(mid, false)).toBeCloseTo(s.damage * (1 - 0.5 * (1 - s.minDamageMul)));
    expect(ws.damageAt(0, true)).toBeCloseTo(s.damage * s.headMul);
    expect(ws.damageAt(s.falloffEnd + 1, true)).toBeCloseTo(s.damage * s.minDamageMul * s.headMul);
  });
});
