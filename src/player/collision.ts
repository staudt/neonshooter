import { Box3, Line3, Ray, Vector3, type BufferGeometry } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

export type Collider = BufferGeometry & { boundsTree: MeshBVH };
/** One collider or several (static world + dynamic movers). Arrays may be mutated in place. */
export type Colliders = Collider | readonly Collider[];

const list = (c: Colliders): readonly Collider[] => (Array.isArray(c) ? c : [c as Collider]);

/** Upright capsule described from the feet: bottom sphere center at feet + r, top at feet + h - r. */
export interface Capsule {
  radius: number;
  height: number;
}

export interface Contact {
  /** Unit vector from the surface toward the capsule. */
  normal: Vector3;
  depth: number;
}

const _seg = new Line3();
const _box = new Box3();
const _triPoint = new Vector3();
const _capPoint = new Vector3();
const _dir = new Vector3();

function setSegment(feet: Vector3, cap: Capsule) {
  _seg.start.set(feet.x, feet.y + cap.radius, feet.z);
  _seg.end.set(feet.x, feet.y + Math.max(cap.height - cap.radius, cap.radius), feet.z);
}

/**
 * Push the capsule out of the world. Mutates `feet`. Returns the contacts resolved (one per
 * triangle push). Runs a few passes because resolving one triangle can push into another.
 */
export function depenetrate(
  colliders: Colliders,
  feet: Vector3,
  cap: Capsule,
  contacts: Contact[] = [],
  iterations = 4,
): Contact[] {
  const r = cap.radius;
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    setSegment(feet, cap);
    _box.makeEmpty().expandByPoint(_seg.start).expandByPoint(_seg.end).expandByScalar(r);
    for (const collider of list(colliders))
      collider.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
          if (dist >= r - 1e-5) return false;
          const depth = r - dist;
          if (dist > 1e-6) _dir.subVectors(_capPoint, _triPoint).divideScalar(dist);
          else tri.getNormal(_dir); // segment touches the face: push along face normal
          _seg.start.addScaledVector(_dir, depth);
          _seg.end.addScaledVector(_dir, depth);
          contacts.push({ normal: _dir.clone(), depth });
          moved = true;
          return false;
        },
      });
    if (!moved) break;
    feet.set(_seg.start.x, _seg.start.y - r, _seg.start.z);
  }
  return contacts;
}

/** True if the capsule at `feet` overlaps world geometry by more than `tolerance`. */
export function overlaps(
  colliders: Colliders,
  feet: Vector3,
  cap: Capsule,
  tolerance = 0.01,
): boolean {
  const r = cap.radius;
  setSegment(feet, cap);
  _box.makeEmpty().expandByPoint(_seg.start).expandByPoint(_seg.end).expandByScalar(r);
  return list(colliders).some((collider) =>
    collider.boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) =>
        tri.closestPointToSegment(_seg, _triPoint, _capPoint) < r - tolerance,
    }),
  );
}

export interface GroundHit {
  /** Vertical gap between the capsule bottom and the ground (negative = penetrating). */
  distance: number;
  normal: Vector3;
}

const _faceNormal = new Vector3();

/**
 * Find walkable ground under the capsule within `maxDistance` (vertical). Considers every triangle
 * near the bottom sphere: a contact counts if the push direction is walkable, or if the triangle
 * itself is walkable (standing over a ledge edge). Walls next to the player are ignored.
 */
export function probeGround(
  colliders: Colliders,
  feet: Vector3,
  radius: number,
  maxDistance: number,
  minNormalY: number,
): GroundHit | null {
  const center = new Vector3(feet.x, feet.y + radius, feet.z);
  _box.makeEmpty().expandByPoint(center).expandByScalar(radius);
  _box.min.y -= maxDistance;
  let best: GroundHit | null = null;
  const closest = new Vector3();
  const dir = new Vector3();
  for (const collider of list(colliders))
    collider.boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        tri.closestPointToPoint(center, closest);
        const dx = closest.x - center.x;
        const dz = closest.z - center.z;
        const horiz2 = dx * dx + dz * dz;
        if (horiz2 >= radius * radius) return false;
        if (closest.y > center.y) return false; // above the sphere center: not ground
        dir.subVectors(center, closest);
        const len = dir.length();
        if (len > 1e-6) dir.divideScalar(len);
        tri.getNormal(_faceNormal);
        if (_faceNormal.y < 0) _faceNormal.negate();
        const walkable = dir.y >= minNormalY || _faceNormal.y >= minNormalY;
        if (!walkable) return false;
        // Vertical drop until the sphere touches this point.
        const gap = center.y - closest.y - Math.sqrt(radius * radius - horiz2);
        if (gap > maxDistance) return false;
        // Edge/corner contacts aren't slopes: report them as flat so velocity isn't tilted.
        const normal = _faceNormal.y >= minNormalY ? _faceNormal.clone() : new Vector3(0, 1, 0);
        if (!best || gap < best.distance) best = { distance: gap, normal };
        return false;
      },
    });
  return best;
}

/** Ray against the world. Returns hit distance + normal, or null. */
export function raycast(colliders: Colliders, origin: Vector3, dir: Vector3, far: number) {
  const ray = new Ray(origin, dir);
  let hit: ReturnType<MeshBVH['raycastFirst']> = null;
  for (const collider of list(colliders)) {
    const h = collider.boundsTree.raycastFirst(ray, 2 /* DoubleSide */, 0, far);
    if (h && h.distance <= far && (!hit || h.distance < hit.distance)) hit = h;
  }
  if (!hit) return null;
  const normal = hit.face?.normal.clone() ?? new Vector3(0, 1, 0);
  // Face normals are in geometry space (identity transform for the static world).
  if (normal.dot(dir) > 0) normal.negate();
  return { distance: hit.distance, point: hit.point.clone(), normal };
}
