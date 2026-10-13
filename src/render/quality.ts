import { ShaderMaterial, type Material, type Scene, type WebGLRenderer } from 'three';
import { SHADER_DETAIL } from '../world/materials';

/**
 * Graphics quality: tiers + render scale, and an auto governor that steps down when the machine
 * can't keep up (only ever down, so it never oscillates). The result is remembered per browser.
 *
 * Tiers: 3 high = full post (AO, bloom, grade, SMAA) · 2 medium = no AO · 1 low = no post at all
 * (direct render, renderer tone mapping) + 1-octave noise in every procedural shader.
 */

export type Tier = 1 | 2 | 3;
export const TIER_NAMES: Record<Tier, string> = { 1: 'low', 2: 'medium', 3: 'high' };

export interface Quality {
  tier: Tier;
  /** Multiplier on the device pixel ratio (0.5..1). */
  scale: number;
}

const STORAGE_KEY = 'neon.autoQuality';
/** Auto mode steps down while the average stays below this. */
const TARGET_FPS = 45;
/** Ignore this long after start / a change (shader compiles, level load). */
const SETTLE_S = 4;
const WINDOW_S = 2.5;
const MIN_SCALE = 0.5;

/** True for CPU rasterizers (no usable GPU): SwiftShader, llvmpipe, Microsoft Basic Render, ... */
export function isSoftwareRenderer(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(
    ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

function load(): Quality | null {
  try {
    const q = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (q && [1, 2, 3].includes(q.tier) && q.scale >= MIN_SCALE && q.scale <= 1) return q;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function save(q: Quality) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
  }
}

/** Forget the auto result (e.g. after a hardware change); next load re-detects. */
export function resetAutoQuality() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Starting quality for auto mode: what this browser settled on last time, else a guess. */
export function initialAutoQuality(renderer: WebGLRenderer): Quality {
  return (
    load() ?? (isSoftwareRenderer(renderer) ? { tier: 1, scale: 0.75 } : { tier: 3, scale: 1 })
  );
}

/** Watches frame times and steps quality down when they stay too long. */
export class QualityGovernor {
  private settle = SETTLE_S;
  private acc = 0;
  private frames = 0;

  constructor(public q: Quality) {}

  /** Feed one frame. Returns the new quality when it stepped down, else null. */
  frame(dt: number): Quality | null {
    if (this.settle > 0) {
      this.settle -= dt;
      return null;
    }
    this.acc += dt;
    this.frames++;
    if (this.acc < WINDOW_S) return null;
    const fps = this.frames / this.acc;
    this.acc = this.frames = 0;
    if (fps >= TARGET_FPS) return null;
    const next = stepDown(this.q);
    if (!next) return null;
    this.q = next;
    this.settle = SETTLE_S;
    save(next);
    return next;
  }
}

/** One notch down: high → medium → low → 75% scale → 50% scale; null when at the floor. */
export function stepDown(q: Quality): Quality | null {
  if (q.tier > 1) return { tier: (q.tier - 1) as Tier, scale: q.scale };
  if (q.scale > MIN_SCALE + 1e-3) return { tier: 1, scale: Math.max(MIN_SCALE, q.scale - 0.25) };
  return null;
}

/**
 * fbm octaves in every procedural shader (surfaces, corruption, backdrop): 4 normally, 1 on low.
 * New materials pick it up from SHADER_DETAIL; existing ones are flagged to recompile once.
 */
export function applyShaderDetail(scenes: Scene[], octaves: number) {
  if (SHADER_DETAIL.octaves === octaves) return;
  SHADER_DETAIL.octaves = octaves;
  const seen = new Set<Material>();
  for (const scene of scenes)
    scene.traverse((o) => {
      const mats = (o as { material?: Material | Material[] }).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m instanceof ShaderMaterial && m.defines?.FBM_OCTAVES !== undefined)
          m.defines.FBM_OCTAVES = octaves;
        m.needsUpdate = true;
      }
    });
}
