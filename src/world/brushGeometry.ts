import { Vector3 } from 'three';
import type { MapBrush, Vec3Tuple } from './mapParser';

/** 32 Quake map units = 1 meter. */
export const MAP_SCALE = 1 / 32;

/** Quake (x, y, z) Z-up → three.js (x, z, -y) Y-up, scaled to meters. A proper rotation (det = +1). */
export function toWorld(v: Vec3Tuple | Vector3, out = new Vector3()): Vector3 {
  const [x, y, z] = Array.isArray(v) ? v : [v.x, v.y, v.z];
  return out.set(x * MAP_SCALE, z * MAP_SCALE, -y * MAP_SCALE);
}

/** Quake "angle" (degrees, 0 = +X, counter-clockwise seen from above) → our camera yaw (radians). */
export function angleToYaw(angleDeg: number): number {
  return ((angleDeg - 90) * Math.PI) / 180;
}

export interface Plane {
  normal: Vector3;
  dist: number;
}

export interface BrushPolygon {
  texture: string;
  /** Outward normal, world space. */
  normal: Vector3;
  /** Convex polygon, counter-clockwise when viewed from outside (front face for three.js). */
  vertices: Vector3[];
}

export interface BuiltBrush {
  polygons: BrushPolygon[];
  /** Outward planes in world space; a point is inside when dot(n, p) - d <= 0 for all. */
  planes: Plane[];
  min: Vector3;
  max: Vector3;
}

const EPS = 1e-3;

/**
 * Plane from three face points. TrenchBroom/qbsp convention: normal = (p0 - p1) × (p2 - p1)
 * points out of the brush. Computed in world space after conversion (rotation keeps orientation).
 */
function planeFromPoints(a: Vector3, b: Vector3, c: Vector3): Plane | null {
  const n = new Vector3().subVectors(a, b).cross(new Vector3().subVectors(c, b));
  if (n.lengthSq() < 1e-12) return null;
  n.normalize();
  return { normal: n, dist: n.dot(b) };
}

function intersect3(p1: Plane, p2: Plane, p3: Plane): Vector3 | null {
  const n2xn3 = new Vector3().crossVectors(p2.normal, p3.normal);
  const denom = p1.normal.dot(n2xn3);
  if (Math.abs(denom) < 1e-9) return null;
  return n2xn3
    .multiplyScalar(p1.dist)
    .add(new Vector3().crossVectors(p3.normal, p1.normal).multiplyScalar(p2.dist))
    .add(new Vector3().crossVectors(p1.normal, p2.normal).multiplyScalar(p3.dist))
    .divideScalar(denom);
}

function insideAll(p: Vector3, planes: Plane[]) {
  for (const pl of planes) if (pl.normal.dot(p) - pl.dist > EPS) return false;
  return true;
}

/** Snap to 0.1 mm to kill float noise from plane intersection (and -0). */
function snap(v: Vector3) {
  v.x = Math.round(v.x * 1e4) / 1e4 + 0;
  v.y = Math.round(v.y * 1e4) / 1e4 + 0;
  v.z = Math.round(v.z * 1e4) / 1e4 + 0;
  return v;
}

function pushUnique(list: Vector3[], v: Vector3) {
  for (const u of list) if (u.distanceToSquared(v) < EPS * EPS) return;
  list.push(v);
}

/** Order coplanar points CCW around `normal` (as seen from the side the normal points to). */
function sortAroundNormal(points: Vector3[], normal: Vector3): Vector3[] {
  const center = points.reduce((acc, v) => acc.add(v), new Vector3()).divideScalar(points.length);
  const u = new Vector3().subVectors(points[0], center).normalize();
  const v = new Vector3().crossVectors(normal, u);
  return points
    .map((p) => {
      const d = new Vector3().subVectors(p, center);
      return { p, a: Math.atan2(d.dot(v), d.dot(u)) };
    })
    .sort((x, y) => x.a - y.a)
    .map((e) => e.p);
}

function solve(planes: Plane[], textures: string[]): BrushPolygon[] {
  const faceVerts: Vector3[][] = planes.map(() => []);
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const p = intersect3(planes[i], planes[j], planes[k]);
        if (!p || !insideAll(p, planes)) continue;
        snap(p);
        // A vertex belongs to every face whose plane it lies on (handles >3 planes meeting).
        for (let f = 0; f < planes.length; f++)
          if (Math.abs(planes[f].normal.dot(p) - planes[f].dist) < EPS) pushUnique(faceVerts[f], p);
      }
  const polys: BrushPolygon[] = [];
  faceVerts.forEach((verts, f) => {
    if (verts.length < 3) return; // redundant plane
    polys.push({
      texture: textures[f],
      normal: planes[f].normal.clone(),
      vertices: sortAroundNormal(verts, planes[f].normal),
    });
  });
  return polys;
}

/** Turn a parsed brush into world-space convex polygons. Returns null for degenerate brushes. */
export function buildBrush(brush: MapBrush): BuiltBrush | null {
  const planes: Plane[] = [];
  const textures: string[] = [];
  for (const face of brush.faces) {
    const [a, b, c] = face.points.map((pt) => toWorld(pt));
    const pl = planeFromPoints(a, b, c);
    if (!pl) continue;
    // Skip duplicate planes (some editors emit them).
    if (
      planes.some((q) => q.normal.distanceTo(pl.normal) < 1e-6 && Math.abs(q.dist - pl.dist) < EPS)
    )
      continue;
    planes.push(pl);
    textures.push(face.texture);
  }
  if (planes.length < 4) return null;

  let polygons = solve(planes, textures);
  if (polygons.length < 4) {
    // Points written in the opposite winding: flip every plane and retry.
    for (const pl of planes) {
      pl.normal.negate();
      pl.dist = -pl.dist;
    }
    polygons = solve(planes, textures);
    if (polygons.length < 4) return null;
  }

  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const poly of polygons)
    for (const v of poly.vertices) {
      min.min(v);
      max.max(v);
    }
  return { polygons, planes, min, max };
}

/** Point-in-convex-brush test (for triggers). */
export function brushContains(brush: BuiltBrush, p: Vector3, margin = 0): boolean {
  for (const pl of brush.planes) if (pl.normal.dot(p) - pl.dist > margin) return false;
  return true;
}
