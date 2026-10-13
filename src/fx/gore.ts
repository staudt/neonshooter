import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { defineTunables } from '../dev/tuning';
import { raycast, type Colliders } from '../player/collision';
import { ParticleLayer } from './impacts';

/**
 * Graphic gore on a fixed budget: blood droplets (instanced), splatter decals thrown onto walls and
 * floors by short raycasts behind each hit, growing pools under the dead, and gib trails. Every
 * buffer is a ring: old blood is recycled, so cost never grows. Decals are lit (wet, dark red).
 */

export const GORE = defineTunables(
  'gore',
  { amount: 1, splatReach: 3.2, splatSize: 1, poolSize: 1, droplets: 1 },
  {
    amount: [0, 3, 0.01],
    splatReach: [0, 8, 0.1],
    splatSize: [0.2, 3, 0.01],
    poolSize: [0, 3, 0.01],
    droplets: [0, 3, 0.01],
  },
);

const MAX_SPLATS = 192;
const MAX_POOLS = 24;
const VARIANTS = 4;
const Z = new Vector3(0, 0, 1);
const _o = new Object3D();
const _m = new Matrix4();

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splatter: central blob, satellite drops, a few directional streaks (texture "up" = travel). */
function splatTexture(seed: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const blob = (x: number, y: number, rad: number, a: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(70,4,4,${a})`);
    grad.addColorStop(0.7, `rgba(45,2,2,${a * 0.95})`);
    grad.addColorStop(1, 'rgba(30,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  for (let i = 0; i < 7; i++)
    blob(128 + (r() - 0.5) * 50, 128 + (r() - 0.5) * 50, 26 + r() * 30, 0.95);
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2;
    const d = 50 + r() * 70;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + r() * 7, 0.9);
  }
  // streaks thrown "up" (the direction of travel)
  g.strokeStyle = 'rgba(55,3,3,0.9)';
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const x = 128 + (r() - 0.5) * 70;
    g.lineWidth = 3 + r() * 6;
    g.beginPath();
    g.moveTo(x, 128);
    g.lineTo(x + (r() - 0.5) * 30, 128 - 60 - r() * 60);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function poolTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const r = rng(99);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = 128 + (r() - 0.5) * 80;
    const y = 128 + (r() - 0.5) * 80;
    const rad = 40 + r() * 50;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(50,2,2,1)');
    grad.addColorStop(0.85, 'rgba(38,1,1,0.97)');
    grad.addColorStop(1, 'rgba(25,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function decalMesh(map: CanvasTexture | null, count: number, offset: number) {
  const mesh = new InstancedMesh(
    new PlaneGeometry(1, 1),
    new MeshStandardMaterial({
      map,
      color: map ? 0xffffff : 0x3a0202,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset,
    }),
    count,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
  return mesh;
}

interface Pool {
  pos: Vector3;
  normal: Vector3;
  rot: number;
  size: number;
  t: number;
}

export class Gore {
  readonly root = new Group();
  private readonly drops = new ParticleLayer(new Color(0.22, 0.008, 0.006), false, 0.05, 0.95);
  private readonly mist = new ParticleLayer(new Color(0.3, 0.02, 0.015), false, 0, 0.35);
  private readonly splats: InstancedMesh[] = [];
  private readonly splatNext = new Array(VARIANTS).fill(0);
  private readonly pools: InstancedMesh;
  private readonly poolState: Pool[] = [];
  private poolNext = 0;

  constructor() {
    const per = Math.ceil(MAX_SPLATS / VARIANTS);
    for (let v = 0; v < VARIANTS; v++) {
      const m = decalMesh(splatTexture(17 + v * 31), per, -3 - v * 0.1);
      this.splats.push(m);
      this.root.add(m);
    }
    this.pools = decalMesh(poolTexture(), MAX_POOLS, -2);
    this.root.add(this.drops.mesh, this.mist.mesh, this.pools);
  }

  /** A splatter decal on a surface; `along` = travel direction (streaks point that way). */
  splat(point: Vector3, normal: Vector3, along: Vector3, size: number) {
    const v = Math.floor(Math.random() * VARIANTS);
    const mesh = this.splats[v];
    const i = this.splatNext[v];
    this.splatNext[v] = (i + 1) % mesh.count;
    _o.position.copy(point).addScaledVector(normal, 0.004 + Math.random() * 0.002);
    _o.quaternion.setFromUnitVectors(Z, normal);
    // rotate in-plane so texture "up" follows the travel direction
    const up = new Vector3(0, 1, 0).applyQuaternion(_o.quaternion);
    const t = along.clone().addScaledVector(normal, -along.dot(normal));
    if (t.lengthSq() > 1e-5) {
      t.normalize();
      const ang = Math.atan2(new Vector3().crossVectors(up, t).dot(normal), up.dot(t));
      _o.rotateZ(ang);
    } else _o.rotateZ(Math.random() * Math.PI * 2);
    const s = size * GORE.splatSize;
    _o.scale.set(s, s * (0.8 + Math.random() * 0.4), 1);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Bullet/melee hit on flesh: droplets back toward the shooter + forward, splatter behind. */
  hit(point: Vector3, normal: Vector3, dir: Vector3, colliders: Colliders, strength = 1) {
    const k = GORE.amount * strength;
    const n = Math.round(10 * k * GORE.droplets);
    for (let i = 0; i < n; i++) {
      const forward = i % 3 !== 0; // exit spray is the big one
      const base = forward ? dir : normal;
      const v = base
        .clone()
        .multiplyScalar(forward ? 3 + Math.random() * 4 : 1.5 + Math.random() * 2)
        .add(
          new Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(
            3,
          ),
        );
      this.drops.emit(point, v, 0.5 + Math.random() * 0.5, 0.012 + Math.random() * 0.014, 0.6, 9.8);
    }
    for (let i = 0; i < Math.round(4 * k); i++) {
      const v = new Vector3(
        Math.random() - 0.5,
        Math.random() - 0.3,
        Math.random() - 0.5,
      ).multiplyScalar(1.2);
      this.mist.emit(point, v, 0.35 + Math.random() * 0.3, 0.09 + Math.random() * 0.08, 4, 0.5);
    }
    // splatter on whatever is behind the target (wall or floor), else below it
    const reach = GORE.splatReach;
    const behind = raycast(colliders, point, dir, reach);
    if (behind)
      this.splat(
        behind.point,
        behind.normal,
        dir,
        (0.35 + Math.random() * 0.35) * strength * (1 - behind.distance / (reach * 1.6)),
      );
    else {
      const down = raycast(colliders, point, new Vector3(0, -1, 0), 6);
      if (down) this.splat(down.point, down.normal, dir, (0.25 + Math.random() * 0.25) * strength);
    }
  }

  /** Death burst: blood everywhere around, plus a pool that spreads under the body. */
  burst(center: Vector3, colliders: Colliders, size = 1) {
    const k = GORE.amount * size;
    for (let i = 0; i < Math.round(36 * k * GORE.droplets); i++) {
      const v = new Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(2 + Math.random() * 6);
      this.drops.emit(center, v, 0.6 + Math.random() * 0.7, 0.015 + Math.random() * 0.02, 0.4, 9.8);
    }
    for (let i = 0; i < Math.round(10 * k); i++) {
      const v = new Vector3(
        Math.random() - 0.5,
        Math.random() - 0.2,
        Math.random() - 0.5,
      ).multiplyScalar(2.5);
      this.mist.emit(center, v, 0.5 + Math.random() * 0.4, 0.18 + Math.random() * 0.15, 3, 0.4);
    }
    for (let i = 0; i < Math.round(9 * k); i++) {
      const d = new Vector3(
        Math.random() - 0.5,
        (Math.random() - 0.7) * 0.9,
        Math.random() - 0.5,
      ).normalize();
      const h = raycast(colliders, center, d, GORE.splatReach * 1.3);
      if (h) this.splat(h.point, h.normal, d, (0.5 + Math.random() * 0.6) * size);
    }
    const ground = raycast(colliders, center, new Vector3(0, -1, 0), 12);
    if (ground && ground.normal.y > 0.6)
      this.pool(ground.point, ground.normal, (1 + Math.random() * 0.7) * size);
  }

  /** Gib flying through the air: a drip now and then. */
  trail(pos: Vector3) {
    if (Math.random() < 0.35 * GORE.droplets)
      this.drops.emit(
        pos,
        new Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4),
        0.5,
        0.012,
        0.5,
        9.8,
      );
  }

  /** Gib hit the floor: small splat. */
  land(pos: Vector3, colliders: Colliders) {
    const h = raycast(colliders, pos.clone().setY(pos.y + 0.3), new Vector3(0, -1, 0), 1);
    if (h)
      this.splat(
        h.point,
        h.normal,
        new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5),
        0.2 + Math.random() * 0.25,
      );
  }

  private pool(point: Vector3, normal: Vector3, size: number) {
    const i = this.poolNext;
    this.poolNext = (i + 1) % MAX_POOLS;
    this.poolState[i] = {
      pos: point.clone(),
      normal: normal.clone(),
      rot: Math.random() * 6.28,
      size: size * GORE.poolSize,
      t: 0,
    };
  }

  /** Per frame (visual only). */
  update(dt: number) {
    this.drops.update(dt);
    this.mist.update(dt);
    let any = false;
    for (let i = 0; i < this.poolState.length; i++) {
      const p = this.poolState[i];
      if (!p || p.t >= 1) continue;
      p.t = Math.min(1, p.t + dt / 2.5);
      const g = 1 - (1 - p.t) * (1 - p.t); // spreads fast, then slows
      _o.position.copy(p.pos).addScaledVector(p.normal, 0.003);
      _o.quaternion.setFromUnitVectors(Z, p.normal);
      _o.rotateZ(p.rot);
      _o.scale.set(p.size * g, p.size * g, 1);
      _o.updateMatrix();
      this.pools.setMatrixAt(i, _o.matrix);
      any = true;
    }
    if (any) this.pools.instanceMatrix.needsUpdate = true;
  }

  /** Wipe all blood (level reload). */
  clear() {
    for (const m of [...this.splats, this.pools]) {
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, _m.makeScale(0, 0, 0));
      m.instanceMatrix.needsUpdate = true;
    }
    this.poolState.length = 0;
  }
}
