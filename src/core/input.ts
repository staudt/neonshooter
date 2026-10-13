export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'fire'
  | 'ads'
  | 'reload'
  | 'swap'
  | 'weapon1'
  | 'weapon2'
  | 'interact'
  | 'melee'
  | 'shield'
  | 'noclip';

/** One sim step's view of the controls. `pressed`/`released` are edges since the previous sample. */
export interface InputState {
  readonly down: ReadonlySet<Action>;
  readonly pressed: ReadonlySet<Action>;
  readonly released: ReadonlySet<Action>;
}

export interface InputSource {
  /** Look delta (pixels) accumulated since last call. Consumed once per render frame. */
  consumeLook(): { dx: number; dy: number };
  /** Snapshot for one sim step. Clears edge sets so each press is seen exactly once. */
  sample(): InputState;
  /** Advance time-driven sources (scripted input). Browser input ignores it. */
  advance?(dt: number): void;
}

const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  ShiftLeft: 'sprint',
  KeyR: 'reload',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  KeyF: 'interact',
  KeyE: 'melee',
  KeyQ: 'shield',
  KeyV: 'noclip',
};

const MOUSE_BINDINGS: Record<number, Action> = { 0: 'fire', 2: 'ads' };

/** Shared edge-tracking used by both browser and scripted input. */
class EdgeTracker implements InputState {
  down = new Set<Action>();
  pressed = new Set<Action>();
  released = new Set<Action>();

  press(a: Action) {
    if (!this.down.has(a)) this.pressed.add(a);
    this.down.add(a);
  }

  release(a: Action) {
    if (this.down.has(a)) this.released.add(a);
    this.down.delete(a);
  }

  snapshot(): InputState {
    const snap: InputState = {
      down: new Set(this.down),
      pressed: this.pressed,
      released: this.released,
    };
    this.pressed = new Set();
    this.released = new Set();
    return snap;
  }
}

export class BrowserInput implements InputSource {
  private edges = new EdgeTracker();
  private lookX = 0;
  private lookY = 0;
  locked = false;

  constructor(
    private canvas: HTMLElement,
    onLockChange: (locked: boolean) => void,
  ) {
    window.addEventListener('keydown', (e) => {
      const a = KEY_BINDINGS[e.code];
      if (!a || !this.locked) return;
      e.preventDefault();
      if (!e.repeat) this.edges.press(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEY_BINDINGS[e.code];
      if (a) this.edges.release(a);
    });
    window.addEventListener('mousedown', (e) => {
      const a = MOUSE_BINDINGS[e.button];
      if (a && this.locked) this.edges.press(a);
    });
    window.addEventListener('mouseup', (e) => {
      const a = MOUSE_BINDINGS[e.button];
      if (a) this.edges.release(a);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) for (const a of [...this.edges.down]) this.edges.release(a);
      onLockChange(this.locked);
    });
  }

  async lock() {
    try {
      // Raw input: bypass OS mouse acceleration where supported.
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      await this.canvas.requestPointerLock();
    }
  }

  consumeLook() {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = this.lookY = 0;
    return r;
  }

  sample() {
    return this.edges.snapshot();
  }
}

/** A keyframe in a scripted input timeline: from time `t` (s), hold `down` and look at `look` px/s. */
export interface ScriptStep {
  t: number;
  down?: Action[];
  look?: [number, number];
}

/** Deterministic input for smoke tests and headless sim tests. */
export class ScriptedInput implements InputSource {
  private edges = new EdgeTracker();
  private time = 0;
  private lookX = 0;
  private lookY = 0;

  constructor(private steps: ScriptStep[]) {
    this.steps = [...steps].sort((a, b) => a.t - b.t);
  }

  get elapsed() {
    return this.time;
  }

  get done() {
    return this.time >= (this.steps.at(-1)?.t ?? 0);
  }

  private current(): ScriptStep | undefined {
    let cur: ScriptStep | undefined;
    for (const s of this.steps) if (s.t <= this.time) cur = s;
    return cur;
  }

  advance(dt: number) {
    this.time += dt;
    const cur = this.current();
    const want = new Set(cur?.down ?? []);
    for (const a of [...this.edges.down]) if (!want.has(a)) this.edges.release(a);
    for (const a of want) this.edges.press(a);
    if (cur?.look) {
      this.lookX += cur.look[0] * dt;
      this.lookY += cur.look[1] * dt;
    }
  }

  consumeLook() {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = this.lookY = 0;
    return r;
  }

  sample() {
    return this.edges.snapshot();
  }
}
