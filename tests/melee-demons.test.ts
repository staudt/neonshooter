import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HOUND } from '../src/ai/hound';
import { POSSESSED } from '../src/ai/possessed';
import { GameWorld } from '../src/game/session';
import type { LevelEntity } from '../src/world/level';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DT = 1 / 120;
const src = readFileSync('maps/arena_test.map', 'utf8');

let world: GameWorld;
beforeAll(async () => {
  world = await GameWorld.create(src, {
    onEncounterStart: vi.fn(),
    onWave: vi.fn(),
    onEncounterCleared: vi.fn(),
    onCheckpoint: vi.fn(),
    onStageEnd: vi.fn(),
  });
});

const entity = (classname: string, origin: Vector3): LevelEntity => ({
  classname,
  props: {},
  origin,
  yaw: 0,
  brushes: [],
});

/**
 * A static "player" (just feet/eye) in arena A's open west lane; steps the enemies directly.
 * `onCharge` can move the player when a telegraph starts (dodging).
 */
function simulate(
  classname: string,
  spawn: Vector3,
  seconds: number,
  onCharge?: (feet: Vector3) => void,
) {
  world.enemies.clearAll();
  const e = world.enemies.spawn(entity(classname, spawn), true);
  const feet = V(-7, 0, -36);
  const log = { charges: [] as number[], attacks: [] as number[], maxY: 0 };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const t = (i + 1) * DT;
    const r = world.enemies.step(DT, {
      colliders: world.colliders,
      player: { feet, eye: feet.clone().setY(feet.y + 1.6), velocity: V(0, 0, 0), alive: true },
    });
    for (const _ of r.charging) {
      log.charges.push(t);
      onCharge?.(feet);
    }
    for (const _ of r.attacks) log.attacks.push(t);
    log.maxY = Math.max(log.maxY, e.position.y);
  }
  return log;
}

describe('Possessed (melee rusher)', () => {
  it('runs down a standing player and swipes after a telegraphed wind-up', () => {
    const log = simulate('enemy_possessed', V(-7, 0, -50), 5);
    expect(log.attacks.length).toBeGreaterThan(0);
    expect(log.charges[0]).toBeLessThan(log.attacks[0]);
    expect(log.attacks[0] - log.charges[0]).toBeGreaterThanOrEqual(POSSESSED.windTime - 2 * DT);
  });

  it('backing off during the wind-up makes the claws miss', () => {
    let dodged = false;
    const log = simulate('enemy_possessed', V(-7, 0, -50), 3, (feet) => {
      if (dodged) return;
      dodged = true;
      feet.z += 3; // step back out of reach
    });
    expect(log.charges.length).toBeGreaterThan(0);
    // no hit within the first swing
    expect(log.attacks.filter((t) => t < log.charges[0] + POSSESSED.windTime + 0.1)).toHaveLength(
      0,
    );
  });
});

describe('Hound (pouncer)', () => {
  it('crouches, then pounces through the air into a standing player', () => {
    const log = simulate('enemy_hound', V(-7, 0, -52), 5);
    expect(log.charges.length).toBeGreaterThan(0);
    expect(log.attacks.length).toBeGreaterThan(0);
    expect(log.maxY).toBeGreaterThan(0.4); // it actually left the ground
  });

  it('sidestepping the crouch telegraph makes the pounce sail past', () => {
    let dodged = false;
    const log = simulate('enemy_hound', V(-7, 0, -52), 4, (feet) => {
      if (dodged) return;
      dodged = true;
      feet.x += 3.5;
    });
    const first = log.charges[0];
    expect(first).toBeDefined();
    const window = first + HOUND.crouchTime + 0.8;
    expect(log.attacks.filter((t) => t < window)).toHaveLength(0);
  });
});
