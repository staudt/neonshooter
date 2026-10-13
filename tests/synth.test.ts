import { describe, expect, it } from 'vitest';
import { sfx, type SfxName } from '../src/audio/audio';
import { SYNTHS } from '../src/audio/synth';

const SR = 48000;
/** Expected duration bounds in seconds. */
const BOUNDS: Record<SfxName, [number, number]> = {
  ar_shot: [0.35, 0.55],
  pistol_shot: [0.2, 0.4],
  dry_fire: [0.03, 0.15],
  reload_out: [0.15, 0.6],
  reload_in: [0.08, 0.4],
  reload_chamber: [0.2, 0.6],
  swap: [0.1, 0.4],
  hitmarker: [0.02, 0.08],
  headshot: [0.1, 0.35],
  kill: [0.15, 0.5],
  impact_concrete: [0.1, 0.4],
  impact_metal: [0.15, 0.5],
  jump: [0.1, 0.4],
  land: [0.1, 0.4],
  slide: [0.4, 0.8],
  footstep: [0.05, 0.25],
  mantle: [0.2, 0.6],
};

describe('synth', () => {
  for (const name of Object.keys(SYNTHS) as SfxName[]) {
    it(`${name} renders valid, deterministic audio`, () => {
      const a = SYNTHS[name](SR, 7);
      const [lo, hi] = BOUNDS[name];
      expect(a.length / SR).toBeGreaterThanOrEqual(lo);
      expect(a.length / SR).toBeLessThanOrEqual(hi);
      let peak = 0;
      for (const v of a) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeLessThanOrEqual(0.95 + 1e-6);
      expect(peak).toBeGreaterThan(0.1);
      expect(Array.from(SYNTHS[name](SR, 7))).toEqual(Array.from(a));
    });
  }

  it('different seeds differ for noisy sounds', () => {
    expect(Array.from(SYNTHS.ar_shot(SR, 1))).not.toEqual(Array.from(SYNTHS.ar_shot(SR, 2)));
  });

  it('sfx.play is a no-op without AudioContext', () => {
    expect(() => sfx.play('ar_shot')).not.toThrow();
    expect(() => sfx.unlock()).not.toThrow();
    expect(() => sfx.play('ar_shot', { pan: 2, pitch: 1.2 })).not.toThrow();
  });
});
