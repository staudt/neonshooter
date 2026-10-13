import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TRACER, Tracers } from '../src/fx/tracers';

describe('tracers', () => {
  it('retire after reaching the impact (no permanent streaks)', () => {
    const tr = new Tracers();
    tr.spawn(new Vector3(0, 0, 0), new Vector3(0, 0, -30)); // short shot: shorter than travel per frame × few
    tr.spawn(new Vector3(0, 0, 0), new Vector3(0, 0, -200));
    tr.spawn(new Vector3(0, 0, 0), new Vector3(0, 0, -2)); // point blank
    const lifetime = (200 + TRACER.length) / TRACER.speed;
    for (let t = 0; t < lifetime + 0.1; t += 1 / 144) tr.update(1 / 144);
    expect(tr.liveCount).toBe(0);
    expect(tr.root.children.length).toBe(0);
  });
});
