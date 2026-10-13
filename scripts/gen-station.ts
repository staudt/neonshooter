// Generates maps/station_slice.map: the Ember Noir look slice — maintenance tunnel -> elevated metro
// station hall (platform, track bed + train, mezzanine, catwalk open to the skyline void) -> exit.
// Run: node scripts/gen-station.ts   (overwrites the file)
// Units are METERS, game space (Y-up, forward = -Z, floor top y = 0). See scripts/mapgen.ts.
import { MapBuilder } from './mapgen.ts';
import type { V3 } from './mapgen.ts';

const m = new MapBuilder();
m.worldProps = { backdrop: 'city', corruption: 0.55 };
type R = [number, number];

/** Box from ranges (any order) on each axis. */
function bx(x: R, y: R, z: R, tex = 'concrete', top?: string) {
  const s = ([a, b]: R): R => (a < b ? [a, b] : [b, a]);
  const [xs, ys, zs] = [s(x), s(y), s(z)];
  m.box([xs[0], ys[0], zs[0]], [xs[1], ys[1], zs[1]], tex, top);
}

/** Wall split into a tiled dado (below `dado`) and plain concrete above. */
function tiledWall(x: R, y: R, z: R, dado = 2.2) {
  bx(x, [y[0], dado], z, 'tile');
  bx(x, [dado, y[1]], z, 'concrete');
}

/** Wall across X (thin in Z) spanning x0..x1, minus rectangular openings [x0, x1, y0, y1]. */
function wallAcross(z: R, x: R, y: R, holes: [number, number, number, number][], tex = 'concrete') {
  // Columns between holes (full height), then above/below each hole.
  const sorted = [...holes].sort((a, b) => a[0] - b[0]);
  let cx = x[0];
  for (const [h0, h1, hy0, hy1] of sorted) {
    if (h0 > cx) bx([cx, h0], y, z, tex);
    if (hy1 < y[1]) bx([h0, h1], [hy1, y[1]], z, tex);
    if (hy0 > y[0]) bx([h0, h1], [y[0], hy0], z, tex);
    cx = h1;
  }
  if (cx < x[1]) bx([cx, x[1]], y, z, tex);
}

const trigger = (cls: string, props: Record<string, string>, x: R, y: R, z: R) =>
  m.brushEntity(cls, props, () => bx(x, y, z, 'trigger'));

const sign = (pos: V3, angle: number, props: Record<string, string | number>) =>
  m.point('info_sign', pos, { angle, ...props });

const light = (pos: V3, color: string, intensity: number, range: number) =>
  m.point('light_point', pos, { _color: color, intensity, range });

// Facing (entity "angle"): 0 = +X, 90 = -Z (away from the start), 180 = -X, 270 = +Z (toward the start).

// --- 1. Maintenance tunnel: x ±2.5, z 1..-15, ceiling 3.6 ---------------------------------------
bx([-3.5, 3.5], [-1, 0], [1, -15], 'concrete_dark', 'concrete_floor');
tiledWall([-3.5, -2.5], [-1, 3.6], [1, -15], 1.6);
tiledWall([2.5, 3.5], [-1, 3.6], [1, -15], 1.6);
bx([-3.5, 3.5], [-1, 3.6], [0, 1]); // back wall
bx([-3.5, 3.5], [3.6, 4.6], [1, -15]); // ceiling
for (let z = -2; z > -15; z -= 4) bx([-0.7, 0.7], [3.5, 3.6], [z + 0.08, z - 0.08], 'neon_white');
bx([1.9, 2.5], [2.9, 3.3], [0, -15], 'rust'); // pipe run along the ceiling corner
bx([2.1, 2.5], [2.5, 2.75], [0, -15], 'rust');
bx([-2.5, -2.2], [0, 0.12], [0, -15], 'hazard'); // kerb strip
light([0, 3.2, -4], '0.85 0.92 1', 10, 9);
light([0, 3.2, -12], '0.85 0.92 1', 10, 9);

// --- 2. Station hall: interior x -14..12.5, z -16..-64, ceiling 10 ------------------------------
// The +X side is open to the void (skyline backdrop) between outer columns.
const HZ: R = [-16, -64];
// near wall (tunnel opening x ±2.5 h 3.6; track portal x 4..10)
wallAcross(
  [-15, -16],
  [-15, 12.5],
  [-1, 10],
  [
    [-2.5, 2.5, 0, 3.6],
    [4, 10, -1.3, 3.8],
  ],
);
// far wall (exit x -6..-2 h 3.5; track portal)
wallAcross(
  [-64, -65],
  [-15, 12.5],
  [-1, 10],
  [
    [-6, -2, 0, 3.5],
    [4, 10, -1.3, 3.8],
  ],
);
// track tunnels behind the portals: pitch black
bx([3.5, 10.5], [-2, 4.5], [-13, -14], 'black');
bx([3.5, 10.5], [-2, 4.5], [-66, -67], 'black');
bx([3.5, 4], [-2, 4.5], [-14, -15], 'black');
bx([10, 10.5], [-2, 4.5], [-14, -15], 'black');
bx([3.5, 4], [-2, 4.5], [-65, -66], 'black');
bx([10, 10.5], [-2, 4.5], [-65, -66], 'black');
bx([3.5, 10.5], [3.8, 4.5], [-14, -15], 'black');
bx([3.5, 10.5], [3.8, 4.5], [-65, -66], 'black');
// left wall + ceiling
tiledWall([-15, -14], [-1, 10], HZ, 3);
// roof over the platform; over the tracks + catwalk only beams: the burning sky shows through
bx([-15, 4], [10, 11], [-15, -65]);
for (let z = -15; z >= -65; z -= 4) bx([4, 13.7], [10, 11], [z + 0.3, z - 0.3], 'concrete_dark');
bx([3.6, 4.4], [9.4, 11], [-15, -65], 'concrete_dark'); // roof edge girder
bx([3.95, 4.05], [9.3, 9.4], [-15, -65], 'neon_red');

// platform floor with a hazard edge, track bed, catwalk
bx([-15, 3.4], [-1, 0], [-15, -65], 'concrete_dark', 'concrete_floor');
bx([3.4, 4], [-1, 0], [-15, -65], 'concrete_dark', 'hazard');
bx([4, 10], [-2, -1.3], [-13, -67], 'concrete_dark', 'grate');
for (const x of [5.6, 8.25]) bx([x, x + 0.15], [-1.3, -1.15], [-13, -67], 'metal');
bx([10, 12.5], [-1, 0], [-15, -65], 'concrete_dark', 'grate');
bx([12.3, 12.42], [0, 1.1], HZ, 'metal'); // railing
bx([12.42, 12.6], [0, 10], HZ, 'clip'); // keeps the player in
// outer columns (run down into the void: the station is elevated) + fascias
for (let z = -16; z >= -64; z -= 8) bx([12.5, 13.7], [-40, 10], [z + 0.6, z - 0.6]);
bx([12.5, 13.7], [8.6, 11], [-15, -65], 'concrete_dark');
bx([12.5, 13.7], [-3, 0], [-15, -65], 'concrete_dark');
bx([12.45, 12.5], [0.9, 1.0], HZ, 'neon_white'); // railing light line

// train on the tracks (cover; roof reachable from the utility box)
bx([5.3, 8.7], [-1.3, -0.9], [-26.4, -45.6], 'black');
bx([4.8, 9.2], [-0.9, 2.7], [-26, -46], 'train', 'metal');
for (let z = -27; z > -45; z -= 2.2) {
  bx([4.74, 4.8], [0.9, 1.7], [z, z - 1.5], 'window_lit');
  bx([9.2, 9.26], [0.9, 1.7], [z, z - 1.5], 'window_lit');
}
bx([4.74, 4.8], [-0.4, -0.3], [-26, -46], 'neon_red'); // underglow strip
bx([2.4, 3.8], [0, 1.4], [-34, -36], 'metal'); // utility box -> train roof

// mezzanine on the left: slab at 4.5, stair up from the near end, support pillars
bx([-14, -8], [4, 4.5], [-30, -60], 'concrete_dark', 'concrete_floor');
bx([-8.15, -8], [4.5, 5.6], [-30, -60], 'concrete_dark'); // railing
bx([-8.05, -8], [3.9, 4.0], [-30, -60], 'neon_white');
for (let i = 0; i < 18; i++) {
  const z0 = -22.8 - i * 0.4;
  bx([-14, -11], [0, (i + 1) * 0.25], [z0, z0 - 0.4], 'concrete', 'concrete_floor');
}
for (const z of [-36, -48, -59]) bx([-8.6, -7.4], [0, 4], [z + 0.6, z - 0.6]);

// platform columns, turnstiles, benches
for (const z of [-28, -40, -52]) {
  bx([-3.6, -2.4], [0, 10], [z + 0.6, z - 0.6]);
  bx([-2.42, -2.4], [0.5, 8], [z + 0.1, z - 0.1], 'neon_white');
}
for (let x = -9; x < -3; x += 0.9) bx([x, x + 0.3], [0, 1.05], [-19.2, -19.8], 'metal');
bx([-6.5, -4.5], [0, 0.45], [-36, -36.8], 'concrete_dark');
bx([-6.5, -4.5], [0, 0.45], [-44, -44.8], 'concrete_dark');

// ceiling light runs (with dead segments)
for (const x of [-10, -3, 2]) {
  for (let z = -18; z > -62; z -= 6) {
    if ((x === -3 && z === -36) || (x === 2 && z === -48)) continue;
    bx([x - 0.1, x + 0.1], [9.9, 10], [z, z - 5], 'neon_white');
  }
}

// corruption creeping in from the far end
bx([-6.6, -1.4], [0, 0.02], [-60, -64], 'hellcrack');
bx([-6.6, -1.4], [3.5, 5.5], [-63.98, -64], 'hellcrack');
bx([-14, -13.98], [0, 6], [-57, -64], 'hellcrack');

// --- 3. Exit corridor + stage end -----------------------------------------------------------------
m.brushEntity('func_door', { targetname: 'door_exit', move: '0 0 112', speed: 160 }, () => {
  bx([-6, -2], [0, 3.5], [-64.2, -64.8], 'rust');
  bx([-6, -2], [1.7, 1.8], [-64.1, -64.2], 'neon_red');
});
bx([-7, -1], [-1, 0], [-64, -76], 'concrete_dark', 'concrete_floor');
bx([-7, -6], [-1, 3.5], [-65, -76], 'hellcrack');
bx([-2, -1], [-1, 3.5], [-65, -76], 'hellcrack');
bx([-7, -1], [3.5, 4.5], [-65, -76], 'concrete_dark');
bx([-7, -1], [-1, 3.5], [-75, -76], 'hellcrack');
trigger('trigger_stage_end', {}, [-6, -2], [0, 3], [-70, -74]);

// --- encounter --------------------------------------------------------------------------------------
trigger(
  'trigger_encounter',
  { targetname: 'enc_hall', target: 'door_exit' },
  [-14, 4],
  [0, 4],
  [-16, -22],
);
const enemy = (cls: string, pos: V3, wave: number) =>
  m.point(cls, pos, { encounter: 'enc_hall', wave, angle: 270 });
enemy('enemy_drone', [7, 5, -40], 0);
enemy('enemy_drone', [4, 6, -52], 0);
enemy('enemy_drone', [10, 4.5, -56], 0);
enemy('enemy_grunt', [-11, 4.5, -48], 0);
enemy('enemy_grunt', [-5, 0, -58], 0);
enemy('enemy_grunt', [-11, 4.5, -56], 1);
enemy('enemy_grunt', [1, 0, -60], 1);
enemy('enemy_grunt', [11, 0, -54], 1);
enemy('enemy_drone', [8, 6.5, -30], 1);
enemy('enemy_drone', [0, 7, -46], 1);

// --- flow -------------------------------------------------------------------------------------------
m.point('info_player_start', [0, 0.01, -3], { angle: 90 });
m.point('info_checkpoint', [0, 0.01, -3], { targetname: 'cp_start', angle: 90 });

// --- lights: cold human light in the hall, hell red at the far end --------------------------------
light([-6, 6, -24], '0.8 0.9 1', 26, 22);
light([1, 6, -38], '0.8 0.9 1', 26, 22);
light([-6, 6, -50], '0.75 0.85 1', 22, 20);
light([-11, 7.5, -40], '0.2 0.85 0.9', 18, 14); // ad wash (teal)
light([-4, 2.5, -61], '1 0.18 0.08', 22, 14);
light([-4, 2.2, -70], '1 0.15 0.05', 20, 12);

// --- signs ------------------------------------------------------------------------------------------
sign([-2.47, 1.9, -8], 0, {
  text: 'HUMANITY|STILL|BLEEDS',
  style: 'graffiti',
  width: 2.6,
  height: 1.6,
});
sign([1.5, 1.8, -6], 180, { text: '← MAINTENANCE', style: 'metro', width: 2, height: 0.45 }); // right wall
sign([0, 3.1, -14.9], 270, {
  text: 'PLATFORM 2|City Loop · North Spire',
  style: 'metro',
  width: 3.2,
  height: 0.9,
  arrow: 'left',
});
sign([-13.97, 7.2, -45], 0, {
  text: 'KORVEX|A CLEANER TOMORROW',
  style: 'ad',
  width: 7,
  height: 3.2,
});
sign([-4, 6.8, -63.97], 270, {
  text: 'SAME FLESH|DIFFERENT GODS',
  style: 'ad_red',
  width: 6,
  height: 2.4,
});
sign([-12.5, 5.2, -22.3], 270, { text: 'TO SKYBRIDGE ↑', style: 'metro', width: 2.4, height: 0.5 });
sign([-4, 4.1, -63.97], 270, {
  text: 'TRANSIT TO LOWER LEVELS|Market · Hab Blocks · Reclamation',
  style: 'metro',
  width: 3.6,
  height: 0.8,
  arrow: 'right',
});
for (const z of [-28, -40, -52])
  sign([-2.39, 3.2, z], 0, { text: '2', style: 'metro_badge', width: 0.7, height: 0.7 });
sign([-3.6 - 0.01, 1.6, -40], 180, {
  text: 'THEY ARE|STILL US',
  style: 'graffiti',
  width: 1.1,
  height: 0.9,
});
sign([2.0, 0.01, -46], 0, { text: 'MIND THE GAP', style: 'floor', width: 2.4, height: 0.5 });

m.write('maps/station_slice.map', 'Generated by scripts/gen-station.ts — Ember Noir look slice.');
