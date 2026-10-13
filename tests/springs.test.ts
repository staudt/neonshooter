import { describe, expect, it } from 'vitest';
import { Spring } from '../src/core/springs';

const DT = 1 / 120;

describe('Spring', () => {
  it('converges to target', () => {
    const s = new Spring(6, 1);
    s.target = 1;
    for (let i = 0; i < 240; i++) s.step(DT);
    expect(s.value).toBeCloseTo(1, 3);
  });

  it('critically damped does not overshoot', () => {
    const s = new Spring(10, 1);
    s.target = 1;
    let max = 0;
    for (let i = 0; i < 240; i++) max = Math.max(max, s.step(DT));
    expect(max).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('underdamped impulse oscillates and settles', () => {
    const s = new Spring(8, 0.3);
    s.impulse(5);
    let crossedBelow = false;
    for (let i = 0; i < 600; i++) if (s.step(DT) < 0) crossedBelow = true;
    expect(crossedBelow).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(1e-3);
  });

  it('stays stable with very stiff springs', () => {
    const s = new Spring(200, 0.5);
    s.impulse(100);
    for (let i = 0; i < 600; i++) s.step(DT);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(1e-3);
  });
});
