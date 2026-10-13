import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DRONE, Drone } from '../src/ai/drone';

describe('drone size', () => {
  it('hit volumes scale with the model (bigger drones are easier to hit)', () => {
    const d = new Drone(new Vector3(0, 3, 0), 0, '', 0);
    expect(d.root.scale.x).toBe(DRONE.scale);
    // A ray passing 0.5 m beside the center: misses a scale-1 drone (radius ~0.32), hits a scale-2 one.
    const ray = new Ray(new Vector3(0.5, 3, 10), new Vector3(0, 0, -1));
    expect(d.raycast(ray, 50)).not.toBeNull();
    d.root.scale.setScalar(1);
    expect(d.raycast(ray, 50)).toBeNull();
  });
});
