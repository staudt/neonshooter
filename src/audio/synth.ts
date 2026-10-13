import type { SfxName } from './audio';

/** Procedural placeholder SFX. Pure DSP: mono Float32Array out, deterministic per seed. */

export type Synth = (sampleRate: number, seed: number) => Float32Array;
type Rand = () => number;

// ---------- building blocks ----------

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_PI = Math.PI * 2;
const len = (sr: number, seconds: number) => Math.max(1, Math.round(sr * seconds));

export function whiteNoise(n: number, rand: Rand): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
}

/** Cascaded one-pole low-pass (`poles` 1..4 for steeper roll-off). */
export function lowpass(x: Float32Array, sr: number, cutoff: number, poles = 1): Float32Array {
  const a = 1 - Math.exp((-TWO_PI * cutoff) / sr);
  const out = Float32Array.from(x);
  for (let p = 0; p < poles; p++) {
    let y = 0;
    for (let i = 0; i < out.length; i++) out[i] = y += a * (out[i] - y);
  }
  return out;
}

export function highpass(x: Float32Array, sr: number, cutoff: number, poles = 1): Float32Array {
  const low = lowpass(x, sr, cutoff, poles);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - low[i];
  return out;
}

/** RBJ biquad band-pass (constant 0 dB peak gain). */
export function bandpass(x: Float32Array, sr: number, freq: number, q = 1): Float32Array {
  const w = (TWO_PI * Math.min(freq, sr * 0.45)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Multiply in place by `exp(-t / tau)` after a linear attack. */
export function envelope(x: Float32Array, sr: number, tau: number, attack = 0.0005): Float32Array {
  const atk = Math.max(1, attack * sr);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] *= Math.min(1, i / atk) * Math.exp(-t / tau);
  }
  return x;
}

/** Sine sweep from f0 to f1 (exponential), exp-decaying amplitude. */
export function sweep(sr: number, dur: number, f0: number, f1: number, tau: number): Float32Array {
  const n = len(sr, dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / (dur * 0.35));
    phase += (TWO_PI * f) / sr;
    out[i] = Math.sin(phase) * Math.exp(-t / tau);
  }
  return out;
}

/** Sum of exponentially decaying sine partials: [freq, gain, tau]. */
export function partials(sr: number, dur: number, parts: [number, number, number][]): Float32Array {
  const out = new Float32Array(len(sr, dur));
  for (const [f, g, tau] of parts) {
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] += g * Math.sin(TWO_PI * f * t) * Math.exp(-t / tau);
    }
  }
  return out;
}

export function triangleSweep(sr: number, dur: number, f0: number, f1: number, tau: number) {
  const out = sweep(sr, dur, f0, f1, tau);
  // asin(sin) turns the sine sweep into a triangle with the same phase.
  for (let i = 0; i < out.length; i++) {
    const env = Math.exp(-i / sr / tau);
    out[i] = (2 / Math.PI) * Math.asin(Math.max(-1, Math.min(1, out[i] / env))) * env;
  }
  return out;
}

export function softClip(x: Float32Array, drive = 1.5): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive);
  return x;
}

/** Add `layer` into `dst` starting at `offsetSec`. */
export function mixInto(
  dst: Float32Array,
  layer: Float32Array,
  sr: number,
  offsetSec: number,
  gain: number,
) {
  const start = Math.round(offsetSec * sr);
  const end = Math.min(dst.length, start + layer.length);
  for (let i = start; i < end; i++) dst[i] += layer[i - start] * gain;
}

/** Cheap Schroeder-style reverb (4 feedback combs + 2 allpass), added to the dry signal. */
export function reverb(x: Float32Array, sr: number, wet: number, decay = 0.6): Float32Array {
  const out = Float32Array.from(x);
  const combTimes = [0.0297, 0.0371, 0.0411, 0.0437];
  const acc = new Float32Array(x.length);
  for (const ct of combTimes) {
    const d = len(sr, ct);
    const buf = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      buf[i] = x[i] + (i >= d ? buf[i - d] * decay : 0);
      acc[i] += buf[i] * 0.25;
    }
  }
  let sig = acc;
  for (const [t, g] of [
    [0.005, 0.5],
    [0.0017, 0.5],
  ]) {
    const d = len(sr, t);
    const next = new Float32Array(sig.length);
    for (let i = 0; i < sig.length; i++) {
      const delayed = i >= d ? next[i - d] : 0;
      const dIn = i >= d ? sig[i - d] : 0;
      next[i] = -g * sig[i] + dIn + g * delayed;
    }
    sig = next;
  }
  for (let i = 0; i < out.length; i++) out[i] += sig[i] * wet;
  return out;
}

/** Scale so the peak is `peak` and fade the last few ms to avoid clicks. */
export function normalize(x: Float32Array, sr: number, peak = 0.95): Float32Array {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  const g = max > 0 ? peak / max : 0;
  const fade = Math.min(x.length, len(sr, 0.004));
  for (let i = 0; i < x.length; i++) {
    const tail = Math.min(1, (x.length - i) / fade);
    x[i] *= g * tail;
  }
  return x;
}

// ---------- reusable layers ----------

function noiseBurst(sr: number, rand: Rand, dur: number, tau: number, lp?: number, hp?: number) {
  let n = whiteNoise(len(sr, dur), rand);
  if (lp) n = lowpass(n, sr, lp, 2);
  if (hp) n = highpass(n, sr, hp);
  return envelope(n, sr, tau, 0.0003);
}

function bandBurst(sr: number, rand: Rand, dur: number, tau: number, f: number, q: number) {
  const n = bandpass(whiteNoise(len(sr, dur), rand), sr, f, q);
  return envelope(n, sr, tau, 0.0003);
}

/** Short bright noise click. */
function click(sr: number, rand: Rand, dur = 0.002, hp = 3000) {
  return noiseBurst(sr, rand, dur, dur * 0.6, undefined, hp);
}

/** Metallic ring: inharmonic partials with a short decay. */
function metalRing(sr: number, base: number, dur: number, tau: number) {
  return partials(sr, dur, [
    [base, 1, tau],
    [base * 1.504, 0.6, tau * 0.8],
    [base * 2.31, 0.45, tau * 0.6],
    [base * 3.17, 0.3, tau * 0.45],
  ]);
}

function render(sr: number, dur: number, build: (out: Float32Array) => void) {
  const out = new Float32Array(len(sr, dur));
  build(out);
  return normalize(out, sr);
}

// ---------- sounds ----------

function gunshot(sr: number, seed: number, p: GunParams) {
  const rand = mulberry32(seed);
  return render(sr, p.dur, (out) => {
    mixInto(out, click(sr, rand, 0.0025, p.clickHp), sr, 0, p.click);
    mixInto(out, noiseBurst(sr, rand, 0.12, p.bodyTau, p.bodyLp, 150), sr, 0, p.body);
    mixInto(out, sweep(sr, 0.1, p.thumpHi, p.thumpLo, 0.028), sr, 0, p.thump);
    mixInto(out, metalRing(sr, p.ringHz, 0.12, 0.018), sr, 0.001, p.ring);
    mixInto(out, bandBurst(sr, rand, p.dur, p.tailTau, p.tailHz, 0.7), sr, 0.006, p.tail);
    softClip(out, p.drive);
    const wet = reverb(out, sr, p.verb, 0.55);
    out.set(wet.subarray(0, out.length));
    softClip(out, 1.1);
  });
}

interface GunParams {
  dur: number;
  click: number;
  clickHp: number;
  body: number;
  bodyTau: number;
  bodyLp: number;
  thump: number;
  thumpHi: number;
  thumpLo: number;
  ring: number;
  ringHz: number;
  tail: number;
  tailTau: number;
  tailHz: number;
  drive: number;
  verb: number;
}

const arShot: Synth = (sr, seed) =>
  gunshot(sr, seed, {
    dur: 0.45,
    click: 0.9,
    clickHp: 3500,
    body: 1.2,
    bodyTau: 0.022,
    bodyLp: 2800,
    thump: 1.1,
    thumpHi: 140,
    thumpLo: 45,
    ring: 0.12,
    ringHz: 1900,
    tail: 0.28,
    tailTau: 0.11,
    tailHz: 700,
    drive: 1.8,
    verb: 0.18,
  });

const pistolShot: Synth = (sr, seed) =>
  gunshot(sr, seed, {
    dur: 0.3,
    click: 1.1,
    clickHp: 4500,
    body: 1.1,
    bodyTau: 0.014,
    bodyLp: 5000,
    thump: 0.5,
    thumpHi: 200,
    thumpLo: 80,
    ring: 0.2,
    ringHz: 2600,
    tail: 0.2,
    tailTau: 0.07,
    tailHz: 1200,
    drive: 1.6,
    verb: 0.12,
  });

const dryFire: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.08, (out) => {
    mixInto(out, click(sr, rand, 0.002, 2500), sr, 0, 0.8);
    mixInto(out, metalRing(sr, 3100, 0.06, 0.008), sr, 0, 0.5);
    mixInto(out, bandBurst(sr, rand, 0.05, 0.01, 1800, 2), sr, 0, 0.4);
  });
};

/** Plastic/metal clack: click + low-mid knock + short ring. */
function clack(sr: number, rand: Rand, ringHz: number, knockHz: number): Float32Array {
  const out = new Float32Array(len(sr, 0.12));
  mixInto(out, click(sr, rand, 0.002, 2000), sr, 0, 0.8);
  mixInto(out, sweep(sr, 0.05, knockHz * 1.5, knockHz, 0.012), sr, 0, 0.9);
  mixInto(out, metalRing(sr, ringHz, 0.1, 0.012), sr, 0, 0.35);
  mixInto(out, bandBurst(sr, rand, 0.04, 0.008, 2200, 1.5), sr, 0, 0.4);
  return out;
}

const reloadOut: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.35, (out) => {
    const scrape = bandBurst(sr, rand, 0.16, 0.07, 1400, 1.2);
    for (let i = 0; i < scrape.length; i++) scrape[i] *= 0.6 + 0.4 * Math.sin((i / sr) * 220);
    mixInto(out, scrape, sr, 0, 0.5);
    mixInto(out, clack(sr, rand, 1700, 220), sr, 0.17, 1);
  });
};

const reloadIn: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.2, (out) => {
    mixInto(out, bandBurst(sr, rand, 0.05, 0.02, 1000, 1), sr, 0, 0.25);
    mixInto(out, clack(sr, rand, 2100, 160), sr, 0.04, 1);
  });
};

const reloadChamber: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.4, (out) => {
    mixInto(out, clack(sr, rand, 2400, 260), sr, 0, 0.8);
    mixInto(out, bandBurst(sr, rand, 0.05, 0.015, 1200, 1), sr, 0.1, 0.2);
    mixInto(out, clack(sr, rand, 1800, 180), sr, 0.2, 1);
  });
};

const swap: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.25, (out) => {
    mixInto(out, bandBurst(sr, rand, 0.12, 0.05, 900, 0.8), sr, 0, 0.5);
    mixInto(out, click(sr, rand, 0.002, 2500), sr, 0.03, 0.5);
    mixInto(out, metalRing(sr, 2800, 0.1, 0.01), sr, 0.03, 0.2);
    mixInto(out, clack(sr, rand, 2000, 200), sr, 0.12, 0.6);
  });
};

const hitmarker: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.04, (out) => {
    mixInto(out, bandBurst(sr, rand, 0.03, 0.006, 4200, 2.5), sr, 0, 1);
    mixInto(out, click(sr, rand, 0.001, 5000), sr, 0, 0.6);
  });
};

const headshot: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.2, (out) => {
    mixInto(out, bandBurst(sr, rand, 0.03, 0.006, 4200, 2.5), sr, 0, 0.9);
    mixInto(
      out,
      partials(sr, 0.16, [
        [2500, 1, 0.04],
        [5020, 0.25, 0.02],
      ]),
      sr,
      0.003,
      0.7,
    );
  });
};

const kill: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.3, (out) => {
    mixInto(out, sweep(sr, 0.2, 180, 55, 0.07), sr, 0, 1);
    mixInto(out, noiseBurst(sr, rand, 0.06, 0.015, 1500), sr, 0, 0.5);
    mixInto(out, bandBurst(sr, rand, 0.03, 0.006, 4200, 2.5), sr, 0.02, 0.7);
  });
};

const impactConcrete: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.25, (out) => {
    mixInto(out, sweep(sr, 0.08, 160, 70, 0.025), sr, 0, 0.8);
    mixInto(out, noiseBurst(sr, rand, 0.04, 0.01, 1800), sr, 0, 0.8);
    const grit = noiseBurst(sr, rand, 0.2, 0.05, 6000, 1200);
    for (let i = 0; i < grit.length; i++) grit[i] *= rand() < 0.35 ? 1 : 0.2;
    mixInto(out, grit, sr, 0.005, 0.7);
  });
};

const impactMetal: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.35, (out) => {
    mixInto(out, click(sr, rand, 0.002, 3000), sr, 0, 0.6);
    mixInto(
      out,
      partials(sr, 0.33, [
        [1230, 1, 0.09],
        [1870, 0.7, 0.07],
        [2960, 0.5, 0.05],
        [4410, 0.35, 0.035],
        [6130, 0.2, 0.02],
      ]),
      sr,
      0,
      0.5,
    );
    mixInto(out, sweep(sr, 0.05, 140, 90, 0.02), sr, 0, 0.3);
  });
};

const jump: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.25, (out) => {
    const n = bandpass(whiteNoise(len(sr, 0.25), rand), sr, 700, 0.8);
    for (let i = 0; i < n.length; i++) {
      const t = i / sr;
      n[i] *= Math.sin(Math.PI * Math.min(1, t / 0.25)) ** 2 * (1 - t * 2);
    }
    mixInto(out, n, sr, 0, 1);
  });
};

const land: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.22, (out) => {
    mixInto(out, noiseBurst(sr, rand, 0.15, 0.04, 600), sr, 0, 1);
    mixInto(out, sweep(sr, 0.12, 110, 45, 0.04), sr, 0, 0.9);
  });
};

const slide: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.6, (out) => {
    const n = bandpass(whiteNoise(len(sr, 0.6), rand), sr, 1500, 0.6);
    for (let i = 0; i < n.length; i++) {
      const t = i / sr;
      n[i] *= Math.min(1, t / 0.03) * Math.exp(-t / 0.3) * (0.8 + 0.2 * Math.sin(t * 90));
    }
    mixInto(out, n, sr, 0, 1);
  });
};

const footstep: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.12, (out) => {
    mixInto(out, noiseBurst(sr, rand, 0.08, 0.02, 700), sr, 0, 0.8);
    mixInto(out, sweep(sr, 0.07, 120, 60, 0.02), sr, 0, 0.7);
    mixInto(out, click(sr, rand, 0.002, 1500), sr, 0, 0.15);
  });
};

const mantle: Synth = (sr, seed) => {
  const rand = mulberry32(seed);
  return render(sr, 0.4, (out) => {
    const cloth = bandBurst(sr, rand, 0.2, 0.08, 800, 0.7);
    mixInto(out, cloth, sr, 0, 0.6);
    mixInto(out, noiseBurst(sr, rand, 0.08, 0.02, 900), sr, 0.12, 0.9);
    mixInto(out, sweep(sr, 0.1, 130, 55, 0.035), sr, 0.12, 0.9);
  });
};

export const SYNTHS: Record<SfxName, Synth> = {
  ar_shot: arShot,
  pistol_shot: pistolShot,
  dry_fire: dryFire,
  reload_out: reloadOut,
  reload_in: reloadIn,
  reload_chamber: reloadChamber,
  swap,
  hitmarker,
  headshot,
  kill,
  impact_concrete: impactConcrete,
  impact_metal: impactMetal,
  jump,
  land,
  slide,
  footstep,
  mantle,
};
