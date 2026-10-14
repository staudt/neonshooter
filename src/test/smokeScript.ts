import type { ScriptStep } from '../core/input';

/**
 * Scripted input for `?test=smoke` on the test course, starting at the player start (lane D,
 * facing -Z). Main's smoke report turns what happened into checks; extend both as mechanics land.
 */
export const SMOKE_SCRIPT: ScriptStep[] = [
  { t: 0 },
  { t: 0.2, down: ['forward'] },
  { t: 0.5, down: ['forward', 'sprint'] },
  { t: 0.55, down: ['forward'] },
  { t: 1.2, down: ['forward', 'crouch'] }, // slide
  { t: 1.25, down: ['forward'] },
  { t: 1.6, down: ['forward', 'jump'] }, // slide-jump
  { t: 1.65, down: ['forward'], look: [150, 0] },
  { t: 2.4, down: ['fire', 'ads'], look: [-150, -30] },
  { t: 3.0, down: ['reload'] },
  { t: 3.05 },
  { t: 4.3 },
];

/**
 * `?test=smoke&map=arena_test`: sprint through the corridor into arena A (starts the encounter),
 * then strafe and shoot while the grunts open fire.
 */
export const COMBAT_SMOKE_SCRIPT: ScriptStep[] = [
  { t: 0 },
  { t: 0.2, down: ['forward'] },
  { t: 0.4, down: ['forward', 'sprint'] },
  { t: 0.45, down: ['forward'] },
  { t: 3.6, down: ['left', 'fire', 'ads'] },
  { t: 5.0, down: ['right', 'fire', 'ads'] },
  { t: 6.4, down: ['back'] },
  { t: 7.0 },
];

/**
 * `?test=smoke&map=station_slice`: sprint + slide out of the maintenance tunnel into the station
 * hall (starts the encounter), turn toward the open side (skyline) and fire at the fliers.
 */
export const STATION_SMOKE_SCRIPT: ScriptStep[] = [
  { t: 0 },
  { t: 0.2, down: ['forward'] },
  { t: 0.4, down: ['forward', 'sprint'] },
  { t: 0.45, down: ['forward'] },
  { t: 1.3, down: ['forward', 'crouch'] }, // slide
  { t: 1.35, down: ['forward'] },
  { t: 2.4, down: ['forward'], look: [110, -25] },
  { t: 2.9, down: ['fire', 'ads'] },
  { t: 4.2, down: ['right'] },
  { t: 4.8, down: ['shield'] }, // block with the shield
  { t: 5.7 },
  { t: 5.8, down: ['weapon2'] }, // pistol + knife
  { t: 5.85 },
  { t: 6.5, down: ['melee'] },
  { t: 6.55 },
  { t: 7.2 },
];

/** What main tracks during a smoke run (input to each map's checks). */
export interface SmokeStats {
  states: ReadonlySet<string>;
  maxSpeed: number;
  maxEnemies: number;
  encounters: number;
  enemyShots: number;
  shots: number;
  reloads: number;
  melees: number;
  shieldRaises: number;
}

export interface SmokeRun {
  script: ScriptStep[];
  /** Each must be true or scripts/smoke.mjs fails. */
  checks(s: SmokeStats): Record<string, boolean>;
  /** Fixed free-camera vantage for the overview screenshot (yaw/pitch radians). */
  overview: { pos: [number, number, number]; yaw: number; pitch: number };
}

const movementChecks = (s: SmokeStats) => ({
  sprinted: s.states.has('sprint'),
  slid: s.states.has('slide'),
  jumped: s.states.has('air'),
  fastSlide: s.maxSpeed > 9,
  fired: s.shots > 3,
  reloaded: s.reloads > 0,
});

const HALL_VANTAGE = { pos: [-11, 7.5, -18] as [number, number, number], yaw: -0.55, pitch: -0.28 };

/** Test config per map (the game itself has no per-map code). Unlisted maps use `default`. */
export const SMOKE_RUNS: Record<string, SmokeRun> = {
  default: { script: SMOKE_SCRIPT, checks: movementChecks, overview: { pos: [0, 16, 16], yaw: 0, pitch: -0.5 } },
  arena_test: {
    script: COMBAT_SMOKE_SCRIPT,
    checks: (s) => ({
      encounterStarted: s.encounters > 0,
      enemiesSpawned: s.maxEnemies >= 3,
      enemiesFired: s.enemyShots > 0,
      playerFired: s.shots > 3,
    }),
    overview: { pos: [0, 14, -20], yaw: 0, pitch: -0.6 },
  },
  station_slice: {
    script: STATION_SMOKE_SCRIPT,
    checks: (s) => ({
      sprinted: s.states.has('sprint'),
      slid: s.states.has('slide'),
      encounterStarted: s.encounters > 0,
      enemiesSpawned: s.maxEnemies >= 3,
      playerFired: s.shots > 3,
      shielded: s.shieldRaises > 0,
      meleed: s.melees > 0,
    }),
    overview: HALL_VANTAGE,
  },
  stage1: { script: SMOKE_SCRIPT, checks: movementChecks, overview: HALL_VANTAGE },
};
