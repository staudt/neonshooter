import { Group, Vector3 } from 'three';
import { raycast, type Colliders } from '../player/collision';
import { buildBolt } from './models';

/** A visible enemy bolt. Slow enough to dodge — that's the point. */
interface Bolt {
  mesh: Group;
  pos: Vector3;
  vel: Vector3;
  damage: number;
  radius: number;
  life: number;
  from: Vector3;
}

export interface BoltImpact {
  point: Vector3;
  normal: Vector3;
  hitPlayer: boolean;
  damage: number;
  /** Where the bolt was fired from (damage direction). */
  from: Vector3;
}

/** Squared distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentSegmentDistSq(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const d1 = new Vector3().subVectors(q1, p1);
  const d2 = new Vector3().subVectors(q2, p2);
  const r = new Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) return r.dot(r);
  if (a <= 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}

/**
 * Pooled enemy projectiles. Stepped in the fixed sim: each step sweeps the bolt's path segment
 * against the world (raycast) and the player's capsule (segment–segment distance).
 */
export class Projectiles {
  readonly root = new Group();
  private live: Bolt[] = [];
  private pool: Group[] = [];

  fire(origin: Vector3, velocity: Vector3, damage: number, radius = 0.12) {
    const mesh = this.pool.pop() ?? buildBolt();
    mesh.position.copy(origin);
    mesh.lookAt(origin.clone().add(velocity));
    this.root.add(mesh);
    this.live.push({
      mesh,
      pos: origin.clone(),
      vel: velocity.clone(),
      damage,
      radius,
      life: 4,
      from: origin.clone(),
    });
  }

  get count() {
    return this.live.length;
  }

  clear() {
    for (const b of this.live) {
      b.mesh.removeFromParent();
      this.pool.push(b.mesh);
    }
    this.live.length = 0;
  }

  /**
   * Advance all bolts. `capsule` = the player's capsule segment (bottom/top sphere centers) + radius.
   * Returns impacts this step (world or player).
   */
  step(
    dt: number,
    colliders: Colliders,
    capsule: { a: Vector3; b: Vector3; radius: number } | null,
  ): BoltImpact[] {
    const impacts: BoltImpact[] = [];
    const dir = new Vector3();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const bolt = this.live[i];
      bolt.life -= dt;
      const next = bolt.pos.clone().addScaledVector(bolt.vel, dt);
      const len = bolt.vel.length() * dt;
      dir.copy(bolt.vel).normalize();
      const wall = raycast(colliders, bolt.pos, dir, len + bolt.radius);
      const wallDist = wall ? wall.distance : Infinity;

      let hitPlayer = false;
      if (capsule) {
        const r = capsule.radius + bolt.radius;
        // Only count the part of the path before any wall hit.
        const end = wallDist < len ? bolt.pos.clone().addScaledVector(dir, wallDist) : next;
        hitPlayer = segmentSegmentDistSq(bolt.pos, end, capsule.a, capsule.b) <= r * r;
      }

      if (hitPlayer || wall || bolt.life <= 0) {
        if (hitPlayer || wall)
          impacts.push({
            point: hitPlayer ? next : wall!.point,
            normal: hitPlayer ? dir.clone().negate() : wall!.normal,
            hitPlayer,
            damage: bolt.damage,
            from: bolt.from,
          });
        bolt.mesh.removeFromParent();
        this.pool.push(bolt.mesh);
        this.live.splice(i, 1);
        continue;
      }
      bolt.pos.copy(next);
      bolt.mesh.position.copy(next);
      // flame flicker
      const flame = bolt.mesh.children[1];
      if (flame) flame.scale.setScalar(1 + 0.18 * Math.sin(bolt.life * 57 + i) + 0.08 * Math.sin(bolt.life * 131));
    }
    return impacts;
  }
}
