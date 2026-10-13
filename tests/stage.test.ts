import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedInput, type ScriptStep } from '../src/core/input';
import { GameWorld } from '../src/game/session';
import { PlayerController } from '../src/player/controller';
import { raycast } from '../src/player/collision';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DT = 1 / 120;
const src = readFileSync('maps/arena_test.map', 'utf8');

const makeEvents = () => ({
  onEncounterStart: vi.fn<(name: string) => void>(),
  onWave: vi.fn<(name: string, wave: number) => void>(),
  onEncounterCleared: vi.fn<(name: string, complete: boolean) => void>(),
  onCheckpoint: vi.fn<(name: string) => void>(),
  onStageEnd: vi.fn<(seconds: number) => void>(),
});

let world: GameWorld;
let player: PlayerController;
let ev: ReturnType<typeof makeEvents>;
let input: ScriptedInput;
const eye = new Vector3();

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    input.advance(DT);
    player.step(DT, input.sample(), 0);
    eye.copy(player.position).setY(player.position.y + 1.6);
    world.step(DT, player, eye, true);
  }
}
const secs = (s: number) => tick(Math.round(s / DT));
const killAll = (enc?: string) => {
  for (const e of world.enemies.list)
    if (!enc || e.encounter === enc) e.damage(9999, 'body', e.position, V(0, 0, 1));
};
const walk = (down: ScriptStep['down']) => {
  input = new ScriptedInput([{ t: 0, down }]);
};
const stand = () => walk([]);
const enc = (name: string) => world.stage.encounters.find((e) => e.name === name)!;
const door = (name: string) => world.doors.byName(name)[0];

/** Enter an encounter's trigger and kill waves until it is cleared. */
function clear(name: string, at: [number, number, number]) {
  stand();
  player.teleport(V(...at));
  for (let i = 0; i < 20 * 120 && enc(name).state !== 'cleared'; i++) {
    killAll(name);
    tick();
  }
  expect(enc(name).state).toBe('cleared');
}
const A: [number, number, number] = [0, 0, -26];
const B: [number, number, number] = [0, 0, -82];

beforeEach(async () => {
  ev = makeEvents();
  world = await GameWorld.create(src, ev);
  player = new PlayerController(world.colliders);
  player.teleport(V(0, 0, -2));
  stand();
});

describe('encounter flow', () => {
  it('spawns wave 0, then wave 1 after the delay, then clears and opens door_a', () => {
    expect(world.colliders.length).toBe(2); // static + closed doors (a and b)
    player.teleport(V(...A));
    tick(12);
    expect(enc('enc_a').state).toBe('active');
    expect(ev.onEncounterStart).toHaveBeenCalledWith('enc_a');
    expect(world.enemies.list.filter((e) => e.kind === 'grunt')).toHaveLength(3);
    expect(world.enemies.list).toHaveLength(3);

    killAll();
    secs(0.5);
    expect(world.enemies.list).toHaveLength(0);
    expect(ev.onWave).not.toHaveBeenCalled(); // still inside WAVE_DELAY
    secs(1.2);
    expect(ev.onWave).toHaveBeenCalledWith('enc_a', 1);
    expect(world.enemies.list.filter((e) => e.kind === 'grunt')).toHaveLength(2);
    expect(world.enemies.list.filter((e) => e.kind === 'drone')).toHaveLength(3);
    expect(enc('enc_a').state).toBe('active');
    expect(door('door_a').t).toBe(0);

    killAll();
    tick(2);
    expect(enc('enc_a').state).toBe('cleared');
    expect(ev.onEncounterCleared).toHaveBeenCalledTimes(1);
    expect(ev.onEncounterCleared).toHaveBeenCalledWith('enc_a', false);
    expect(door('door_a').target).toBe(1);
    secs(2);
    expect(door('door_a').t).toBe(1);
    // door_a's geometry is gone, but door_b is still closed so a dynamic collider remains
    expect(world.colliders.length).toBe(2);
    const through = raycast(world.colliders, V(0, 1, -60), V(0, 0, -1), 10);
    expect(through).toBeNull();
  });

  it('door collider array shrinks to just the static world once every door is open', () => {
    clear('enc_a', A);
    clear('enc_b', B);
    secs(2);
    expect(door('door_a').t).toBe(1);
    expect(door('door_b').t).toBe(1);
    expect(world.colliders.length).toBe(1);
    expect(ev.onEncounterCleared).toHaveBeenLastCalledWith('enc_b', true);
  });
});

describe('door blocking', () => {
  it('closed door_a stops the player, open door_a lets them through', () => {
    player.teleport(V(0, 0, -60));
    walk(['forward']);
    secs(3);
    expect(player.position.z).toBeGreaterThan(-64.1);
    expect(player.position.z).toBeLessThan(-62);

    clear('enc_a', A);
    secs(1.5);
    expect(door('door_a').t).toBe(1);
    player.teleport(V(0, 0, -60));
    walk(['forward']);
    secs(3);
    expect(player.position.z).toBeLessThan(-66);
  });
});

describe('checkpoints', () => {
  it('trigger_checkpoint moves the checkpoint to cp_b exactly once', () => {
    const cp = world.level.data.entities.find(
      (e) => e.classname === 'info_checkpoint' && e.props.targetname === 'cp_b',
    )!;
    expect(world.stage.checkpoint.position.z).toBeCloseTo(-2);
    player.teleport(V(0, 0, -67));
    secs(0.5);
    expect(world.stage.checkpoint.position.distanceTo(cp.origin)).toBeCloseTo(0);
    expect(ev.onCheckpoint).toHaveBeenCalledTimes(1);
    expect(ev.onCheckpoint).toHaveBeenCalledWith('cp_b');
  });
});

describe('death reset', () => {
  it('despawns the active encounter, keeps cleared ones and their open doors', () => {
    clear('enc_a', A);
    secs(1.5);
    player.teleport(V(...B));
    tick(12);
    expect(enc('enc_b').state).toBe('active');
    expect(world.enemies.list.filter((e) => e.encounter === 'enc_b').length).toBeGreaterThan(0);

    world.stage.resetToCheckpoint();
    expect(world.enemies.list.filter((e) => e.encounter === 'enc_b')).toHaveLength(0);
    expect(world.enemies.projectiles.count).toBe(0);
    expect(enc('enc_b').state).toBe('idle');
    expect(enc('enc_a').state).toBe('cleared');
    expect(door('door_a').t).toBe(1);
    expect(door('door_b').t).toBe(0);
    expect(world.colliders.length).toBe(2); // door_b closed only
  });
});

describe('stage end', () => {
  it('fires once with a positive time when everything is cleared', () => {
    clear('enc_a', A);
    clear('enc_b', B);
    expect(world.stage.allCleared).toBe(true);
    player.teleport(V(0, 0, -118));
    secs(0.5);
    expect(ev.onStageEnd).toHaveBeenCalledTimes(1);
    expect(ev.onStageEnd.mock.calls[0][0]).toBeGreaterThan(0);
    expect(world.stage.ended).toBe(true);
  });

  it('does not fire while an encounter is uncleared', () => {
    clear('enc_a', A);
    player.teleport(V(0, 0, -118));
    secs(0.5);
    expect(ev.onStageEnd).not.toHaveBeenCalled();
    expect(world.stage.ended).toBe(false);
  });
});
