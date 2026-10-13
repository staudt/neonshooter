import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';

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
  rotors: Object3D[];
  eye: Mesh;
  muzzle: Object3D;
  mats: RobotMaterials;
  hit: HitVolumes;
}

const ENEMY_RED = 0xff2b4a;
const ENEMY_MAGENTA = 0xff3b8a;

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

export function buildDrone(): DroneModel {
  const mats = makeMats();
  const { hull, joint, glow } = mats;
  const root = new Group();
  root.name = 'drone';
  const body = new Group();
  body.name = 'drone-body';
  root.add(body);

  // Central hull: octahedron-ish core plus a boxy mid-plate.
  const oct = new Mesh(
    geo('droneOct', () => new OctahedronGeometry(0.27)),
    hull,
  );
  oct.scale.set(1, 0.6, 1);
  body.add(oct);
  body.add(box(0.34, 0.1, 0.34, 0, 0, 0, joint));
  body.add(box(0.2, 0.05, 0.2, 0, 0.12, 0.02, joint)); // top sensor plate
  body.add(box(0.08, 0.03, 0.16, 0, 0.16, 0.02, glow)); // top light
  body.add(box(0.2, 0.08, 0.1, 0, -0.04, 0.2, joint)); // rear engine block

  const rotors: Object3D[] = [];
  const reach = 0.26;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * reach;
      const z = sz * reach;
      // Arm from the hull out to the motor
      const arm = box(0.07, 0.05, 0.3, 0, 0, 0, hull);
      arm.position.set(x * 0.55, 0.02, z * 0.55);
      arm.rotation.y = Math.atan2(x, z);
      body.add(arm);
      body.add(cylY(0.05, 0.05, 0.08, x, 0.03, z, joint)); // motor
      const rotor = new Group();
      rotor.position.set(x, 0.08, z);
      const ringMesh = new Mesh(
        geo('droneRing', () => new TorusGeometry(0.13, 0.022, 6, 16)),
        glow,
      );
      ringMesh.rotation.x = Math.PI / 2;
      rotor.add(ringMesh);
      rotor.add(box(0.26, 0.01, 0.03, 0, 0, 0, joint)); // blade (shows spin)
      body.add(rotor);
      rotors.push(rotor);
    }
  }

  const eye = ball(0.1, 0, 0.02, -0.2, glow);
  body.add(eye);
  const socket = new Mesh(
    geo('droneSocket', () => new TorusGeometry(0.11, 0.025, 8, 16)),
    joint,
  );
  socket.position.set(0, 0.02, -0.21);
  body.add(socket);
  body.add(cylZ(0.025, 0.08, 0, -0.1, -0.22, joint)); // emitter
  const muzzle = new Object3D();
  muzzle.name = 'drone-muzzle';
  muzzle.position.set(0, -0.1, -0.27);
  body.add(muzzle);

  const hit: HitVolumes = {
    body: { center: new Vector3(0, 0, 0), radius: 0.32, halfHeight: 0.05 },
    core: { center: eye.position.clone(), radius: 0.1 },
  };
  return { root, body, rotors, eye, muzzle, mats, hit };
}

// ---- Bolt ----

const boltMatCache = new Map<number, { inner: MeshBasicMaterial; outer: MeshBasicMaterial }>();

/** Glowing elongated projectile along -Z, ~0.5 m long. */
export function buildBolt(color: number = ENEMY_MAGENTA): Group {
  let m = boltMatCache.get(color);
  if (!m) {
    const common = {
      blending: AdditiveBlending,
      toneMapped: false,
      depthWrite: false,
      transparent: true,
    } as const;
    m = {
      inner: new MeshBasicMaterial({ color: 0xffffff, ...common }),
      outer: new MeshBasicMaterial({ color, opacity: 0.55, ...common }),
    };
    boltMatCache.set(color, m);
  }
  const g = new Group();
  g.name = 'bolt';
  const inner = new Mesh(
    geo('boltInner', () => new CapsuleGeometry(0.025, 0.4, 3, 8).rotateX(Math.PI / 2)),
    m.inner,
  );
  const outer = new Mesh(
    geo('boltOuter', () => new CapsuleGeometry(0.07, 0.36, 3, 8).rotateX(Math.PI / 2)),
    m.outer,
  );
  g.add(outer, inner);
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
