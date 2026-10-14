/**
 * Quake-style entity I/O: anything with a `targetname` can be "used"; triggers, relays and
 * encounters fire their `target` (optionally after a `delay`). Maps wire behaviour, the game only
 * defines what each classname does when used. Headless (no DOM / renderer).
 *
 * `target` may name several entities separated by commas or spaces.
 */
export type UseHandler = (activator: string) => void;

export class EntityIO {
  private readonly handlers = new Map<string, UseHandler[]>();
  private queue: { t: number; name: string; by: string }[] = [];
  /** Every fire, in order (tests / debugging). */
  readonly log: string[] = [];

  /** Register what happens when `name` is used. */
  on(name: string | undefined, fn: UseHandler) {
    if (!name) return;
    let list = this.handlers.get(name);
    if (!list) this.handlers.set(name, (list = []));
    list.push(fn);
  }

  has(name: string) {
    return this.handlers.has(name);
  }

  /** Use every entity named in `target` (now, or after `delay` seconds). */
  fire(target: string | undefined, activator = '', delay = 0) {
    for (const name of splitTargets(target)) {
      if (delay > 0) this.queue.push({ t: delay, name, by: activator });
      else this.use(name, activator);
    }
  }

  private use(name: string, by: string) {
    this.log.push(name);
    for (const fn of this.handlers.get(name) ?? []) fn(by);
  }

  step(dt: number) {
    if (!this.queue.length) return;
    const due = this.queue.filter((q) => (q.t -= dt) <= 0);
    this.queue = this.queue.filter((q) => q.t > 0);
    for (const q of due) this.use(q.name, q.by);
  }

  /** Drop pending delayed fires (death / reset). */
  clearPending() {
    this.queue.length = 0;
  }
}

export function splitTargets(target: string | undefined): string[] {
  return (target ?? '').split(/[\s,]+/).filter(Boolean);
}
