import { readFileSync } from 'node:fs';
import { Ray, Vector3 } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { rayCapsuleY } from '../src/ai/enemy';
import { Grunt } from '../src/ai/grunt';
import { buildGrunt } from '../src/ai/models';
import { GameWorld } from '../src/game/session';
import { ScriptedInput } from '../src/core/input';
import { PlayerController } from '../src/player/controller';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DT = 1 / 120;
const src = readFileSync('maps/arena_test.map', 'utf8');

describe('rayCapsuleY', () => {
  const c = V(0, 1, 0);
  it('hits the side', () => {
    const t = rayCapsuleY(new Ray(V(0, 1, -5), V(0, 0, 1)), c, 0.5, 0.4);
    expect(t).toBeCloseTo(4.6);
  });
  it('hits the top cap from above', () => {
    const t = rayCapsuleY(new Ray(V(0, 5, 0), V(0, -1, 0)), c, 0.5, 0.4);
    expect(t).toBeCloseTo(5 - 1.5 - 0.4 + 0.0, 5); // sphere top at y = 1.9
    expect(t).toBeCloseTo(3.1);
  });
  it('misses beside the capsule', () => {
    expect(rayCapsuleY(new Ray(V(1, 1, -5), V(0, 0, 1)), c, 0.5, 0.4)).toBeNull();
  });
  it('misses above the cap on a horizontal ray', () => {
    expect(rayCapsuleY(new Ray(V(0, 3, -5), V(0, 0, 1)), c, 0.5, 0.4)).toBeNull();
  });
  it('returns null for a ray pointing away', () => {
    expect(rayCapsuleY(new Ray(V(0, 1, -5), V(0, 0, -1)), c, 0.5, 0.4)).toBeNull();
  });
});

describe('Enemy hit volumes and damage', () => {
  const pos = V(3, 0, -10);
  it('body hit by a horizontal ray at pos.y + 0.9', () => {
    const g = new Grunt(pos, 0, '', 0);
    const hit = g.raycast(new Ray(V(3, 0.9, -15), V(0, 0, 1)), 100);
    expect(hit?.part).toBe('body');
    expect(hit!.distance).toBeCloseTo(5 - 0.42, 2);
  });
  it('core (head) hit by a ray aimed at the core from the front', () => {
    const g = new Grunt(pos, 0, '', 0);
    g.root.updateMatrixWorld();
    const core = g.root.localToWorld(buildGrunt().hit.core.center.clone());
    const origin = core.clone().add(V(0, 0, -4)); // front is -Z at yaw 0
    const hit = g.raycast(new Ray(origin, V(0, 0, 1)), 100);
    expect(hit?.part).toBe('head');
  });
  it('misses entirely when the ray is beside the grunt', () => {
    const g = new Grunt(pos, 0, '', 0);
    expect(g.raycast(new Ray(V(5, 0.9, -15), V(0, 0, 1)), 100)).toBeNull();
  });
  it('damage reduces health, kills once at <= 0, and alerts', () => {
    const g = new Grunt(pos, 0, '', 0);
    const max = g.maxHealth;
    expect(g.alerted).toBe(false);
    expect(g.damage(10, 'body', pos, V(0, 0, 1))).toBe(false);
    expect(g.health).toBe(max - 10);
    expect(g.alerted).toBe(true);
    expect(g.dead).toBe(false);
    expect(g.damage(max, 'head', pos, V(0, 0, 1))).toBe(true);
    expect(g.dead).toBe(true);
    expect(g.alive).toBe(false);
    expect(g.damage(50, 'body', pos, V(0, 0, 1))).toBe(false); // only once
  });
});

describe('enemy behaviour in arena_test', () => {
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

  it('entering arena A activates enc_a with 3 grunts; they fire and move', () => {
    const player = new PlayerController(world.colliders);
    player.teleport(V(0, 0, -26));
    const input = new ScriptedInput([{ t: 0 }]);
    const eye = new Vector3();
    const tick = () => {
      input.advance(DT);
      player.step(DT, input.sample(), 0);
      eye.copy(player.position).setY(player.position.y + 1.6);
      return world.step(DT, player, eye, true);
    };
    for (let i = 0; i < 12; i++) tick();
    const enc = world.stage.encounters[0];
    expect(enc.name).toBe('enc_a');
    expect(enc.state).toBe('active');
    const grunts = world.enemies.list.filter((e) => e.kind === 'grunt' && e.alive);
    expect(grunts).toHaveLength(3);
    const spawns = grunts.map((g) => g.position.clone());

    let maxBolts = 0;
    let fired = 0;
    for (let i = 0; i < 4 * 120; i++) {
      const r = tick();
      fired += r.enemies.fired.length;
      maxBolts = Math.max(maxBolts, world.enemies.projectiles.count);
    }
    expect(fired).toBeGreaterThan(0);
    expect(maxBolts).toBeGreaterThan(0);
    const moved = grunts.some((g, i) => g.position.distanceTo(spawns[i]) > 0.5);
    expect(moved).toBe(true);
  });
});
