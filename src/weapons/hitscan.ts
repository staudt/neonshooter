import { Ray, Vector3 } from 'three';
import type { Colliders } from '../player/collision';

export type HitPart = 'head' | 'body';

/** Anything bullets can hit besides the world (enemies, dummies). */
export interface Hittable {
  readonly alive: boolean;
  /** Flesh: bullet hits draw blood (gore) instead of sparks. */
  readonly bleeds?: boolean;
  /** Nearest intersection of the ray within maxDist, or null. */
  raycast(ray: Ray, maxDist: number): { distance: number; part: HitPart; normal: Vector3 } | null;
  /** Apply damage. Returns true if this killed it. */
  damage(amount: number, part: HitPart, point: Vector3, dir: Vector3): boolean;
}

export interface BulletHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
  /** Set when a Hittable was hit (closer than the world). */
  target?: Hittable;
  part?: HitPart;
  /** World surface material (when the world was hit). */
  surface?: string;
}

/** Trace one bullet: nearest of world geometry and every live target. Null = hit nothing in range. */
export function traceBullet(
  colliders: Colliders,
  surfaceAt: (faceA: number) => string,
  targets: Iterable<Hittable>,
  origin: Vector3,
  dir: Vector3,
  range: number,
): BulletHit | null {
  const ray = new Ray(origin.clone(), dir.clone().normalize());
  let best: BulletHit | null = null;

  // Nearest world hit across the static level and dynamic movers. Mover triangles have no
  // surface table entry, so they read as metal.
  const list = Array.isArray(colliders) ? colliders : [colliders];
  let world: ReturnType<(typeof list)[number]['boundsTree']['raycastFirst']> = null;
  let worldIdx = 0;
  list.forEach((c, i) => {
    const h = c.boundsTree.raycastFirst(ray, 2 /* DoubleSide */, 0, range);
    if (h && h.distance <= range && (!world || h.distance < world.distance)) {
      world = h;
      worldIdx = i;
    }
  });
  if (world) {
    const w = world as NonNullable<typeof world>;
    const normal = w.face?.normal.clone() ?? new Vector3(0, 1, 0);
    if (normal.dot(ray.direction) > 0) normal.negate();
    best = {
      point: w.point.clone(),
      normal,
      distance: w.distance,
      surface: worldIdx === 0 ? surfaceAt(w.face?.a ?? 0) : 'metal',
    };
  }

  for (const t of targets) {
    if (!t.alive) continue;
    const hit = t.raycast(ray, best?.distance ?? range);
    if (hit && hit.distance < (best?.distance ?? Infinity)) {
      best = {
        point: ray.at(hit.distance, new Vector3()),
        normal: hit.normal,
        distance: hit.distance,
        target: t,
        part: hit.part,
      };
    }
  }
  return best;
}
