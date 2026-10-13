import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Backdrop, backdropOptionsFor } from '../src/world/backdrop';
import { buildLevelData } from '../src/world/level';
import { buildSigns } from '../src/world/signs';

const data = buildLevelData(readFileSync('maps/station_slice.map', 'utf8'));

describe('station_slice (look slice)', () => {
  it('loads cleanly with every texture in the palette', () => {
    expect(data.warnings).toEqual([]);
    expect(data.playerStart.position.z).toBeLessThan(0);
  });

  it('carries worldspawn backdrop keys', () => {
    expect(data.worldProps.backdrop).toBe('city');
    expect(Number(data.worldProps.corruption)).toBeGreaterThan(0);
  });

  it('has signs with text, style and a facing', () => {
    const signs = data.entities.filter((e) => e.classname === 'info_sign');
    expect(signs.length).toBeGreaterThanOrEqual(8);
    for (const s of signs) {
      expect(s.props.text?.length).toBeGreaterThan(0);
      expect(s.props.style).toBeTruthy();
      expect(Number(s.props.width)).toBeGreaterThan(0);
    }
    // headless: no canvas, so no sign meshes (and no crash)
    expect(buildSigns(signs).children).toHaveLength(0);
  });

  it('backdrop options come from worldspawn + bounds; the city builds headless', () => {
    const bounds = data.collision.boundingBox!;
    const opts = backdropOptionsFor(data.worldProps, bounds, 0x000000);
    expect(opts.mode).toBe('city');
    expect(opts.radius).toBeGreaterThan(20);
    expect(opts.spireDir.length()).toBeCloseTo(1);
    const b = new Backdrop(opts);
    expect(b.scene.children.length).toBeGreaterThan(3);
    b.dispose();
    expect(backdropOptionsFor({}, bounds, 0).mode).toBe('none');
    expect(new Backdrop({ ...opts, mode: 'none' }).scene.children).toHaveLength(0);
  });

  it('the open side is fenced by clip: the void is not walkable from the catwalk', () => {
    // a clip wall sits just past the railing at x ≈ 12.5
    const clipFaces = [...Array(data.collision.attributes.position.count / 3).keys()].filter(
      (t) => data.surfaceAt(t * 3) === 'clip',
    );
    expect(clipFaces.length).toBeGreaterThan(0);
    const p = data.collision.attributes.position;
    const xs = clipFaces.map((t) => p.getX(t * 3));
    expect(Math.min(...xs)).toBeGreaterThan(12);
  });
});
