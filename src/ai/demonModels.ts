import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { corruptionMaterial } from '../fx/corruption';
import { ball, box, cone, cylY, geo, type HitVolumes, type RobotMaterials } from './models';

/**
 * Placeholder demon bodies built from primitives on joint hierarchies (no rig), animated
 * procedurally. Stand-ins until the CC0 rigged models land: keep the same joint names / `hit` /
 * `mats` shape and the AI won't care what's underneath. Feet at y = 0, facing -Z.
 */

const HELL_EYES = 0xff3a0a;

function demonMats(skinColor: number): RobotMaterials {
  return {
    hull: corruptionMaterial({ color: skinColor, veins: 1, scale: 6 }),
    joint: corruptionMaterial({ color: 0x3a302a, veins: 0.2, scale: 9, roughness: 0.45 }),
    glow: new MeshStandardMaterial({
      color: 0x330800,
      emissive: HELL_EYES,
      emissiveIntensity: 3,
      roughness: 0.4,
    }),
  };
}

const capsule = (r: number, len: number, m: MeshStandardMaterial) =>
  new Mesh(
    geo(`cap${r},${len}`, () => new CapsuleGeometry(r, len, 4, 10)),
    m,
  );

/** Group at a position (a joint). */
function joint(x: number, y: number, z: number, parent: Group) {
  const g = new Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Root-space position of a node (for hit volumes). */
function rootSpace(root: Group, node: Group | Mesh) {
  root.updateMatrixWorld(true);
  return root.worldToLocal(node.getWorldPosition(new Vector3()));
}

// ---------------------------------------------------------------------------------------------
// Possessed: a corrupted human. Hunched, long clawed arms, bone spikes out of the back.

export interface Limb {
  upper: Group;
  lower: Group;
}

export interface PossessedModel {
  root: Group;
  body: Group;
  spine: Group;
  neck: Group;
  head: Group;
  jaw: Group;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  mats: RobotMaterials;
  hit: HitVolumes;
}

export function buildPossessed(): PossessedModel {
  const mats = demonMats(0x241612);
  const { hull: skin, joint: bone, glow } = mats;
  const cloth = new MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.95 });
  const root = new Group();
  root.name = 'possessed';
  const body = joint(0, 0, 0, root);
  const hips = joint(0, 0.95, 0, body);
  hips.add(box(0.32, 0.18, 0.2, 0, 0, 0, cloth));

  const spine = joint(0, 0.08, 0, hips);
  spine.rotation.x = -0.38; // hunched forward
  const torso = capsule(0.17, 0.3, skin);
  torso.position.y = 0.26;
  torso.scale.set(1.15, 1, 0.8);
  spine.add(torso);
  spine.add(box(0.3, 0.16, 0.22, 0, 0.12, 0.01, cloth)); // rags
  spine.add(ball(0.035, 0, 0.34, -0.14, glow)); // chest sigil
  for (let i = 0; i < 3; i++) {
    const s = cone(0.03, 0.16 - i * 0.03, 0, 0.42 - i * 0.12, 0.12, bone);
    s.rotation.x = 1.1;
    spine.add(s);
  }

  const neck = joint(0, 0.5, -0.02, spine);
  neck.rotation.x = 0.45; // head up to look ahead despite the hunch
  const head = joint(0, 0.1, 0, neck);
  const skull = ball(0.12, 0, 0.02, 0, skin);
  skull.scale.set(0.9, 1.05, 1);
  head.add(skull);
  for (const sx of [-1, 1]) head.add(ball(0.022, sx * 0.045, 0.03, -0.105, glow));
  const jaw = joint(0, -0.04, 0.0, head);
  jaw.add(box(0.12, 0.04, 0.12, 0, -0.03, -0.05, skin));

  const arm = (sx: number): Limb => {
    const upper = joint(sx * 0.22, 0.44, 0, spine);
    upper.add(cylY(0.04, 0.047, 0.34, 0, -0.17, 0, skin));
    const lower = joint(0, -0.34, 0, upper);
    lower.add(cylY(0.03, 0.04, 0.32, 0, -0.16, 0, skin));
    const hand = joint(0, -0.33, 0, lower);
    for (let f = -1; f <= 1; f++) {
      const c = cone(0.012, 0.16, f * 0.03, -0.07, -0.02, bone);
      c.rotation.x = Math.PI - 0.25;
      hand.add(c);
    }
    return { upper, lower };
  };
  const leg = (sx: number): Limb => {
    const upper = joint(sx * 0.11, -0.05, 0, hips);
    upper.add(cylY(0.05, 0.065, 0.45, 0, -0.22, 0, cloth));
    const lower = joint(0, -0.45, 0, upper);
    lower.add(cylY(0.038, 0.05, 0.43, 0, -0.21, 0, skin));
    lower.add(box(0.08, 0.05, 0.18, 0, -0.44, -0.04, skin));
    return { upper, lower };
  };
  const model: PossessedModel = {
    root,
    body,
    spine,
    neck,
    head,
    jaw,
    armL: arm(-1),
    armR: arm(1),
    legL: leg(-1),
    legR: leg(1),
    mats,
    hit: {
      body: { center: new Vector3(0, 0.95, -0.06), radius: 0.27, halfHeight: 0.48 },
      core: { center: new Vector3(), radius: 0.14 },
    },
  };
  model.hit.core.center.copy(rootSpace(root, skull));
  return model;
}

/** Twitchy corrupted motion: occasional neck snaps + constant tremor (deterministic in t). */
function twitch(t: number, seed: number) {
  const k = Math.floor(t * 1.7 + seed);
  const f = t * 1.7 + seed - k;
  const h = Math.sin(k * 127.1 + seed * 31.7) * 43758.5453;
  const r = h - Math.floor(h);
  const snap = r > 0.55 && f < 0.18 ? (r - 0.75) * 2.2 : 0;
  return snap + Math.sin(t * 37 + seed) * 0.03;
}

/**
 * `gait` = stride phase (radians), `run` 0..1, `wind` 0..1 (arms back, jaw open), `swipe` 0..1
 * (claws come down through the strike).
 */
export function animatePossessed(
  m: PossessedModel,
  t: number,
  seed: number,
  gait: number,
  run: number,
  wind: number,
  swipe: number,
) {
  const s = Math.sin(gait);
  const c = Math.cos(gait);
  m.legL.upper.rotation.x = s * 0.75 * run;
  m.legR.upper.rotation.x = -s * 0.75 * run;
  m.legL.lower.rotation.x = -Math.max(0, -c) * 1.2 * run - 0.08;
  m.legR.lower.rotation.x = -Math.max(0, c) * 1.2 * run - 0.08;
  m.body.position.y = Math.abs(s) * 0.05 * run - wind * 0.06;
  m.spine.rotation.x = -0.38 - run * 0.15 - wind * 0.12 + swipe * 0.35;
  m.spine.rotation.y = s * 0.12 * run;
  // arms: dangling forward while running, flung back on the wind-up, slashing down on the swipe
  const strike = wind * (1 - swipe);
  for (const [arm, sgn] of [
    [m.armL, 1],
    [m.armR, -1],
  ] as const) {
    const swing = -s * sgn * 0.55 * run + 0.35;
    arm.upper.rotation.x = swing * (1 - wind) + strike * 2.6 + swipe * -0.2;
    arm.upper.rotation.z = sgn * (0.15 + strike * 0.35);
    arm.lower.rotation.x = 0.35 + strike * 0.9 - swipe * 0.2;
  }
  m.head.rotation.z = twitch(t, seed);
  m.head.rotation.y = twitch(t + 3.3, seed * 1.7) * 0.6;
  m.jaw.rotation.x = 0.1 + wind * 0.6 + Math.abs(Math.sin(t * 9 + seed)) * 0.05;
}

// ---------------------------------------------------------------------------------------------
// Hound: a hell-hound. Long body, spiked spine, horned skull with a hinged jaw.

export interface HoundModel {
  root: Group;
  body: Group;
  neck: Group;
  head: Group;
  jaw: Group;
  legs: Limb[]; // FL, FR, BL, BR
  tail: Group[];
  mats: RobotMaterials;
  hit: HitVolumes;
}

export function buildHound(): HoundModel {
  const mats = demonMats(0x2a120d);
  const { hull: skin, joint: bone, glow } = mats;
  const root = new Group();
  root.name = 'hound';
  const body = joint(0, 0.62, 0, root);
  const torso = capsule(0.21, 0.7, skin);
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(0.9, 1, 1.05);
  body.add(torso);
  body.add(ball(0.26, 0, 0.04, -0.3, skin)); // deep chest
  for (let i = 0; i < 5; i++) {
    const s = cone(0.035, 0.18 - Math.abs(i - 1.5) * 0.025, 0, 0.24, -0.38 + i * 0.17, bone);
    s.rotation.x = 0.9;
    body.add(s);
  }
  const neck = joint(0, 0.1, -0.52, body);
  neck.rotation.x = 0.25;
  const neckMesh = cylY(0.1, 0.13, 0.22, 0, 0, -0.05, skin);
  neckMesh.rotation.x = 1.1;
  neck.add(neckMesh);
  const head = joint(0, 0.06, -0.17, neck);
  const skull = ball(0.14, 0, 0, 0, skin);
  skull.scale.set(0.9, 0.85, 1.2);
  head.add(skull);
  head.add(box(0.14, 0.09, 0.22, 0, -0.03, -0.18, skin)); // snout
  for (const sx of [-1, 1]) {
    head.add(ball(0.026, sx * 0.075, 0.04, -0.12, glow));
    const horn = cone(0.03, 0.2, sx * 0.08, 0.1, 0.06, bone);
    horn.rotation.set(-1.1, 0, -sx * 0.4);
    head.add(horn);
  }
  for (let i = 0; i < 4; i++) {
    const tooth = cone(0.012, 0.05, (i - 1.5) * 0.03, -0.08, -0.27, bone);
    tooth.rotation.x = Math.PI;
    head.add(tooth);
  }
  const jaw = joint(0, -0.06, -0.05, head);
  jaw.add(box(0.12, 0.035, 0.22, 0, -0.02, -0.12, skin));

  const leg = (x: number, z: number): Limb => {
    const upper = joint(x, -0.04, z, body);
    upper.add(cylY(0.05, 0.07, 0.32, 0, -0.16, 0, skin));
    const lower = joint(0, -0.32, 0, upper);
    lower.add(cylY(0.03, 0.045, 0.3, 0, -0.15, 0, skin));
    lower.add(box(0.07, 0.04, 0.11, 0, -0.3, -0.03, bone));
    return { upper, lower };
  };
  const legs = [leg(-0.14, -0.36), leg(0.14, -0.36), leg(-0.14, 0.36), leg(0.14, 0.36)];
  const tail: Group[] = [];
  let parent = joint(0, 0.06, 0.48, body);
  parent.rotation.x = -0.6;
  for (let i = 0; i < 4; i++) {
    const seg = joint(0, 0, i === 0 ? 0 : 0.13, parent);
    const piece = cylY(0.035 - i * 0.007, 0.04 - i * 0.007, 0.14, 0, 0, 0.065, i % 2 ? bone : skin);
    piece.rotation.x = Math.PI / 2;
    seg.add(piece);
    tail.push(seg);
    parent = seg;
  }
  const model: HoundModel = {
    root,
    body,
    neck,
    head,
    jaw,
    legs,
    tail,
    mats,
    hit: {
      body: { center: new Vector3(0, 0.62, 0), radius: 0.3, halfHeight: 0.08 },
      core: { center: new Vector3(), radius: 0.15 },
      extra: [
        { center: new Vector3(0, 0.66, -0.36), radius: 0.3 },
        { center: new Vector3(0, 0.62, 0.38), radius: 0.27 },
      ],
    },
  };
  model.hit.core.center.copy(rootSpace(root, skull));
  return model;
}

/**
 * `gait` stride phase, `run` 0..1, `crouch` 0..1 (pounce wind-up), `air` 0..1 (mid-pounce: legs
 * stretched), `bite` 0..1 (jaw).
 */
export function animateHound(
  m: HoundModel,
  t: number,
  seed: number,
  gait: number,
  run: number,
  crouch: number,
  air: number,
  bite: number,
) {
  const gallop = 1 - air;
  const phases = [0, 0.35, Math.PI * 0.9, Math.PI * 0.9 + 0.35];
  m.legs.forEach((l, i) => {
    const s = Math.sin(gait + phases[i]);
    const front = i < 2;
    l.upper.rotation.x =
      s * 0.8 * run * gallop + (front ? 0.9 : -0.8) * air - crouch * (front ? 0.4 : -0.5);
    l.lower.rotation.x =
      (front ? 1 : -1) * Math.max(0, Math.cos(gait + phases[i])) * 0.9 * run * gallop +
      (front ? 0.6 : -0.9) * crouch +
      (front ? -0.3 : 0.2) * air;
  });
  m.body.position.y = 0.62 + Math.sin(gait * 2) * 0.04 * run - crouch * 0.22 + air * 0.05;
  m.body.rotation.x = Math.sin(gait) * 0.08 * run - crouch * 0.12 + air * 0.08;
  m.neck.rotation.x = 0.25 - crouch * 0.35 + run * 0.15;
  m.head.rotation.z = twitch(t, seed) * 0.4;
  m.jaw.rotation.x = 0.06 + bite * 0.7 + crouch * 0.3 + Math.abs(Math.sin(t * 11 + seed)) * 0.04;
  m.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * (4 + run * 6) + seed - i * 0.6) * 0.25;
    seg.rotation.x = i === 0 ? 0 : 0.15 + air * -0.1;
  });
}
