// Generates maps/arena_test.map: a combat test stage (spawn room -> corridor -> arena A -> checkpoint
// room -> arena B -> stage-end room). Run: node scripts/gen-arena.ts   (overwrites the file)
// Units are METERS, game space (Y-up, forward = -Z, floor top y = 0). See scripts/mapgen.ts.
import { MapBuilder } from './mapgen.ts';
import type { V3 } from './mapgen.ts';

const m = new MapBuilder();
type R = [number, number];

/** Box from ranges (any order) on each axis. */
function bx(x: R, y: R, z: R, tex = 'concrete', top?: string) {
  const s = ([a, b]: R): R => (a < b ? [a, b] : [b, a]);
  const [xs, ys, zs] = [s(x), s(y), s(z)];
  m.box([xs[0], ys[0], zs[0]], [xs[1], ys[1], zs[1]], tex, top);
}

const floor = (x: R, z: R) => bx(x, [-1, 0], z, 'concrete_dark', 'concrete_floor');

/** Wall across X (thin in Z) spanning x ±half, with a centered opening (width ow, height oh). */
function wallWithOpening(z: R, half: number, h: number, ow: number, oh: number) {
  const o = ow / 2;
  bx([-half, -o], [-1, h], z);
  bx([o, half], [-1, h], z);
  bx([-o, o], [oh, h], z);
}

/** Wall across X with no opening. */
const wallSolid = (z: R, half: number, h: number) => bx([-half, half], [-1, h], z);

/** Side walls (x beyond ±half, 1 m thick) over a z range. */
function sideWalls(half: number, z: R, h: number, thick = 1) {
  bx([-half - thick, -half], [-1, h], z);
  bx([half, half + thick], [-1, h], z);
}

/** Ramp rising toward +Z: low at zLow (far), height h at zHigh (zHigh > zLow). */
function rampUp(x0: number, x1: number, zLow: number, zHigh: number, h: number) {
  m.convex(
    [
      [x0, 0, zLow],
      [x1, 0, zLow],
      [x0, 0, zHigh],
      [x1, 0, zHigh],
      [x0, h, zHigh],
      [x1, h, zHigh],
    ] as V3[],
    [
      [0, 1, 3],
      [2, 3, 5],
      [0, 1, 5],
      [0, 2, 4],
      [1, 3, 5],
    ],
    'concrete_floor',
  );
}

/** Crate (1.5 m cube) centered at x,z with its base at y. */
const crate = (x: number, z: number, y = 0) =>
  bx([x - 0.75, x + 0.75], [y, y + 1.5], [z - 0.75, z + 0.75], 'metal');

const pillar = (x: number, z: number) => bx([x - 0.6, x + 0.6], [0, 6], [z - 0.6, z + 0.6]);

const door = (name: string, z: R) =>
  m.brushEntity('func_door', { targetname: name, move: '0 0 128', speed: 192 }, () => {
    bx([-2.5, 2.5], [0, 4], z, 'metal');
    // thin orange stripe protruding 5 cm toward the arena (near side, higher z)
    const zNear = Math.max(z[0], z[1]);
    bx([-2.5, 2.5], [1.9, 2.1], [zNear - 0.1, zNear + 0.05], 'neon_orange');
  });

const trigger = (cls: string, props: Record<string, string>, x: R, y: R, z: R) =>
  m.brushEntity(cls, props, () => bx(x, y, z, 'trigger'));

// --- 1. Spawn room: x ±6, z 0..-12, ceiling 5 ---------------------------------------------------
floor([-7, 7], [1, -13]);
sideWalls(6, [1, -13], 5);
wallSolid([0, 1], 7, 5);
wallWithOpening([-12, -13], 7, 5, 5, 4);
bx([-7, 7], [5, 6], [1, -13]); // ceiling

// --- 2. Corridor: x ±2.5, z -12..-24, 4 m tall -------------------------------------------------
floor([-3.5, 3.5], [-12, -24]);
sideWalls(2.5, [-12, -24], 4);
bx([-3.5, 3.5], [4, 5], [-12, -24]);
bx([-2.5, -2.45], [3.7, 3.8], [-12, -24], 'neon_cyan');
bx([2.45, 2.5], [3.7, 3.8], [-12, -24], 'neon_cyan');

// --- 3. Arena A: x ±20, z -24..-64, walls 8 m, open sky -----------------------------------------
floor([-21, 21], [-23, -65]);
sideWalls(20, [-23, -65], 8);
wallWithOpening([-24, -23], 21, 8, 5, 4); // entrance
wallWithOpening([-64, -65], 21, 8, 5, 4); // exit (filled by door_a)
door('door_a', [-65, -64]);

for (const s of [-1, 1]) {
  // 2 m platform x 14..20, z -34..-54
  bx([s * 14, s * 20], [0, 2], [-34, -54], 'concrete', 'concrete_floor');
  bx([s * 13.95, s * 14], [1.85, 1.95], [-34, -54], 'neon_magenta'); // trim on the inner edge
  // ramp up from the near end (4 m run for 2 m rise: 26.6 deg)
  m.ramp(Math.min(s * 14, s * 20), Math.max(s * 14, s * 20), 0, -30, -34, 2);
  // staircase from the far end: 7 steps of 0.25 rise / 0.35 run, then the platform
  for (let i = 0; i < 7; i++) {
    const zf = -54 - i * 0.35;
    bx([s * 14, s * 20], [0, 1.75 - i * 0.25], [zf, zf - 0.35], 'concrete', 'concrete_floor');
  }
}

for (const [x, z] of [
  [-10, -37],
  [10, -37],
  [-10, -46],
  [10, -46],
] as R[])
  pillar(x, z);

// crouch cover: 1.1 m tall, 4 m long
bx([-8, -4], [0, 1.1], [-32.4, -32]);
bx([4, 8], [0, 1.1], [-32.4, -32]);
bx([-2, 2], [0, 1.1], [-52.4, -52]);

// crates, some stacked to 3 m
crate(-11, -27);
crate(12, -27);
crate(12, -27, 1.5);
crate(-12, -60);
crate(-12, -60, 1.5);
crate(12, -60);

// central block 6x6x3 with 1.4 m ledges (near side and +x side)
bx([-3, 3], [0, 3], [-41, -47], 'concrete', 'concrete_floor');
bx([-1.5, 1.5], [0, 1.4], [-39.5, -41], 'concrete', 'concrete_floor');
bx([3, 4.5], [0, 1.4], [-42, -46], 'concrete', 'concrete_floor');

// encounter trigger over the entrance
trigger(
  'trigger_encounter',
  { targetname: 'enc_a', target: 'door_a' },
  [-20, 20],
  [0, 4],
  [-24, -29],
);

// --- 4. Corridor + checkpoint room B: x ±6, z -65..-80, ceiling 5 -------------------------------
floor([-7, 7], [-64, -80]);
sideWalls(6, [-64, -80], 5);
bx([-7, 7], [5, 6], [-64, -80]);
trigger('trigger_checkpoint', { target: 'cp_b' }, [-6, 6], [0, 3], [-66, -68]);

// --- 5. Arena B: x ±16, z -80..-112, walls 9 m, open sky ----------------------------------------
floor([-17, 17], [-79, -113]);
sideWalls(16, [-79, -113], 9);
wallWithOpening([-79, -80], 17, 9, 5, 4); // entrance (from room B)
wallWithOpening([-112, -113], 17, 9, 5, 4); // exit (filled by door_b)
door('door_b', [-113, -112]);

for (const s of [-1, 1]) {
  const xs: R = [s * 11, s * 16];
  // balcony at 3.5 m; stairs at the near end, ramp at the far end
  bx(xs, [0, 3.5], [-85.05, -105.5], 'concrete', 'concrete_floor');
  bx([s * 10.95, s * 11.1], [3.5, 4.5], [-85.05, -105.5], 'concrete_dark'); // 1 m railing (thin)
  bx([s * 10.9, s * 10.95], [4.2, 4.3], [-85.05, -105.5], 'neon_magenta');
  for (let i = 0; i < 13; i++) {
    const zf = -80.5 - i * 0.35;
    bx(xs, [0, (i + 1) * 0.25], [zf, zf - 0.35], 'concrete', 'concrete_floor');
  }
  rampUp(Math.min(xs[0], xs[1]), Math.max(xs[0], xs[1]), -112, -105.5, 3.5);
}

pillar(-6, -90);
pillar(6, -90);
crate(0, -93);
crate(-3, -98);
crate(3.5, -98);
crate(3.5, -98, 1.5);

trigger(
  'trigger_encounter',
  { targetname: 'enc_b', target: 'door_b' },
  [-16, 16],
  [0, 4],
  [-80, -84],
);

// --- 6. Stage end room: x ±4, z -113..-122, ceiling 4 -------------------------------------------
floor([-5, 5], [-112, -123]);
sideWalls(4, [-112, -123], 4);
wallSolid([-122, -123], 5, 4);
bx([-5, 5], [4, 5], [-112, -123]);
trigger('trigger_stage_end', {}, [-4, 4], [0, 3], [-116, -120]);

// --- entities -----------------------------------------------------------------------------------
m.point('info_player_start', [0, 0.01, -2], { angle: 90 });
m.point('info_checkpoint', [0, 0.01, -2], { targetname: 'cp_start', angle: 90 });
m.point('info_checkpoint', [0, 0.01, -70], { targetname: 'cp_b', angle: 90 });

const enemy = (cls: string, pos: V3, encounter: string, wave: number) =>
  m.point(cls, pos, { encounter, wave, angle: 270 });

for (const p of [
  [-8, 0, -52],
  [0, 0, -58],
  [9, 0, -50],
] as V3[])
  enemy('enemy_grunt', p, 'enc_a', 0);
for (const p of [
  [-17, 2, -44],
  [17, 2, -44],
] as V3[])
  enemy('enemy_grunt', p, 'enc_a', 1);
for (const p of [
  [-6, 4, -56],
  [0, 5, -60],
  [6, 4, -56],
] as V3[])
  enemy('enemy_drone', p, 'enc_a', 1);

for (const p of [
  [-13.5, 3.5, -100],
  [13.5, 3.5, -100],
] as V3[])
  enemy('enemy_grunt', p, 'enc_b', 0);
for (const p of [
  [-4, 5, -104],
  [4, 5, -104],
] as V3[])
  enemy('enemy_drone', p, 'enc_b', 0);
for (const p of [
  [-6, 0, -106],
  [0, 0, -108],
  [6, 0, -106],
] as V3[])
  enemy('enemy_grunt', p, 'enc_b', 1);

const light = (pos: V3, color: string, intensity: number, range: number) =>
  m.point('light_point', pos, { _color: color, intensity, range });
light([0, 4, -6], '0.9 0.95 1', 18, 12);
light([0, 3.5, -18], '0.4 0.9 1', 15, 12);
light([0, 6, -32], '0.9 0.95 1', 25, 18);
light([-10, 6, -52], '1 0.5 0.9', 25, 18);
light([10, 6, -52], '0.5 0.9 1', 25, 18);
light([0, 4, -72], '0.9 0.95 1', 18, 12);
light([-8, 7, -92], '1 0.5 0.9', 28, 20);
light([8, 7, -92], '0.5 0.9 1', 28, 20);
light([0, 7, -104], '1 0.8 0.5', 28, 20);
light([0, 3, -117], '0.9 0.95 1', 18, 12);

m.write('maps/arena_test.map', 'Generated by scripts/gen-arena.ts — combat test stage.');
