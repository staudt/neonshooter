import { describe, expect, it } from 'vitest';
import type { InputState } from '../src/core/input';
import { AR, LOADOUT } from '../src/weapons/defs';
import { WeaponSystem, type WeaponContext } from '../src/weapons/weapon';

// ADS-in time depends on movement: standing < walking < straight out of sprint < out of tac sprint.
const DT = 1 / 120;
const none: InputState = { down: new Set(), pressed: new Set(), released: new Set() };
const aim: InputState = { down: new Set(['ads']), pressed: new Set(), released: new Set() };

function timeToAds(sprintLevel: number, moveFactor: number) {
  const ws = new WeaponSystem(LOADOUT, 1);
  const ctx = (sprint: number): WeaponContext => ({
    sprint,
    grounded: true,
    mantling: false,
    moveFactor,
  });
  for (let i = 0; i < 120; i++) ws.step(DT, none, ctx(sprintLevel)); // swap-in + sprinting
  let t = 0;
  while (ws.ads < 1 && t < 2) {
    ws.step(DT, aim, ctx(0)); // the aim input ends the sprint
    t += DT;
  }
  return t;
}

describe('ADS timing', () => {
  it('is slower when moving, slower still out of a sprint, slowest out of a tac sprint', () => {
    const stand = timeToAds(0, 0);
    const walk = timeToAds(0, 1);
    const sprint = timeToAds(1, 1.4);
    const tac = timeToAds(2, 1.7);
    const s = AR.stats;
    expect(stand).toBeCloseTo(s.adsTime, 1);
    expect(walk).toBeCloseTo(s.adsTime * s.adsTimeWalkMul, 1);
    expect(sprint).toBeCloseTo(s.adsTime * s.adsTimeSprintMul, 1);
    expect(tac).toBeCloseTo(s.adsTime * s.adsTimeTacMul, 1);
    expect(stand).toBeLessThan(walk);
    expect(walk).toBeLessThan(sprint);
    expect(sprint).toBeLessThan(tac);
  });
});
