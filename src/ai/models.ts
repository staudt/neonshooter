import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { corruptionMaterial } from '../fx/corruption';

/**
 * Procedural enemy robots ("neon brutalism"): light-grey hull panels, graphite joints, hot red/magenta
 * emissive accents. Geometries are shared module-wide; materials are per instance so each robot can
 * flash / pulse independently. Node-safe (no DOM).
 */
export interface RobotMaterials {
  hull: MeshStandardMaterial;
  joint: MeshStandardMaterial;
  glow: MeshStandardMaterial;
}

/** Hit volumes in the model root's local space. */
export interface HitVolumes {
  body: { center: Vector3; radius: number; halfHeight: number };
  core: { center: Vector3; radius: number };
}

export interface GruntModel {
  root: Group;
  body: Group;
  turret: Group;
  muzzle: Object3D;
  core: Mesh;
  thruster: Mesh;
  mats: RobotMaterials;
  hit: HitVolumes;
}

export interface DroneModel {
  root: Group;
  body: Group;
  /** Tentacle segment chains (root → tip), animated by animateFlyer. */
  tentacles: Object3D[][];
  jaw: Group;
  eye: Mesh;
  muzzle: Object3D;
  mats: RobotMaterials;
  hit: HitVolumes;
}

const ENEMY_RED = 0xff2b4a;
/** Hell fire: demon eyes, mouths, fireballs. */
const DEMON_FIRE = 0xff3a0a;
const PUPIL = new MeshBasicMaterial({ color: 0x000000 });

function makeMats(): RobotMaterials {
  return {
    hull: new MeshStandardMaterial({ color: 0xe2e5ea, roughness: 0.5, metalness: 0.25 }),
    joint: new MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.6, metalness: 0.5 }),
    glow: new MeshStandardMaterial({
      color: 0x330010,
      emissive: ENEMY_RED,
      emissiveIntensity: 3,
      roughness: 0.4,
    }),
  };
}

// ---- shared geometry cache ----
const geoCache = new Map<string, BufferGeometry>();
function geo<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, m: Material) {
  const mesh = new Mesh(
    geo(`box${w},${h},${d}`, () => new BoxGeometry(w, h, d)),
    m,
  );
  mesh.position.set(x, y, z);
  return mesh;
}

/** Cylinder along Y. */
function cylY(rTop: number, rBot: number, h: number, x: number, y: number, z: number, m: Material) {
  const mesh = new Mesh(
    geo(`cy${rTop},${rBot},${h}`, () => new CylinderGeometry(rTop, rBot, h, 12)),
    m,
  );
  mesh.position.set(x, y, z);
  return mesh;
}

/** Cylinder along Z. */
function cylZ(r: number, len: number, x: number, y: number, z: number, m: Material) {
  const mesh = cylY(r, r, len, x, y, z, m);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Cone along +Y (tip up), base centered at its middle. */
function cone(r: number, h: number, x: number, y: number, z: number, m: Material) {
  const mesh = new Mesh(
    geo(`co${r},${h}`, () => new ConeGeometry(r, h, 6)),
    m,
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function ball(r: number, x: number, y: number, z: number, m: Material) {
  const mesh = new Mesh(
    geo(`sp${r}`, () => new SphereGeometry(r, 16, 12)),
    m,
  );
  mesh.position.set(x, y, z);
  return mesh;
}

// ---- Grunt ----

export function buildGrunt(): GruntModel {
  const mats = makeMats();
  const { hull, joint, glow } = mats;
  const root = new Group();
  root.name = 'grunt';

  // Hover base (skirt) + thruster, below the body group.
  root.add(cylY(0.4, 0.28, 0.35, 0, 0.425, 0, hull));
  root.add(cylY(0.3, 0.3, 0.06, 0, 0.27, 0, joint));
  const thruster = cylY(0.3, 0.3, 0.02, 0, 0.17, 0, glow);
  root.add(thruster);

  const body = new Group();
  body.name = 'grunt-body';
  root.add(body);

  // Pelvis + torso
  body.add(box(0.46, 0.2, 0.36, 0, 0.7, 0, joint));
  body.add(box(0.7, 0.7, 0.5, 0, 1.2, 0, hull));
  body.add(box(0.5, 0.12, 0.52, 0, 0.9, 0, joint)); // waist band
  body.add(box(0.5, 0.5, 0.3, 0, 1.2, 0.35, joint)); // back power pack
  body.add(box(0.36, 0.06, 0.1, 0, 1.0, 0.56, glow)); // pack vent
  // Chest plates flanking the core
  body.add(box(0.2, 0.46, 0.06, -0.24, 1.25, -0.27, hull));
  body.add(box(0.2, 0.46, 0.06, 0.24, 1.25, -0.27, hull));
  body.add(box(0.5, 0.1, 0.06, 0, 1.46, -0.27, hull));
  body.add(box(0.5, 0.1, 0.06, 0, 1.04, -0.27, hull));
  // Core in a dark ring (slightly recessed)
  const ring = new Mesh(
    geo('coreRing', () => new TorusGeometry(0.18, 0.03, 8, 16)),
    joint,
  );
  ring.position.set(0, 1.25, -0.26);
  body.add(ring);
  const core = ball(0.15, 0, 1.25, -0.2, glow);
  body.add(core);
  // Shoulders
  for (const s of [-1, 1]) {
    body.add(box(0.3, 0.3, 0.42, s * 0.5, 1.45, 0, hull));
    body.add(box(0.32, 0.05, 0.3, s * 0.5, 1.62, 0, joint));
    body.add(box(0.06, 0.06, 0.3, s * 0.66, 1.45, 0, glow)); // shoulder light strip
    body.add(cylY(0.07, 0.07, 0.3, s * 0.5, 1.15, 0.0, joint)); // upper arm
    body.add(box(0.22, 0.3, 0.26, s * 0.5, 0.95, 0, hull)); // side pod
  }

  // Turret: head + right gun arm. Pivot at neck.
  const turret = new Group();
  turret.name = 'grunt-turret';
  turret.position.set(0, 1.65, 0);
  body.add(turret);
  turret.add(cylY(0.1, 0.12, 0.12, 0, 0, 0, joint)); // neck
  turret.add(box(0.38, 0.28, 0.34, 0, 0.1, 0, hull)); // head
  turret.add(box(0.42, 0.05, 0.38, 0, 0.26, 0, joint)); // brow cap
  turret.add(box(0.3, 0.06, 0.03, 0, 0.1, -0.175, glow)); // visor slit
  turret.add(cylY(0.012, 0.012, 0.25, -0.12, 0.38, 0.05, joint)); // antenna
  // Gun arm (right, +X)
  turret.add(box(0.2, 0.22, 0.4, 0.5, -0.3, -0.35, hull)); // housing
  turret.add(box(0.12, 0.1, 0.12, 0.5, -0.12, -0.2, joint)); // shoulder link
  turret.add(cylZ(0.05, 0.5, 0.5, -0.3, -0.7, joint)); // barrel
  turret.add(cylZ(0.065, 0.1, 0.5, -0.3, -0.92, glow)); // barrel tip glow ring
  turret.add(box(0.06, 0.06, 0.2, 0.5, -0.17, -0.4, glow)); // top rail light
  const muzzle = new Object3D();
  muzzle.name = 'grunt-muzzle';
  muzzle.position.set(0.5, -0.3, -0.99);
  turret.add(muzzle);

  const hit: HitVolumes = {
    body: { center: new Vector3(0, 1.0, 0), radius: 0.42, halfHeight: 0.5 },
    core: { center: core.position.clone(), radius: 0.15 },
  };
  return { root, body, turret, muzzle, core, thruster, mats, hit };
}

// ---- Drone ----

/**
 * Flying demon ("Maw"): a horned skull with a hinged jaw, a cyclops eye (weak point), a trailing
 * ribcage and four tentacles. All corruption-shader skin/bone; the eye + mouth glow is `glow`
 * (flares during the attack telegraph while the jaw opens). Built ~0.85 m wide, scaled by DRONE.scale.
 */
export function buildDrone(): DroneModel {
  const skin = corruptionMaterial({ color: 0x1a1210, veins: 1, scale: 9 });
  const bone = corruptionMaterial({ color: 0x3a302a, veins: 0.25, scale: 7, roughness: 0.45 });
  const glow = new MeshStandardMaterial({
    color: 0x330800,
    emissive: DEMON_FIRE,
    emissiveIntensity: 3,
    roughness: 0.4,
  });
  const mats: RobotMaterials = { hull: skin, joint: bone, glow };
  const root = new Group();
  root.name = 'drone';
  const body = new Group();
  body.name = 'drone-body';
  root.add(body);

  // cranium + brow + cheekbones
  const skull = ball(0.2, 0, 0.05, 0, skin);
  skull.scale.set(1.05, 0.9, 1.2);
  body.add(skull);
  const brow = box(0.34, 0.06, 0.12, 0, 0.13, -0.16, bone);
  brow.rotation.x = 0.35;
  body.add(brow);
  for (const sx of [-1, 1]) body.add(ball(0.06, sx * 0.13, -0.01, -0.15, bone));
  // upper teeth
  for (let i = 0; i < 6; i++) {
    const a = ((i - 2.5) / 2.5) * 0.9;
    const t = cone(0.018, 0.07, Math.sin(a) * 0.11, -0.1, -0.2 + (1 - Math.cos(a)) * 0.08, bone);
    t.rotation.x = Math.PI; // point down
    body.add(t);
  }
  // jaw (pivots at the back of the mouth; negative rotation.x opens it)
  const jaw = new Group();
  jaw.position.set(0, -0.07, 0.02);
  const jawPlate = box(0.24, 0.05, 0.24, 0, -0.03, -0.12, skin);
  jaw.add(jawPlate);
  for (let i = 0; i < 5; i++) {
    const a = ((i - 2) / 2) * 0.8;
    jaw.add(cone(0.016, 0.06, Math.sin(a) * 0.1, 0.02, -0.2 + (1 - Math.cos(a)) * 0.07, bone));
  }
  body.add(jaw);
  // the fire inside the mouth + the eyes share the glow material
  const mouthFire = ball(0.055, 0, -0.08, -0.12, glow);
  body.add(mouthFire);
  const eye = ball(0.075, 0, 0.07, -0.235, glow);
  body.add(eye);
  body.add(box(0.018, 0.09, 0.01, 0, 0.07, -0.31, PUPIL)); // slit pupil
  for (const sx of [-1, 1]) body.add(ball(0.022, sx * 0.1, 0.035, -0.215, glow));
  // horns: two-segment curves sweeping back
  for (const sx of [-1, 1]) {
    const h1 = new Group();
    h1.position.set(sx * 0.13, 0.17, -0.02);
    h1.rotation.set(-0.9, 0, -sx * 0.55);
    h1.add(cone(0.045, 0.16, 0, 0.08, 0, bone));
    const h2 = new Group();
    h2.position.y = 0.15;
    h2.rotation.x = -0.7;
    h2.add(cone(0.028, 0.14, 0, 0.07, 0, bone));
    h1.add(h2);
    body.add(h1);
  }
  // spine + ribs trailing down and back
  for (let i = 0; i < 4; i++) {
    const v = box(0.05, 0.05, 0.06, 0, -0.12 - i * 0.07, 0.12 + i * 0.06, bone);
    v.rotation.x = 0.6;
    body.add(v);
    if (i < 3) {
      const rib = new Mesh(
        geo('rib', () => new TorusGeometry(0.11 - 0.0, 0.012, 4, 12, Math.PI * 1.3)),
        bone,
      );
      rib.position.set(0, -0.14 - i * 0.07, 0.13 + i * 0.06);
      rib.rotation.set(Math.PI / 2 + 0.6, 0, Math.PI * 0.85);
      rib.scale.setScalar(1 - i * 0.18);
      body.add(rib);
    }
  }
  // tentacles: chains of tapering segments (animated by animateFlyer)
  const tentacles: Object3D[][] = [];
  const roots: [number, number, number][] = [
    [-0.09, -0.1, 0.02],
    [0.09, -0.1, 0.02],
    [-0.05, -0.28, 0.25],
    [0.05, -0.28, 0.25],
  ];
  for (const [x, y, z] of roots) {
    const chain: Object3D[] = [];
    let parent: Object3D = body;
    for (let i = 0; i < 6; i++) {
      const seg = new Group();
      seg.position.set(i === 0 ? x : 0, i === 0 ? y : -0.085, i === 0 ? z : 0);
      const r = 0.032 * (1 - i * 0.13);
      seg.add(cylY(r * 0.75, r, 0.095, 0, -0.045, 0, i % 2 ? skin : bone));
      parent.add(seg);
      chain.push(seg);
      parent = seg;
    }
    tentacles.push(chain);
  }

  const muzzle = new Object3D();
  muzzle.name = 'drone-muzzle';
  muzzle.position.set(0, -0.08, -0.26);
  body.add(muzzle);

  const hit: HitVolumes = {
    body: { center: new Vector3(0, -0.02, 0.02), radius: 0.26, halfHeight: 0.08 },
    core: { center: eye.position.clone(), radius: 0.08 },
  };
  return { root, body, tentacles, jaw, eye, muzzle, mats, hit };
}

/** Procedural idle/flight animation for the flyer (call per sim step). `open` 0..1 = jaw. */
export function animateFlyer(m: DroneModel, t: number, phase: number, trail: number, open: number) {
  m.jaw.rotation.x = -0.08 - open * 0.75 + Math.sin(t * 7 + phase) * 0.03;
  m.tentacles.forEach((chain, ci) => {
    const ph = phase + ci * 1.7;
    chain.forEach((seg, i) => {
      const k = (i + 1) / chain.length;
      seg.rotation.x = Math.sin(t * 2.6 + ph - i * 0.7) * 0.28 * k + (i === 0 ? 0.35 + trail * 0.6 : trail * 0.12);
      seg.rotation.z = Math.cos(t * 2.1 + ph - i * 0.6) * 0.22 * k;
    });
  });
}

// ---- Fireball ----

const fireMats: { core: MeshBasicMaterial; flame: MeshBasicMaterial; tail: MeshBasicMaterial }[] = [];

/** Fireball travelling along +Z (Object3D.lookAt points +Z at the target): hot core, flame, tail. */
export function buildBolt(): Group {
  if (!fireMats.length) {
    const common = { blending: AdditiveBlending, depthWrite: false, transparent: true } as const;
    const core = new MeshBasicMaterial({ ...common });
    core.color.setRGB(6, 4.2, 2.2); // HDR: blooms
    const flame = new MeshBasicMaterial({ ...common, opacity: 0.85 });
    flame.color.setRGB(3.2, 0.7, 0.12);
    const tail = new MeshBasicMaterial({ ...common, opacity: 0.5 });
    tail.color.setRGB(2.0, 0.28, 0.05);
    fireMats.push({ core, flame, tail });
  }
  const m = fireMats[0];
  const g = new Group();
  g.name = 'bolt';
  const core = new Mesh(
    geo('fireCore', () => new SphereGeometry(0.06, 10, 8)),
    m.core,
  );
  const flame = new Mesh(
    geo('fireFlame', () => new SphereGeometry(0.13, 12, 8)),
    m.flame,
  );
  flame.name = 'flame';
  const tail = new Mesh(
    geo('fireTail', () => new CapsuleGeometry(0.09, 0.45, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -0.28)),
    m.tail,
  );
  tail.name = 'tail';
  g.add(tail, flame, core);
  return g;
}

// ---- Debris ----

export function buildDebris(count: number, material: MeshStandardMaterial): Mesh[] {
  const g = geo('debris', () => new BoxGeometry(1, 1, 1));
  const out: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const m = new Mesh(g, material);
    m.scale.set(
      0.05 + Math.random() * 0.09,
      0.04 + Math.random() * 0.07,
      0.05 + Math.random() * 0.09,
    );
    m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    out.push(m);
  }
  return out;
}
