export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` (scaled game time). */
  step(dt: number): void;
  /** Draw. `alpha` in [0,1) blends previous→current sim state; `frameDt` is real seconds. */
  render(alpha: number, frameDt: number): void;
}

/**
 * Fixed-timestep loop with render interpolation. `timeScale` slows the sim (slow-mo)
 * without changing the step size, so physics stays deterministic.
 */
export class FixedLoop {
  timeScale = 1;
  private acc = 0;
  private last = -1;
  private raf = 0;

  constructor(
    readonly dt: number,
    private cb: LoopCallbacks,
    private maxStepsPerFrame = 8,
  ) {}

  start() {
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      this.tick(now / 1000);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.last = -1;
  }

  tick(nowSec: number) {
    if (this.last < 0) this.last = nowSec;
    const frameDt = Math.min(nowSec - this.last, 0.25);
    this.last = nowSec;
    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxStepsPerFrame) {
      this.cb.step(this.dt);
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.acc = 0; // drop backlog rather than spiral
    this.cb.render(this.acc / this.dt, frameDt);
  }
}
