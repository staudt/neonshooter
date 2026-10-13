import { Vector3 } from 'three';

/**
 * Damped spring parameterised by frequency (Hz) and damping ratio (1 = critical).
 * Integrated implicitly, so it stays stable for any stiffness at our step sizes.
 */
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  constructor(
    public frequency = 8,
    public damping = 1,
  ) {}

  step(dt: number) {
    const w = 2 * Math.PI * this.frequency;
    const k = w * w;
    const c = 2 * this.damping * w;
    this.velocity =
      (this.velocity - dt * k * (this.value - this.target)) / (1 + dt * c + dt * dt * k);
    this.value += dt * this.velocity;
    return this.value;
  }

  impulse(v: number) {
    this.velocity += v;
  }

  reset(v = 0) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}

export class Spring3 {
  readonly value = new Vector3();
  readonly velocity = new Vector3();
  readonly target = new Vector3();

  constructor(
    public frequency = 8,
    public damping = 1,
  ) {}

  step(dt: number) {
    const w = 2 * Math.PI * this.frequency;
    const k = w * w;
    const c = 2 * this.damping * w;
    const denom = 1 + dt * c + dt * dt * k;
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = (this.velocity[axis] - dt * k * (this.value[axis] - this.target[axis])) / denom;
      this.velocity[axis] = v;
      this.value[axis] += dt * v;
    }
    return this.value;
  }

  impulse(x: number, y: number, z: number) {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }

  reset() {
    this.value.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.target.set(0, 0, 0);
  }
}
