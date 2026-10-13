import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScriptedInput, type ScriptStep } from '../src/core/input';
import { MOVE, PlayerController } from '../src/player/controller';
import { SETTINGS } from '../src/settings';
import { buildLevelData } from '../src/world/level';

// Headless movement sim on the generated test course (see scripts/gen-test-course.ts for layout).
// Lanes run along -Z; yaw 0 faces -Z.

const DT = 1 / 120;
const level = buildLevelData(readFileSync('maps/test_course.map', 'utf8'));

interface Trace {
  ctrl: PlayerController;
  maxY: number;
  states: Set<string>;
  /** Samples of [time, state, horizontal speed, y]. */
  samples: [number, string, number, number][];
}

function run(
  start: [number, number, number],
  script: ScriptStep[],
  seconds: number,
  yaw = 0,
): Trace {
  const ctrl = new PlayerController(level.collision);
  ctrl.teleport(new Vector3(...start));
  const input = new ScriptedInput(script);
  const trace: Trace = { ctrl, maxY: -Infinity, states: new Set(), samples: [] };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    input.advance(DT);
    ctrl.step(DT, input.sample(), yaw);
    trace.maxY = Math.max(trace.maxY, ctrl.position.y);
    trace.states.add(ctrl.state);
    trace.samples.push([(i + 1) * DT, ctrl.state, ctrl.horizontalSpeed, ctrl.position.y]);
  }
  return trace;
}

/** First sample at or after time t. */
const at = (tr: Trace, t: number) => tr.samples.find((s) => s[0] >= t - 1e-9)!;

describe('movement', () => {
  beforeEach(() => {
    // Tests assume the coded defaults, not someone's saved tuning.
    SETTINGS.sprintToggle = true;
    SETTINGS.crouchToggle = true;
  });

  it('settles on the floor and stays put', () => {
    const tr = run([0, 0.5, 0], [{ t: 0 }], 1.5);
    expect(tr.ctrl.grounded).toBe(true);
    expect(tr.ctrl.position.y).toBeCloseTo(0, 3);
    expect(tr.ctrl.position.x).toBeCloseTo(0, 4);
    expect(tr.ctrl.position.z).toBeCloseTo(0, 4);
  });

  it('walks at walk speed, sprints, tac-sprints', () => {
    const tr = run(
      [0, 0, 8],
      [
        { t: 0, down: ['forward'] },
        { t: 1.0, down: ['forward', 'sprint'] },
        { t: 1.05, down: ['forward'] },
        { t: 2.0, down: ['forward', 'sprint'] },
        { t: 2.05, down: ['forward'] },
      ],
      2.8,
      Math.PI / 2, // face -X along the open area at the start
    );
    expect(at(tr, 0.9)[2]).toBeCloseTo(MOVE.walkSpeed, 1);
    expect(at(tr, 0.9)[1]).toBe('walk');
    expect(at(tr, 1.9)[2]).toBeCloseTo(MOVE.sprintSpeed, 1);
    expect(at(tr, 1.9)[1]).toBe('sprint');
    expect(at(tr, 2.7)[2]).toBeCloseTo(MOVE.tacSprintSpeed, 1);
    expect(at(tr, 2.7)[1]).toBe('tacSprint');
  });

  it('jumps to jump height', () => {
    const tr = run([0, 0, 0], [{ t: 0.2, down: ['jump'] }, { t: 0.3 }], 1.5);
    expect(tr.maxY).toBeGreaterThan(MOVE.jumpHeight - 0.05);
    expect(tr.maxY).toBeLessThan(MOVE.jumpHeight + 0.05);
    expect(tr.ctrl.grounded).toBe(true);
  });

  it('climbs stairs without snagging', () => {
    const tr = run([-33, 0, -4.5], [{ t: 0, down: ['forward'] }, { t: 2.0 }], 3); // landing ends at z -16.2
    expect(tr.ctrl.position.y).toBeCloseTo(3, 2);
    expect(tr.ctrl.position.z).toBeLessThan(-11);
    expect(tr.states.has('air')).toBe(false); // no hopping up the steps
    // Stairs shouldn't feel like mud: average speed close to walk speed.
    const t0 = tr.samples.find((s) => s[3] > 0.1)![0];
    const t1 = tr.samples.find((s) => s[3] > 2.9)![0];
    expect(((3 / 0.25) * 0.35) / (t1 - t0)).toBeGreaterThan(MOVE.walkSpeed * 0.75);
  });

  it('walks up a 20° ramp but not a 50° one', () => {
    const easy = run([-23, 0, -4], [{ t: 0, down: ['forward'] }], 3);
    expect(easy.ctrl.position.y).toBeCloseTo(Math.tan((20 * Math.PI) / 180) * 6, 1);
    const steep = run([-23, 0, -32], [{ t: 0, down: ['forward'] }], 3);
    expect(steep.ctrl.position.y).toBeLessThan(1);
  });

  for (const [h, z] of [
    [1.0, -6.5],
    [1.4, -16.5],
    [2.0, -26.5],
  ] as const) {
    it(`mantles a ${h} m ledge`, () => {
      const tr = run(
        [-13, 0, z],
        [
          { t: 0, down: ['forward'] },
          { t: 0.2, down: ['forward', 'jump'] },
          { t: 0.9 }, // let go once up, so we don't walk off the far side
        ],
        2,
      );
      expect(tr.states.has('mantle')).toBe(true);
      expect(tr.ctrl.position.y).toBeCloseTo(h, 2);
      expect(tr.ctrl.position.z).toBeLessThan(z - 1.5);
    });
  }

  it('cannot mantle a 3.2 m wall', () => {
    const tr = run(
      [-13, 0, -36.5],
      [
        { t: 0, down: ['forward'] },
        { t: 0.2, down: ['forward', 'jump'] },
      ],
      2,
    );
    expect(tr.states.has('mantle')).toBe(false);
    expect(tr.ctrl.position.y).toBeCloseTo(0, 2);
  });

  it('stands on a ledge edge without sliding off', () => {
    const tr = run([-13, 1.05, -7.8], [{ t: 0 }], 1);
    // A round capsule resting on a corner sits a little lower than on flat ground.
    expect(tr.ctrl.grounded).toBe(true);
    expect(tr.ctrl.position.y).toBeGreaterThan(0.9);
    expect(tr.ctrl.position.z).toBeCloseTo(-7.8, 2);
  });

  const slideScript: ScriptStep[] = [
    { t: 0, down: ['forward'] },
    { t: 0.1, down: ['forward', 'sprint'] },
    { t: 0.15, down: ['forward'] },
    { t: 1.0, down: ['forward', 'crouch'] },
    { t: 1.05, down: ['forward'] },
  ];

  it('slides with a boost, then flows back into a sprint while holding forward', () => {
    const tr = run([0, 0, -2], slideScript, 2.2);
    expect(at(tr, 1.02)[1]).toBe('slide');
    expect(at(tr, 1.02)[2]).toBeGreaterThan(MOVE.sprintSpeed + 2);
    expect(at(tr, 1.4)[2]).toBeLessThan(at(tr, 1.02)[2]); // friction bleeds speed
    const after = tr.samples.filter((x) => x[0] > 1.1 && x[1] !== 'slide');
    // Never drops below sprint-ish pace on the way out, and is sprinting again.
    expect(Math.min(...after.map((x) => x[2]))).toBeGreaterThan(MOVE.slideExitSpeed - 0.5);
    expect(tr.ctrl.state).toBe('sprint');
    expect(tr.ctrl.horizontalSpeed).toBeCloseTo(MOVE.sprintSpeed, 1);
  });

  it('ends crouched when forward is released during the slide', () => {
    const tr = run([0, 0, -2], [...slideScript, { t: 1.1 }], 3);
    expect(tr.ctrl.state).toBe('crouch');
  });

  it('slides a good distance on flat ground', () => {
    const tr = run([0, 0, -2], slideScript, 3);
    const start = tr.samples.findIndex((x) => x[1] === 'slide');
    const end = tr.samples.findIndex((x, i) => i > start && x[1] !== 'slide');
    const dist = tr.samples.slice(start, end).reduce((acc, x) => acc + x[2] * DT, 0);
    // ~6 m, but quicker than before (higher boost, ends at sprint pace). 7–9 m felt too far.
    expect(dist).toBeGreaterThan(5);
    expect(dist).toBeLessThan(6.5);
  });

  it('slide-jump keeps momentum', () => {
    const tr = run(
      [0, 0, -2],
      [...slideScript, { t: 1.2, down: ['forward', 'jump'] }, { t: 1.25, down: ['forward'] }],
      1.4,
    );
    const before = at(tr, 1.19)[2];
    const after = at(tr, 1.3);
    expect(after[1]).toBe('air');
    expect(after[2]).toBeGreaterThan(before * 0.9);
  });

  it('slide-cancel (crouch again) stands back up into a sprint', () => {
    const tr = run(
      [0, 0, -2],
      [...slideScript, { t: 1.3, down: ['forward', 'crouch'] }, { t: 1.35, down: ['forward'] }],
      1.6,
    );
    expect(at(tr, 1.4)[1]).toBe('sprint');
    expect(tr.ctrl.posture).toBe('stand');
  });

  it('crouches through the low tunnel but cannot stand inside it', () => {
    const tr = run(
      [0, 0, -21],
      [
        { t: 0, down: ['crouch'] },
        { t: 0.05, down: ['forward'] },
        { t: 3.0, down: ['forward', 'crouch'] }, // try to stand up while inside
        { t: 3.05, down: ['forward'] },
      ],
      5,
    );
    const inside = tr.samples.filter((s) => s[0] > 3.1 && s[0] < 3.3);
    expect(inside.every((s) => s[1] === 'crouch')).toBe(true);
    expect(tr.ctrl.position.z).toBeLessThan(-30.5); // made it out the far side
    expect(tr.ctrl.posture).toBe('stand'); // stood up once there was room
  });

  it('is stopped by clip brushes', () => {
    const tr = run([0, 0, -64], [{ t: 0, down: ['forward'] }], 3);
    expect(tr.ctrl.position.z).toBeGreaterThan(-69.8 + MOVE.radius - 0.02);
  });

  it('slides along walls instead of sticking', () => {
    // Run diagonally into the +X perimeter wall (inner face at x = 40).
    const tr = run([37, 0, 0], [{ t: 0, down: ['forward'] }], 2, -Math.PI / 4);
    expect(tr.ctrl.position.x).toBeLessThan(40 - MOVE.radius + 0.02);
    expect(tr.ctrl.position.z).toBeLessThan(-4);
  });
});
