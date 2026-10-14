// Generates maps/stage1.map — STAGE 1 · DESCENT. Maintenance tunnel → Platform 2 hall (enc 1) →
// stairs down into the open-air Market (enc 2) → ramp up to Skybridge 7 over the void (enc 3) →
// Cathedral plaza under the hell-spire (enc 4, finale) → the breach (stage end).
// Run: node scripts/gen-stage1.ts   (overwrites the file)
// Units are METERS, game space (Y-up, forward = -Z). See scripts/mapgen.ts and scripts/kit.ts.
import { MapBuilder } from './mapgen.ts';
import type { V3 } from './mapgen.ts';
import { kit } from './kit.ts';

const m = new MapBuilder();
// the spire stands ahead and to the right: its red light rakes the hall's open side and the bridge
m.worldProps = { backdrop: 'city', corruption: 0.65, spire_angle: 35, message: 'STAGE 1 · DESCENT' };
const {
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
} = kit(m);

// Facing (entity "angle"): 0 = +X, 90 = -Z (deeper into the stage), 180 = -X, 270 = +Z (back toward the start).

// =================================================================================================
// A. Maintenance tunnel (spawn): x ±2.5, z 1..-15, ceiling 3.6
bx([-3.5, 3.5], [-1, 0], [1, -15], 'concrete_dark', 'concrete_floor');
tiledWall([-3.5, -2.5], [-1, 3.6], [1, -15], 1.6);
tiledWall([2.5, 3.5], [-1, 3.6], [1, -15], 1.6);
bx([-3.5, 3.5], [-1, 3.6], [0, 1]);
bx([-3.5, 3.5], [3.6, 4.6], [1, -15]);
for (let z = -2; z > -15; z -= 4) bx([-0.7, 0.7], [3.5, 3.6], [z + 0.08, z - 0.08], 'neon_white');
bx([1.9, 2.5], [2.9, 3.3], [0, -15], 'rust');
bx([-2.5, -2.2], [0, 0.12], [0, -15], 'hazard');
m.point('light_point', [0, 3.2, -8], { _color: '0.85 0.92 1', intensity: 14, range: 12, style: 'flicker' });
sign([-2.47, 1.9, -8], 0, {
  text: 'HUMANITY|STILL|BLEEDS',
  style: 'graffiti',
  width: 2.6,
  height: 1.6,
});
sign([0, 3.1, -14.9], 270, {
  text: 'PLATFORM 2|City Loop · North Spire',
  style: 'metro',
  width: 3.2,
  height: 0.9,
  arrow: 'left',
});

// =================================================================================================
// B. Platform 2 hall: interior x -14..12.5, z -16..-64, roof 10; open to the void on +X
const HZ: [number, number] = [-16, -64];
wallAcross(
  [-15, -16],
  [-15, 12.5],
  [-1, 10],
  [
    [-2.5, 2.5, 0, 3.6],
    [4, 10, -1.3, 3.8],
  ],
);
wallAcross(
  [-64, -65],
  [-15, 12.5],
  [-1, 10],
  [
    [-6, -2, 0, 3.5],
    [4, 10, -1.3, 3.8],
  ],
);
for (const z of [-13.5, -66.5]) bx([3.5, 10.5], [-2, 4.5], [z - 0.5, z + 0.5], 'black');
tiledWall([-15, -14], [-1, 10], HZ, 3);
bx([-15, 4], [10, 11], [-15, -65]);
for (let z = -15; z >= -65; z -= 4) bx([4, 13.7], [10, 11], [z + 0.3, z - 0.3], 'concrete_dark');
bx([3.6, 4.4], [9.4, 11], [-15, -65], 'concrete_dark');
bx([3.95, 4.05], [9.3, 9.4], [-15, -65], 'neon_red');
bx([-15, 3.4], [-1, 0], [-15, -65], 'concrete_dark', 'concrete_floor');
bx([3.4, 4], [-1, 0], [-15, -65], 'concrete_dark', 'hazard');
bx([4, 10], [-2, -1.3], [-13, -67], 'concrete_dark', 'grate');
for (const x of [5.6, 8.25]) bx([x, x + 0.15], [-1.3, -1.15], [-13, -67], 'metal');
bx([10, 12.5], [-1, 0], [-15, -65], 'concrete_dark', 'grate');
bx([12.3, 12.42], [0, 1.1], HZ, 'metal');
bx([12.42, 12.6], [0, 10], HZ, 'clip');
for (let z = -16; z >= -64; z -= 8) bx([12.5, 13.7], [-40, 10], [z + 0.6, z - 0.6]);
bx([12.5, 13.7], [8.6, 11], [-15, -65], 'concrete_dark');
bx([12.5, 13.7], [-3, 0], [-15, -65], 'concrete_dark');
bx([12.45, 12.5], [0.9, 1.0], HZ, 'neon_white');
// train (cover) + utility box to its roof
bx([5.3, 8.7], [-1.3, -0.9], [-26.4, -45.6], 'black');
bx([4.8, 9.2], [-0.9, 2.7], [-26, -46], 'train', 'metal');
for (let z = -27; z > -45; z -= 2.2) {
  bx([4.74, 4.8], [0.9, 1.7], [z, z - 1.5], 'window_lit');
  bx([9.2, 9.26], [0.9, 1.7], [z, z - 1.5], 'window_lit');
}
bx([4.74, 4.8], [-0.4, -0.3], [-26, -46], 'neon_red');
bx([2.4, 3.8], [0, 1.4], [-34, -36], 'metal');
// mezzanine + stair + supports
bx([-14, -8], [4, 4.5], [-30, -60], 'concrete_dark', 'concrete_floor');
bx([-8.15, -8], [4.5, 5.6], [-30, -60], 'concrete_dark');
bx([-8.05, -8], [3.9, 4.0], [-30, -60], 'neon_white');
stairsZ([-14, -11], -22.8, 0, 0.25, 0.4, 18, 0);
for (const z of [-36, -48, -59]) bx([-8.6, -7.4], [0, 4], [z + 0.6, z - 0.6]);
// columns, turnstiles, benches, lights
for (const z of [-28, -40, -52]) {
  bx([-3.6, -2.4], [0, 10], [z + 0.6, z - 0.6]);
  bx([-2.42, -2.4], [0.5, 8], [z + 0.1, z - 0.1], 'neon_white');
  sign([-2.39, 3.2, z], 0, { text: '2', style: 'metro_badge', width: 0.7, height: 0.7 });
}
for (let x = -9; x < -3; x += 0.9) bx([x, x + 0.3], [0, 1.05], [-19.2, -19.8], 'metal');
bx([-6.5, -4.5], [0, 0.45], [-36, -36.8], 'concrete_dark');
bx([-6.5, -4.5], [0, 0.45], [-44, -44.8], 'concrete_dark');
for (const x of [-10, -3, 2])
  for (let z = -18; z > -62; z -= 6) {
    if ((x === -3 && z === -36) || (x === 2 && z === -48)) continue;
    bx([x - 0.1, x + 0.1], [9.9, 10], [z, z - 5], 'neon_white');
  }
crackFloor([-6.6, -1.4], 0, [-60, -64]);
bx([-6.6, -1.4], [3.5, 5.5], [-63.98, -64], 'hellcrack');
light([-6, 6, -26], '0.8 0.9 1', 26, 22);
light([0, 6, -44], '0.8 0.9 1', 24, 22);
light([-11, 7.5, -42], '0.2 0.85 0.9', 16, 14);
light([-4, 2.5, -61], '1 0.18 0.08', 20, 14);
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
sign([-4, 4.1, -63.97], 270, {
  text: 'TRANSIT TO LOWER LEVELS|Market · Hab Blocks · Reclamation',
  style: 'metro',
  width: 3.6,
  height: 0.8,
  arrow: 'right',
});
sign([-12.5, 5.2, -22.3], 270, { text: 'MEZZANINE ↑', style: 'metro', width: 2.4, height: 0.5 });
sign([-3.6 - 0.01, 1.6, -40], 180, {
  text: 'THEY ARE|STILL US',
  style: 'graffiti',
  width: 1.1,
  height: 0.9,
});
sign([2.0, 0.01, -46], 0, { text: 'MIND THE GAP', style: 'floor', width: 2.4, height: 0.5 });

trigger(
  'trigger_encounter',
  { targetname: 'enc_platform', target: 'door_platform' },
  [-14, 4],
  [0, 4],
  [-16, -22],
);
enemy('possessed', [-6, 0, -58], 'enc_platform', 0);
enemy('possessed', [-1, 0, -61], 'enc_platform', 0);
enemy('possessed', [-11, 4.5, -56], 'enc_platform', 0);
enemy('drone', [7, 5, -40], 'enc_platform', 0);
enemy('drone', [4, 6, -54], 'enc_platform', 0);
enemy('hound', [-8, 0, -61], 'enc_platform', 1);
enemy('hound', [0, 0, -62], 'enc_platform', 1);
enemy('possessed', [-12, 4.5, -58], 'enc_platform', 1);
enemy('possessed', [-4, 0, -62], 'enc_platform', 1);
enemy('drone', [8, 6.5, -30], 'enc_platform', 1);
door('door_platform', [-6, -2], [0, 3.5], [-64.2, -64.8], 3.5);

// =================================================================================================
// C. Exit corridor (checkpoint) + stairs down to the market (y -6)
bx([-7, -1], [-1, 0], [-64, -72], 'concrete_dark', 'concrete_floor');
bx([-7, -6], [-1, 3.5], [-65, -72], 'hellcrack');
bx([-2, -1], [-1, 3.5], [-65, -72], 'hellcrack');
bx([-7, -1], [3.5, 4.5], [-65, -72], 'concrete_dark');
stairsZ([-6, -2], -72, 0, -0.25, 1 / 3, 24, -7);
bx([-7, -6], [-7, 4], [-72, -80]);
bx([-2, -1], [-7, 4], [-72, -80]);
trigger('trigger_checkpoint', { target: 'cp_corridor' }, [-6, -2], [0, 3], [-66, -70]);
// top of the stairs: something waits below
trigger('trigger_once', { target: 'market_growl', message: 'Something is moving down there…', delay: '0.4' }, [-6, -2], [0, 3], [-71, -72.5]);
m.point('target_sound', [0, -4, -110], { targetname: 'market_growl', sound: 'demon_growl', volume: 1.6 });
m.point('info_checkpoint', [-4, 0.01, -67], { targetname: 'cp_corridor', angle: 90 });
light([-4, 2.2, -68], '1 0.15 0.05', 12, 9);

// =================================================================================================
// D. The Market: open-air street canyon, floor y -6, x -20..16, z -80..-128
const Y = -6;
bx([-21, 17], [Y - 1, Y], [-79, -129], 'concrete_dark', 'concrete_floor');
wallAcross([-79, -80], [-21, 17], [Y - 1, 10], [[-6, -2, Y, 4]]);
wallAcross([-128, -129], [-21, 17], [Y - 1, 10], [[-3, 3, Y, -1]]);
// facades: tiled shop level, concrete above, lit windows up high
for (const [x0, x1, face] of [
  [-21, -20, -19.97],
  [16, 17, 15.97],
] as const) {
  tiledWall([x0, x1], [Y - 1, 10], [-80, -128], Y + 3.2);
  const wx = face < 0 ? x1 + 0.03 : x0 - 0.03;
  for (let z = -84; z > -126; z -= 5)
    for (const y of [0.5, 3, 5.5])
      if ((z * 7 + y * 3) % 4 > 1.2)
        bx([wx - 0.03, wx + 0.03], [y, y + 1.2], [z, z - 2.4], 'window_lit');
  // awnings over the shopfronts
  const ax: [number, number] = face < 0 ? [x1, x1 + 1.6] : [x0 - 1.6, x0];
  for (let z = -86; z > -126; z -= 9) bx(ax, [Y + 3.0, Y + 3.15], [z, z - 6], 'rust');
}
// west balcony (y -1) with stairs up from the street
bx([-20, -16], [Y + 4.5, Y + 5], [-90, -122], 'concrete_dark', 'concrete_floor');
bx([-16.15, -16], [Y + 5, Y + 6.1], [-90, -122], 'metal');
bx([-16.05, -16], [Y + 4.4, Y + 4.5], [-90, -122], 'neon_red');
stairsZ([-20, -17], -83, Y, 0.25, 0.35, 20, Y);
for (const z of [-98, -110, -121])
  bx([-16.6, -15.6], [Y, Y + 4.5], [z + 0.5, z - 0.5], 'concrete_dark');
// street cover: stalls, a burnt bus, barriers, crates
for (const [x, z] of [
  [-11, -92],
  [9, -96],
  [-4, -106],
  [6, -116],
] as const) {
  bx([x - 1.2, x + 1.2], [Y, Y + 1.0], [z - 0.6, z + 0.6], 'rust', 'metal');
  bx([x - 1.5, x + 1.5], [Y + 2.2, Y + 2.3], [z - 1, z + 1], 'train');
  for (const sx of [-1.35, 1.35])
    bx([x + sx - 0.05, x + sx + 0.05], [Y + 1, Y + 2.2], [z - 0.05, z + 0.05], 'metal');
}
bx([-1.6, 0.6], [Y + 0.3, Y + 2.9], [-94, -105], 'rust', 'rust'); // burnt bus
bx([-1.4, 0.4], [Y, Y + 0.3], [-95, -104], 'black');
bx([-1.62, -1.58], [Y + 1.6, Y + 2.2], [-95, -104], 'black');
barrierAt(10, Y, -106, 3);
barrierAt(-9, Y, -118, 3);
barrierAt(12, Y, -122, 2.5, false);
crate(-14, Y, -100);
crate(-14, Y + 1.4, -100, 1.2);
crate(13, Y, -88);
crackFloor([-8, -2], Y, [-112, -126]);
crackFloor([4, 12], Y, [-120, -127]);
bx([-3, 3], [Y + 5, Y + 9], [-127.97, -128], 'hellcrack');
// cables + signs over the street
for (const z of [-90, -104, -117]) bx([-20, 16], [3.9, 4.0], [z - 0.03, z + 0.03], 'black');
sign([15.96, -1.2, -100], 180, {
  text: 'KORVEX CLINIC|Your body. Our upgrade.',
  style: 'ad',
  width: 6,
  height: 2.6,
});
sign([-19.96, 1.4, -114], 0, {
  text: 'THE SPIRE|CALLS YOU HOME',
  style: 'ad_red',
  width: 6,
  height: 2.4,
});
sign([-19.98, -4.2, -95], 0, {
  text: 'WE WERE|WARNED',
  style: 'graffiti',
  width: 2.6,
  height: 1.5,
});
sign([15.98, -4.4, -112], 180, {
  text: "DON'T|LOOK UP",
  style: 'graffiti',
  width: 2.2,
  height: 1.4,
});
sign([0, -0.6, -127.97], 270, {
  text: 'SKYBRIDGE 7|Cathedral District',
  style: 'metro',
  width: 3.4,
  height: 0.85,
});
sign([-4, 1.2, -79.97], 90, { text: 'MARKET LEVEL', style: 'metro', width: 2.6, height: 0.5 });
light([-10, Y + 3.5, -92], '1 0.62 0.28', 45, 22);
light([8, Y + 3.5, -108], '1 0.62 0.28', 45, 22);
light([-6, Y + 3.5, -118], '1 0.55 0.25', 35, 18);
light([0, Y + 3, -125], '1 0.2 0.08', 30, 16);

trigger(
  'trigger_encounter',
  { targetname: 'enc_market', target: 'door_market' },
  [-20, 16],
  [Y, Y + 4],
  [-81, -86],
);
for (const p of [
  [-8, Y, -120],
  [2, Y, -124],
  [10, Y, -118],
  [-14, Y, -124],
] as V3[])
  enemy('possessed', p, 'enc_market', 0);
enemy('grunt', [-18, Y + 5, -112], 'enc_market', 0);
enemy('grunt', [12, Y, -125], 'enc_market', 0);
for (const p of [
  [-6, Y, -125],
  [6, Y, -125],
  [0, Y, -120],
] as V3[])
  enemy('hound', p, 'enc_market', 1);
enemy('drone', [-6, 1, -110], 'enc_market', 1);
enemy('drone', [8, 2, -100], 'enc_market', 1);
for (const p of [
  [-12, Y, -125],
  [-2, Y, -126],
  [8, Y, -126],
  [-18, Y + 5, -120],
] as V3[])
  enemy('possessed', p, 'enc_market', 2);
enemy('drone', [0, 2, -115], 'enc_market', 2);
enemy('drone', [10, 1, -95], 'enc_market', 2);
enemy('hound', [4, Y, -124], 'enc_market', 2);
door('door_market', [-3, 3], [Y, -1], [-128.2, -128.8], 5);

// =================================================================================================
// E. Landing (checkpoint) + ramp up to the bridge (y 0)
bx([-4, 4], [Y - 1, Y], [-129, -131], 'concrete_dark', 'concrete_floor');
m.ramp(-3, 3, Y, -131, -143, 6, 'concrete_floor');
bx([-3, 3], [Y - 3, Y], [-131, -143], 'concrete_dark');
bx([-4, -3], [Y - 1, 3], [-129, -143], 'concrete_dark');
bx([3, 4], [Y - 1, 3], [-129, -143], 'concrete_dark');
trigger('trigger_checkpoint', { target: 'cp_ramp' }, [-3, 3], [Y, Y + 3], [-129.4, -131]);
// halfway up the ramp: stragglers burst out of the market behind you (ambush, not an encounter)
trigger('trigger_once', { target: 'ramp_ambush', delay: '0.3' }, [-3, 3], [-4, 1], [-135, -137]);
m.point('enemy_possessed', [-4, Y, -123], { targetname: 'ramp_ambush', angle: 90 });
m.point('enemy_possessed', [5, Y, -124], { targetname: 'ramp_ambush', angle: 90 });
m.point('target_sound', [0, Y + 1, -124], { targetname: 'ramp_ambush', sound: 'possessed_shriek', volume: 1.4 });
m.point('info_checkpoint', [0, Y + 0.01, -130.2], { targetname: 'cp_ramp', angle: 90 });

// =================================================================================================
// F. Skybridge 7: deck x ±3.2, z -143..-192, over the void
bx([-3.2, 3.2], [-1, 0], [-143, -192], 'concrete_dark', 'grate');
for (const s of [-1, 1]) {
  bx([s * 3.05, s * 3.2], [0, 1.1], [-143, -192], 'metal');
  bx([s * 3.2, s * 3.4], [0, 8], [-143, -192], 'clip');
  bx([s * 3.02, s * 3.05], [1.0, 1.04], [-143, -192], 'window_lit');
}
for (let z = -147; z > -190; z -= 8) {
  for (const s of [-1, 1]) bx([s * 3.2, s * 3.6], [-1, 6.5], [z + 0.25, z - 0.25], 'concrete_dark');
  bx([-3.6, 3.6], [6, 6.6], [z + 0.25, z - 0.25], 'concrete_dark');
  bx([-3.2, 3.2], [5.95, 6], [z + 0.06, z - 0.06], 'neon_red');
}
for (const z of [-157, -177]) bx([-2, 2], [-80, -1], [z + 1, z - 1], 'concrete_dark'); // pylons
barrier(-1.75, -158, 2.5);
barrier(1.75, -168, 2.5);
bx([-1.2, 2.6], [0, 2.8], [-176, -183], 'train', 'metal'); // tram wreck
for (let z = -177; z > -183; z -= 2) bx([-1.26, -1.2], [1.2, 1.9], [z, z - 1.3], 'window_lit');
sign([0, 0.01, -150], 90, { text: 'NO STOPPING', style: 'floor', width: 3, height: 0.6 });
light([0, 5.4, -160], '0.75 0.85 1', 14, 14);
light([0, 5.4, -186], '1 0.25 0.1', 16, 14);

trigger(
  'trigger_encounter',
  { targetname: 'enc_bridge', target: 'door_bridge' },
  [-3, 3],
  [0, 4],
  [-144, -149],
);
for (const p of [
  [-9, 3, -160],
  [9, 4, -166],
  [-8, 6, -174],
  [10, 2.5, -180],
] as V3[])
  enemy('drone', p, 'enc_bridge', 0);
enemy('drone', [-10, 5, -186], 'enc_bridge', 1);
enemy('drone', [10, 6, -150], 'enc_bridge', 1);
enemy('hound', [-1.5, 0, -189], 'enc_bridge', 1);
enemy('hound', [1.5, 0, -189], 'enc_bridge', 1);
enemy('hound', [0, 0, -186], 'enc_bridge', 1);

// =================================================================================================
// G. Cathedral plaza (finale): x -18..18, z -193..-237, y 0, roofless under the spire
wallAcross([-192, -193], [-19, 19], [-1, 12], [[-3.2, 3.2, 0, 5]]);
door('door_bridge', [-3.2, 3.2], [0, 5], [-192.2, -192.8], 5);
bx([-19, 19], [-1, 0], [-193, -238], 'concrete_dark', 'concrete_floor');
for (const [x0, x1] of [
  [-19, -18],
  [18, 19],
] as const) {
  bx([x0, x1], [-1, 6], [-193, -237]);
  bx([x0, x1], [6, 12], [-193, -237], 'hellcrack');
}
wallAcross([-237, -238], [-19, 19], [-1, 12], [[-3, 3, 0, 5]], 'hellcrack');
// terraces with steps, the corrupted monument on its plinth, broken columns
for (const s of [-1, 1]) {
  const x0 = s * 18;
  const x1 = s * 11;
  bx([x0, x1], [0, 1.5], [-200, -230], 'concrete', 'concrete_floor');
  for (let i = 0; i < 5; i++) {
    const a = s * (11 - i * 0.4);
    const b = s * (11 - (i + 1) * 0.4);
    bx([a, b], [0, 1.25 - i * 0.25], [-205, -210], 'concrete', 'concrete_floor');
  }
  barrierAt(s * 12, 1.5, -222, 3, false);
}
bx([-3, 3], [0, 0.8], [-211, -217.4], 'concrete_dark', 'concrete_floor');
bx([-1.2, 1.2], [0.8, 8.5], [-213, -215.4], 'hellcrack');
for (const [x, z, h] of [
  [-7, -204, 6],
  [7, -205, 8.5],
  [-7, -226, 9],
  [7, -227, 5],
] as const)
  bx([x - 0.7, x + 0.7], [0, h], [z - 0.7, z + 0.7]);
crackFloor([-6, 6], 0, [-218, -236]);
crackFloor([-16, -8], 0, [-196, -200]);
crackFloor([9, 15], 1.5, [-212, -228]);
sign([0, 7.2, -236.96], 270, {
  text: 'SAME FLESH|DIFFERENT GODS',
  style: 'ad_red',
  width: 9,
  height: 3.4,
});
sign([-17.97, 3, -215], 0, { text: 'REPENT', style: 'graffiti', width: 3.2, height: 1.4 });
sign([17.97, 2.6, -205], 180, { text: 'IT SEES|US', style: 'graffiti', width: 2.4, height: 1.6 });
light([-10, 4, -205], '1 0.25 0.1', 40, 24);
light([10, 4, -226], '1 0.25 0.1', 40, 24);
m.point('light_point', [0, 9.5, -214], { _color: '1 0.12 0.03', intensity: 40, range: 26, style: 'pulse' });

m.point('target_sound', [0, 6, -214], { targetname: 'plaza_scream', sound: 'demon_death', volume: 1.8 });
trigger('trigger_checkpoint', { target: 'cp_plaza' }, [-3, 3], [0, 3], [-193.2, -195]);
m.point('info_checkpoint', [0, 0.01, -194], { targetname: 'cp_plaza', angle: 90 });
trigger(
  'trigger_encounter',
  {
    targetname: 'enc_plaza',
    target: 'door_breach',
    start_target: 'plaza_scream',
    message: 'IT KNOWS YOU ARE HERE',
  },
  [-18, 18],
  [0, 4],
  [-196, -200],
);
for (const p of [
  [-5, 0, -230],
  [0, 0, -233],
  [5, 0, -230],
] as V3[])
  enemy('possessed', p, 'enc_plaza', 0);
enemy('hound', [-10, 0, -231], 'enc_plaza', 0);
enemy('hound', [10, 0, -231], 'enc_plaza', 0);
enemy('grunt', [-15, 1.5, -224], 'enc_plaza', 0);
enemy('grunt', [15, 1.5, -218], 'enc_plaza', 0);
for (const p of [
  [-8, 5, -220],
  [0, 7, -226],
  [8, 5, -212],
] as V3[])
  enemy('drone', p, 'enc_plaza', 1);
for (const p of [
  [-14, 1.5, -228],
  [14, 1.5, -228],
  [0, 0, -234],
] as V3[])
  enemy('possessed', p, 'enc_plaza', 1);
enemy('hound', [-6, 0, -234], 'enc_plaza', 2);
enemy('hound', [6, 0, -234], 'enc_plaza', 2);
for (const p of [
  [-12, 0, -232],
  [-3, 0, -235],
  [3, 0, -235],
  [12, 0, -232],
] as V3[])
  enemy('possessed', p, 'enc_plaza', 2);
enemy('drone', [-10, 6, -230], 'enc_plaza', 2);
enemy('drone', [10, 6, -230], 'enc_plaza', 2);
door('door_breach', [-3, 3], [0, 5], [-237.2, -237.8], 5, 'hellcrack', 'neon_white');

// =================================================================================================
// H. The breach (stage end)
bx([-4, 4], [-1, 0], [-238, -250], 'concrete_dark', 'hellcrack');
bx([-4, -3], [-1, 5], [-238, -250], 'hellcrack');
bx([3, 4], [-1, 5], [-238, -250], 'hellcrack');
bx([-4, 4], [5, 6], [-238, -250], 'hellcrack');
bx([-4, 4], [-1, 5], [-249, -250], 'hellcrack');
light([0, 3, -244], '1 0.15 0.05', 18, 12);
trigger('trigger_stage_end', {}, [-3, 3], [0, 3], [-242, -248]);

// --- flow ------------------------------------------------------------------------------------------
m.point('info_player_start', [0, 0.01, -3], { angle: 90 });
m.point('info_checkpoint', [0, 0.01, -3], { targetname: 'cp_start', angle: 90 });

m.write('maps/stage1.map', 'Generated by scripts/gen-stage1.ts — STAGE 1 · DESCENT.');
