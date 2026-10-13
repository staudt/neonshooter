// Generates TrenchBroom editor textures (trenchbroom/textures/*.png) + the game icon from the
// material palette, so the editor and the game always agree on material names.
// Run: node scripts/gen-textures.ts
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PALETTE, type PaletteEntry } from '../src/world/palette.ts';

const SIZE = 64;

function png(width: number, height: number, rgb: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const split = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const shade = ([r, g, b]: [number, number, number], k: number): [number, number, number] =>
  [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as [number, number, number];
// Deterministic hash noise so regenerated files are byte-identical.
const noise = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255;
};

function texel(e: PaletteEntry, x: number, y: number): [number, number, number] {
  const base = split(e.color);
  if (e.tool) return (x + y) % 16 < 8 ? base : shade(base, 0.55); // diagonal stripes
  if (e.emissive) return x < 2 || y < 2 || x > SIZE - 3 || y > SIZE - 3 ? shade(base, 0.7) : base;
  // Concrete-ish: noise + a panel seam on the border so scale is readable in the editor.
  const seam = x === 0 || y === 0 ? 0.8 : 1;
  return shade(base, seam * (0.92 + noise(x, y) * 0.12));
}

mkdirSync('trenchbroom/textures', { recursive: true });
for (const [name, entry] of Object.entries(PALETTE) as [string, PaletteEntry][]) {
  writeFileSync(`trenchbroom/textures/${name}.png`, png(SIZE, SIZE, (x, y) => texel(entry, x, y)));
}
writeFileSync(
  'trenchbroom/config/Icon.png',
  png(32, 32, (x, y) => (Math.abs(x - y) < 3 || Math.abs(31 - x - y) < 3 ? [34, 230, 255] : [12, 14, 20])),
);
console.log(`wrote ${Object.keys(PALETTE).length} textures + icon`);
