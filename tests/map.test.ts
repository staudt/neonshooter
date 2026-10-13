import { readFileSync } from 'node:fs';
import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { angleToYaw, brushContains, buildBrush, toWorld } from '../src/world/brushGeometry';
import { buildLevelData } from '../src/world/level';
import { parseMap } from '../src/world/mapParser';

// A 64-unit cube from (0,0,0) to (64,64,64) as TrenchBroom writes it (Valve 220).
const CUBE = `
// comment
{
"classname" "worldspawn"
"message" "{ tricky }"
{
( 0 0 0 ) ( 0 1 0 ) ( 0 0 1 ) concrete [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 1 ) ( 1 0 0 ) concrete [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 1 0 0 ) ( 0 1 0 ) textures/Concrete_Floor [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 64 64 ) ( 64 65 64 ) ( 65 64 64 ) neon_cyan [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 64 64 ) ( 65 64 64 ) ( 64 64 65 ) concrete [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 64 64 ) ( 64 64 65 ) ( 64 65 64 ) concrete [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}
{
"classname" "info_player_start"
"origin" "32 -64 16"
"angle" "90"
}
`;

describe('parseMap', () => {
  it('parses entities, quoted values with braces, and Valve faces', () => {
    const ents = parseMap(CUBE);
    expect(ents).toHaveLength(2);
    expect(ents[0].props.message).toBe('{ tricky }');
    expect(ents[0].brushes).toHaveLength(1);
    const faces = ents[0].brushes[0].faces;
    expect(faces).toHaveLength(6);
    expect(faces[2].texture).toBe('concrete_floor'); // path stripped, lowercased
    expect(faces[0].uAxis).toEqual([0, 1, 0]);
    expect(ents[1].props.origin).toBe('32 -64 16');
  });

  it('parses Standard format faces', () => {
    const ents = parseMap(`{ "classname" "worldspawn"
{
( 0 0 0 ) ( 0 1 0 ) ( 0 0 1 ) concrete 0 0 0 1 1
} }`);
    expect(ents[0].brushes[0].faces[0].scale).toEqual([1, 1]);
    expect(ents[0].brushes[0].faces[0].uAxis).toBeUndefined();
  });

  it('reports the line of a syntax error', () => {
    expect(() => parseMap('{\n"classname" "worldspawn"\n{\n( 0 0 ) concrete\n}\n}')).toThrow(
      /line 4/,
    );
  });
});

describe('brush geometry', () => {
  const brush = parseMap(CUBE)[0].brushes[0];

  it('builds a cube: 6 quads, 2 m on a side, Z-up converted to Y-up', () => {
    const b = buildBrush(brush)!;
    expect(b.polygons).toHaveLength(6);
    for (const p of b.polygons) expect(p.vertices).toHaveLength(4);
    // Quake (0..64, 0..64, 0..64) → world x 0..2, y 0..2, z -2..0
    expect(b.min.toArray()).toEqual([0, 0, -2]);
    expect(b.max.toArray()).toEqual([2, 2, 0]);
  });

  it('has outward normals and CCW winding (front faces visible from outside)', () => {
    const b = buildBrush(brush)!;
    const center = new Vector3(1, 1, -1);
    for (const p of b.polygons) {
      expect(p.normal.dot(new Vector3().subVectors(p.vertices[0], center))).toBeGreaterThan(0);
      const [a, c, d] = p.vertices;
      const winding = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(d, a));
      expect(winding.dot(p.normal)).toBeGreaterThan(0);
    }
    expect(b.polygons.find((p) => p.normal.y > 0.99)!.texture).toBe('neon_cyan'); // top
  });

  it('tolerates reversed winding in the file', () => {
    const flipped = {
      ...brush,
      faces: brush.faces.map((f) => ({
        ...f,
        points: [f.points[2], f.points[1], f.points[0]] as typeof f.points,
      })),
    };
    expect(buildBrush(flipped)?.polygons).toHaveLength(6);
  });

  it('point containment', () => {
    const b = buildBrush(brush)!;
    expect(brushContains(b, new Vector3(1, 1, -1))).toBe(true);
    expect(brushContains(b, new Vector3(3, 1, -1))).toBe(false);
  });

  it('converts coordinates and angles', () => {
    expect(toWorld([32, -64, 16]).toArray()).toEqual([1, 0.5, 2]);
    // angle 90 (+Y in Quake) is -Z in game space, which is camera yaw 0
    expect(angleToYaw(90)).toBeCloseTo(0);
  });
});

describe('test course level', () => {
  const data = buildLevelData(readFileSync('maps/test_course.map', 'utf8'));
  const castDown = (x: number, z: number) => {
    const hit = data.collision.boundsTree.raycastFirst(
      new Ray(new Vector3(x, 50, z), new Vector3(0, -1, 0)),
      2, // DoubleSide
    );
    return hit?.point.y ?? null;
  };

  it('builds without warnings and finds the player start', () => {
    expect(data.warnings).toEqual([]);
    expect(data.playerStart.position.x).toBeCloseTo(0);
    expect(data.playerStart.position.z).toBeCloseTo(0);
    expect(data.playerStart.yaw).toBeCloseTo(0);
  });

  it('collision matches authored heights', () => {
    expect(castDown(0, 0)).toBeCloseTo(0); // floor
    expect(castDown(-33, -13)).toBeCloseTo(3); // stair landing
    expect(castDown(-13, -10)).toBeCloseTo(1.0); // first mantle ledge
    expect(castDown(-13, -40)).toBeCloseTo(3.2); // tall wall
  });

  it('clip brushes collide but do not render', () => {
    const hit = data.collision.boundsTree.raycastFirst(
      new Ray(new Vector3(0, 1, -60), new Vector3(0, 0, -1)),
      2,
    );
    expect(hit?.point.z).toBeCloseTo(-69.8);
    expect(data.renderGeometry.has('clip')).toBe(false);
    expect(data.renderGeometry.has('concrete_floor')).toBe(true);
  });

  it('collects point entities', () => {
    expect(data.entities.filter((e) => e.classname === 'light_point')).toHaveLength(2);
  });
});
