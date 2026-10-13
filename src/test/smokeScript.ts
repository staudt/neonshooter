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
