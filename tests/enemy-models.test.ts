import { describe, expect, it } from 'vitest';
import { AdditiveBlending, Box3, Mesh, Vector3, type Object3D } from 'three';
import { buildBolt, buildDebris, buildDrone, buildGrunt } from '../src/ai/models';

function meshes(o: Object3D): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh) out.push(c as Mesh);
  });
  return out;
}

describe('enemy models', () => {
  it('grunt has a sensible height and counts', () => {
    const g = buildGrunt();
    g.root.updateMatrixWorld(true);
    const size = new Box3().setFromObject(g.root).getSize(new Vector3());
    expect(size.y).toBeGreaterThan(1.7);
    expect(size.y).toBeLessThan(2.1);
    expect(meshes(g.root).length).toBeLessThanOrEqual(40);
  });

  it('muzzle is a turret descendant in front of it', () => {
    const g = buildGrunt();
    let p: Object3D | null = g.muzzle;
    let found = false;
    while (p) {
      if (p === g.turret) found = true;
      p = p.parent;
    }
    expect(found).toBe(true);
    expect(g.muzzle.position.z).toBeLessThan(0);
  });

  it('core hit volume matches core mesh in root space', () => {
    const g = buildGrunt();
    g.root.updateMatrixWorld(true);
    const p = g.core.getWorldPosition(new Vector3());
    expect(p.distanceTo(g.hit.core.center)).toBeLessThan(0.05);
  });

  it('materials are per instance, geometries shared', () => {
    const a = buildGrunt();
    const b = buildGrunt();
    expect(a.mats.hull).not.toBe(b.mats.hull);
    expect(a.mats.glow).not.toBe(b.mats.glow);
    expect(a.core.geometry).toBe(b.core.geometry);
    expect(a.core.material).toBe(a.mats.glow);
  });

  it('flying demon has 4 tentacles, a jaw and an eye hit volume', () => {
    const d = buildDrone();
    expect(d.tentacles).toHaveLength(4);
    for (const chain of d.tentacles) expect(chain.length).toBeGreaterThanOrEqual(4);
    expect(meshes(d.root).length).toBeLessThanOrEqual(60);
    expect(d.hit.core.center.distanceTo(d.eye.position)).toBeLessThan(0.05);
    const w = new Box3().setFromObject(d.root).getSize(new Vector3());
    expect(w.x).toBeGreaterThan(0.4);
    expect(w.x).toBeLessThan(0.8);
  });

  it('bolt and debris', () => {
    const b = buildBolt();
    const ms = meshes(b);
    expect(ms).toHaveLength(3);
    for (const m of ms)
      expect((m.material as { blending: number }).blending).toBe(AdditiveBlending);
    const g = buildGrunt();
    expect(buildDebris(7, g.mats.hull)).toHaveLength(7);
  });
});
