import type GUI from 'lil-gui';

type Num = number;
/** [min, max, step] for a numeric tunable. Booleans need no range. */
export type Range = [Num, Num, Num?];

interface Group {
  name: string;
  values: Record<string, number | boolean>;
  defaults: Record<string, number | boolean>;
  ranges: Record<string, Range>;
}

const STORAGE_KEY = 'neon.tuning';
const groups: Group[] = [];

function loadOverrides(): Record<string, Record<string, number | boolean>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveOverrides() {
  const out: Record<string, Record<string, number | boolean>> = {};
  for (const g of groups) {
    const diff: Record<string, number | boolean> = {};
    for (const k in g.values) if (g.values[k] !== g.defaults[k]) diff[k] = g.values[k];
    if (Object.keys(diff).length) out[g.name] = diff;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable (tests, private mode) */
  }
}

/**
 * Declare a group of live-tunable values. Returns a plain mutable object: read it every
 * step (never cache fields) so slider changes apply immediately. Saved overrides from
 * localStorage are applied on load; defaults in code stay the source of truth.
 */
export function defineTunables<T extends Record<string, number | boolean>>(
  name: string,
  defaults: T,
  ranges: Partial<Record<keyof T, Range>> = {},
): T {
  const values = { ...defaults };
  const saved = typeof localStorage === 'undefined' ? {} : (loadOverrides()[name] ?? {});
  for (const k in saved) if (k in values) (values as Record<string, unknown>)[k] = saved[k];
  groups.push({ name, values, defaults, ranges: ranges as Record<string, Range> });
  return values;
}

function guessRange(v: number): Range {
  const mag = Math.max(Math.abs(v) * 4, 1);
  return [v < 0 ? -mag : 0, mag, mag / 200];
}

/** Build the lil-gui panel (dev builds only). Toggle with backquote. */
export async function mountTuningPanel() {
  const { default: GUIClass } = await import('lil-gui');
  const gui: GUI = new GUIClass({ title: 'Tuning  [ ` ]' });
  gui.hide();
  for (const g of groups) {
    const f = gui.addFolder(g.name).close();
    for (const k in g.values) {
      const v = g.values[k];
      const ctrl =
        typeof v === 'boolean'
          ? f.add(g.values, k)
          : f.add(g.values, k, ...(g.ranges[k] ?? guessRange(g.defaults[k] as number)));
      ctrl.onChange(saveOverrides);
    }
  }
  gui.add(
    {
      'copy overrides JSON': () => {
        saveOverrides();
        void navigator.clipboard.writeText(localStorage.getItem(STORAGE_KEY) ?? '{}');
      },
    },
    'copy overrides JSON',
  );
  gui.add(
    {
      'reset all': () => {
        localStorage.removeItem(STORAGE_KEY);
        for (const g of groups) Object.assign(g.values, g.defaults);
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    },
    'reset all',
  );
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') gui.show(gui._hidden);
  });
}
