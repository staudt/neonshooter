// Shared level-building helpers for the map generators (meters, game space: Y-up, forward = -Z).
// Plain TS runnable with `node` type stripping (no enums/namespaces/parameter properties).
import type { MapBuilder, V3 } from './mapgen.ts';

export type R = [number, number];
const sorted = ([a, b]: R): R => (a < b ? [a, b] : [b, a]);

export function kit(m: MapBuilder) {
  /** Box from ranges (any order) on each axis; `top` = texture of the +Y face. */
  function bx(x: R, y: R, z: R, tex = 'concrete', top?: string) {
    const [xs, ys, zs] = [sorted(x), sorted(y), sorted(z)];
    m.box([xs[0], ys[0], zs[0]], [xs[1], ys[1], zs[1]], tex, top);
  }

  /** Wall split into a tiled dado (below `dado`) and concrete above. */
  function tiledWall(x: R, y: R, z: R, dado: number) {
    bx(x, [y[0], dado], z, 'tile');
    bx(x, [dado, y[1]], z, 'concrete');
  }

  /** Wall across X (thin in Z) minus rectangular openings [x0, x1, y0, y1]. */
  function wallAcross(
    z: R,
    x: R,
    y: R,
    holes: [number, number, number, number][],
    tex = 'concrete',
  ) {
    const hs = [...holes].sort((a, b) => a[0] - b[0]);
    let cx = x[0];
    for (const [h0, h1, hy0, hy1] of hs) {
      if (h0 > cx) bx([cx, h0], y, z, tex);
      if (hy1 < y[1]) bx([h0, h1], [hy1, y[1]], z, tex);
      if (hy0 > y[0]) bx([h0, h1], [y[0], hy0], z, tex);
      cx = h1;
    }
    if (cx < x[1]) bx([cx, x[1]], y, z, tex);
  }

  /** Stairs along -Z: `n` steps of `rise` (negative = going down) and `run`, starting at (z0, y0). */
  function stairsZ(
    x: R,
    z0: number,
    y0: number,
    rise: number,
    run: number,
    n: number,
    base: number,
  ) {
    for (let i = 0; i < n; i++) {
      const top = y0 + rise * (i + 1);
      bx(x, [base, top], [z0 - i * run, z0 - (i + 1) * run], 'concrete', 'concrete_floor');
    }
  }

  const trigger = (cls: string, props: Record<string, string>, x: R, y: R, z: R) =>
    m.brushEntity(cls, props, () => bx(x, y, z, 'trigger'));

  /** Sliding door (func_door) filling x/y/z; opens by `move` (meters, game space) */
  function door(name: string, x: R, y: R, z: R, rise: number, tex = 'rust', stripe = 'neon_red') {
    m.brushEntity(
      'func_door',
      { targetname: name, move: `0 0 ${Math.round(rise * 32)}`, speed: 160 },
      () => {
        bx(x, y, z, tex);
        const zs = sorted(z);
        const mid = (sorted(y)[0] + sorted(y)[1]) / 2;
        bx(x, [mid - 0.05, mid + 0.05], [zs[1], zs[1] + 0.05], stripe);
      },
    );
  }

  const sign = (pos: V3, angle: number, props: Record<string, string | number>) =>
    m.point('info_sign', pos, { angle, ...props });

  const light = (pos: V3, color: string, intensity: number, range: number) =>
    m.point('light_point', pos, { _color: color, intensity, range });

  /** Crowd-control cover: jersey barrier 1.1 m tall, along X or Z. */
  const barrier = (x: number, z: number, len: number, alongX = true) =>
    alongX
      ? bx([x - len / 2, x + len / 2], [0, 1.1], [z - 0.3, z + 0.3], 'concrete')
      : bx([x - 0.3, x + 0.3], [0, 1.1], [z - len / 2, z + len / 2], 'concrete');

  /** Same at an arbitrary floor height. */
  const barrierAt = (x: number, y: number, z: number, len: number, alongX = true) =>
    alongX
      ? bx([x - len / 2, x + len / 2], [y, y + 1.1], [z - 0.3, z + 0.3], 'concrete')
      : bx([x - 0.3, x + 0.3], [y, y + 1.1], [z - len / 2, z + len / 2], 'concrete');

  const crate = (x: number, y: number, z: number, s = 1.4) =>
    bx([x - s / 2, x + s / 2], [y, y + s], [z - s / 2, z + s / 2], 'metal');

  /** Corruption creeping over the floor (2 cm slab: walkable). */
  const crackFloor = (x: R, y: number, z: R) => bx(x, [y, y + 0.02], z, 'hellcrack');

  const enemy = (cls: string, pos: V3, encounter: string, wave: number) =>
    m.point(`enemy_${cls}`, pos, { encounter, wave, angle: 270 });

  return {
    bx,
    tiledWall,
    wallAcross,
    stairsZ,
    trigger,
    door,
    sign,
    light,
    barrier,
    barrierAt,
    crate,
    crackFloor,
    enemy,
  };
}
