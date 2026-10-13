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
}

export const PALETTE = {
  concrete: { color: 0xd8dbe0, roughness: 0.9 },
  concrete_floor: { color: 0xaeb2ba, roughness: 0.85 },
  concrete_dark: { color: 0x5a5f69, roughness: 0.8 },
  metal: { color: 0x8a9099, roughness: 0.35, metalness: 0.8 },
  black: { color: 0x15171c, roughness: 0.6 },
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
