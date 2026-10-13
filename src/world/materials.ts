import { Color, MeshStandardMaterial, type Material } from 'three';
import { FALLBACK_MATERIAL, PALETTE, paletteEntry, type PaletteEntry } from './palette';

const cache = new Map<string, Material>();

function create(entry: PaletteEntry): Material {
  return new MeshStandardMaterial({
    color: new Color(entry.color),
    roughness: entry.roughness,
    metalness: entry.metalness ?? 0,
    emissive: new Color(entry.emissive ?? 0x000000),
    emissiveIntensity: entry.emissiveIntensity ?? 0,
  });
}

/** Shared material for a palette name. Unknown names fall back to concrete. */
export function getMaterial(name: string): Material {
  let m = cache.get(name);
  if (!m) {
    m = create(paletteEntry(name) ?? PALETTE[FALLBACK_MATERIAL]);
    cache.set(name, m);
  }
  return m;
}
