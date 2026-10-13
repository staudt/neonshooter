import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { initNavigation, Navigation } from '../src/ai/navigation';
import { buildLevelData } from '../src/world/level';

describe('navigation', () => {
  let nav: Navigation;
  beforeAll(async () => {
    await initNavigation();
    nav = Navigation.build(buildLevelData(readFileSync('maps/test_course.map', 'utf8')).collision);
  });

  it('bakes a navmesh with the floor walkable', () => {
    const p = nav.closest(new Vector3(0, 0.5, 0));
    expect(p).not.toBeNull();
    expect(p!.y).toBeCloseTo(0, 0);
  });

  it('crowd agents walk toward a target', () => {
    const agent = nav.addAgent(new Vector3(0, 0, 5), 0.45, 4, 12);
    agent.requestMoveTarget(new Vector3(-10, 0, 5));
    for (let i = 0; i < 240; i++) nav.update(1 / 120);
    const p = agent.position();
    expect(p.x).toBeLessThan(-5);
  });

  it('does not path onto the 50° ramp top through the ramp', () => {
    // top of the steep ramp platform is ~7 m up: closest point near its face should stay on the floor
    const p = nav.closest(new Vector3(-23, 1, -36));
    expect(p!.y).toBeLessThan(1.5);
  });
});
