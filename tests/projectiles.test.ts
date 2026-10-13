import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Projectiles, segmentSegmentDistSq } from '../src/ai/projectiles';
import { buildLevelData } from '../src/world/level';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DT = 1 / 120;

describe('segmentSegmentDistSq', () => {
  it('parallel segments: perpendicular offset', () => {
    expect(segmentSegmentDistSq(V(0, 0, 0), V(10, 0, 0), V(0, 3, 0), V(10, 3, 0))).toBeCloseTo(9);
  });
  it('parallel, disjoint along the axis: end-to-end gap', () => {
    expect(segmentSegmentDistSq(V(0, 0, 0), V(1, 0, 0), V(4, 0, 0), V(6, 0, 0))).toBeCloseTo(9);
  });
  it('crossing segments: zero', () => {
    expect(segmentSegmentDistSq(V(-1, 0, 0), V(1, 0, 0), V(0, 0, -1), V(0, 0, 1))).toBeCloseTo(0);
  });
  it('skew segments: separation along the common perpendicular', () => {
    expect(segmentSegmentDistSq(V(-1, 0, 0), V(1, 0, 0), V(0, 2, -1), V(0, 2, 1))).toBeCloseTo(4);
  });
  it('skew with clamped endpoints', () => {
    // segment 2 is far off the end of segment 1: closest are (1,0,0) and (3,0,1)... 2^2+1
    expect(segmentSegmentDistSq(V(0, 0, 0), V(1, 0, 0), V(3, 0, 1), V(3, 0, 5))).toBeCloseTo(5);
  });
  it('degenerate: point vs point, point vs segment, segment vs point', () => {
    expect(segmentSegmentDistSq(V(1, 1, 1), V(1, 1, 1), V(4, 5, 1), V(4, 5, 1))).toBeCloseTo(25);
    expect(segmentSegmentDistSq(V(5, 2, 0), V(5, 2, 0), V(0, 0, 0), V(10, 0, 0))).toBeCloseTo(4);
    expect(segmentSegmentDistSq(V(0, 0, 0), V(10, 0, 0), V(15, 0, 0), V(15, 0, 0))).toBeCloseTo(25);
  });
});

describe('Projectiles', () => {
  const level = buildLevelData(readFileSync('maps/arena_test.map', 'utf8'));
  const colliders = [level.collision];
  const R = 0.35;
  const H = 1.8;
  const capAt = (x: number, z: number) => ({
    a: V(x, R, z),
    b: V(x, H - R, z),
    radius: R,
  });

  it('hits a stationary player 15 m away within 0.6 s, passing damage through', () => {
    const p = new Projectiles();
    // open floor in arena A: line along +X at z = -30, y = 1
    p.fire(V(-8, 1, -30), V(26, 0, 0), 12);
    expect(p.count).toBe(1);
    const hits = [];
    let t = 0;
    for (; t < 0.7 && p.count > 0; t += DT) hits.push(...p.step(DT, colliders, capAt(7, -30)));
    expect(t).toBeLessThan(0.6);
    expect(hits).toHaveLength(1);
    expect(hits[0].hitPlayer).toBe(true);
    expect(hits[0].damage).toBe(12);
    expect(hits[0].from.x).toBeCloseTo(-8);
    expect(p.count).toBe(0);
  });

  it('is dodgeable: a player strafing at 5 m/s is missed', () => {
    const p = new Projectiles();
    p.fire(V(-8, 1, -30), V(26, 0, 0), 12); // aimed where the player WAS
    const impacts = [];
    let z = -30;
    for (let t = 0; t < 1.5; t += DT) {
      z -= 5 * DT;
      impacts.push(...p.step(DT, colliders, capAt(7, z)));
    }
    expect(impacts.some((i) => i.hitPlayer)).toBe(false);
  });

  it('a bolt fired into a wall impacts the wall and is removed', () => {
    const p = new Projectiles();
    p.fire(V(0, 1.5, -29), V(26, 0, 0), 12);
    const impacts = [];
    for (let t = 0; t < 1.2 && p.count > 0; t += DT) impacts.push(...p.step(DT, colliders, null));
    expect(p.count).toBe(0);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].hitPlayer).toBe(false);
    expect(impacts[0].point.x).toBeCloseTo(20, 0);
    expect(impacts[0].normal.x).toBeLessThan(-0.9);
  });

  it('a wall between bolt and player blocks the hit', () => {
    const p = new Projectiles();
    p.fire(V(0, 1.5, -29), V(26, 0, 0), 12);
    const impacts = [];
    // player standing inside the side wall region would be behind it; capsule at x=22
    for (let t = 0; t < 1.2 && p.count > 0; t += DT)
      impacts.push(...p.step(DT, colliders, capAt(22, -29)));
    expect(impacts.every((i) => !i.hitPlayer)).toBe(true);
  });
});
