/**
 * Material palette: the single source of truth for material names. TrenchBroom textures
 * (scripts/gen-textures.ts) and runtime materials (materials.ts) are both generated from it.
 * Map texture name == key here. No imports, so plain Node can load it.
 */
export interface PaletteEntry {
  color: number;
  roughness: number;
  metalness?: number;
  /** Emissive strips: rendered unlit-bright, feeds bloom. */
  emissive?: number;
  emissiveIntensity?: number;
  /** Tool textures: never rendered. */
  tool?: 'clip' | 'trigger' | 'skip';
  /**
   * Procedural surface treatment (materials.ts): world-space detail layered on the flat color, so
   * brushes need no UV work. Omitted = plain.
   */
  style?: SurfaceStyle;
}

export type SurfaceStyle =
  | 'concrete' // mottling + grime toward the floor + vertical streaks
  | 'floor' // concrete + wet puddles (low roughness) that mirror the emissives in bloom
  | 'tile' // metro tiles: grout grid, chipped, dirty
  | 'metal' // panel seams + rust bleed
  | 'rust' // corroded metal
  | 'grate' // floor grating (dark gaps)
  | 'hazard' // tactile yellow strip (dots)
  | 'panel' // painted train/vehicle body: big panels, grime
  | 'hellcrack'; // corruption: dark flesh-rock with glowing veins (emissive mask)

// Ember Noir: everything desaturated except hell red and a few cold lights.
export const PALETTE = {
  concrete: { color: 0xa9a7a2, roughness: 0.92, style: 'concrete' },
  concrete_floor: { color: 0x7d7b77, roughness: 0.8, style: 'floor' },
  concrete_dark: { color: 0x4a4947, roughness: 0.85, style: 'concrete' },
  metal: { color: 0x6c7075, roughness: 0.45, metalness: 0.75, style: 'metal' },
  black: { color: 0x0c0c0e, roughness: 0.7 },
  tile: { color: 0xc4c3ba, roughness: 0.3, style: 'tile' },
  rust: { color: 0x5e4232, roughness: 0.75, metalness: 0.35, style: 'rust' },
  grate: { color: 0x3b3d40, roughness: 0.5, metalness: 0.8, style: 'grate' },
  hazard: { color: 0xb8921e, roughness: 0.65, style: 'hazard' },
  train: { color: 0x8d9298, roughness: 0.4, metalness: 0.55, style: 'panel' },
  // dim crimson: the world's corruption must never out-glow the demons (they burn orange)
  hellcrack: {
    color: 0x1a0d0b,
    roughness: 0.6,
    emissive: 0xb0160a,
    emissiveIntensity: 2,
    style: 'hellcrack',
  },
  window_lit: { color: 0xa9c4d6, roughness: 1, emissive: 0x9fc2dc, emissiveIntensity: 0.9 },
  neon_red: { color: 0xff2a14, roughness: 1, emissive: 0xff2a14, emissiveIntensity: 5 },
  neon_cyan: { color: 0x22e6ff, roughness: 1, emissive: 0x22e6ff, emissiveIntensity: 4 },
  neon_magenta: { color: 0xff2bd6, roughness: 1, emissive: 0xff2bd6, emissiveIntensity: 4 },
  neon_orange: { color: 0xff7a1a, roughness: 1, emissive: 0xff7a1a, emissiveIntensity: 4 },
  neon_white: { color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 3 },
  clip: { color: 0x9b4dff, roughness: 1, tool: 'clip' },
  trigger: { color: 0xff9f1a, roughness: 1, tool: 'trigger' },
  skip: { color: 0x2a2a2a, roughness: 1, tool: 'skip' },
} satisfies Record<string, PaletteEntry>;

export type MaterialName = keyof typeof PALETTE;

/** Used when a map references a texture that isn't in the palette. */
export const FALLBACK_MATERIAL: MaterialName = 'concrete';

export function paletteEntry(name: string): PaletteEntry | undefined {
  return (PALETTE as Record<string, PaletteEntry>)[name];
}
