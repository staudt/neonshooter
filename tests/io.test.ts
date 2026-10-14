import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { kit } from '../scripts/kit.ts';
import { MapBuilder } from '../scripts/mapgen.ts';
import { EntityIO } from '../src/game/io';
import { GameWorld } from '../src/game/session';
import type { StageEvents } from '../src/game/stage';

const DT = 1 / 120;

describe('EntityIO', () => {
  it('fires every named target, now or after a delay', () => {
    const io = new EntityIO();
    const a = vi.fn();
    const b = vi.fn();
    io.on('a', a);
    io.on('b', b);
    io.fire('a, b');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    io.fire('b', '', 0.5);
    io.step(0.3);
    expect(b).toHaveBeenCalledTimes(1);
    io.step(0.3);
    expect(b).toHaveBeenCalledTimes(2);
    io.fire('a', '', 1);
    io.clearPending();
    io.step(2);
    expect(a).toHaveBeenCalledTimes(1);
  });
});

/** A 40 m corridor along -Z with wiring at fixed z; the "player" walks by setting feet. */
async function wiredWorld() {
  const m = new MapBuilder();
  const k = kit(m);
  k.bx([-4, 4], [-1, 0], [2, -42], 'concrete', 'concrete_floor');
  k.bx([-5, -4], [0, 4], [2, -42]);
  k.bx([4, 5], [0, 4], [2, -42]);
  // z -5: trigger_once → relay (delay 0.5, message) → light toggle + ambush + sound
  k.trigger('trigger_once', { target: 'relay1', message: 'entered' }, [-4, 4], [0, 3], [-4, -6]);
  m.point('trigger_relay', [0, 1, -5], {
    targetname: 'relay1',
    target: 'lamp, ambush, growl',
    delay: '0.5',
    message: 'relayed',
  });
  m.point('light_point', [0, 3, -5], { targetname: 'lamp', intensity: 10, range: 8 });
  m.point('light_point', [0, 3, -9], {
    targetname: 'lamp_off',
    intensity: 10,
    range: 8,
    start_off: '1',
  });
  m.point('enemy_possessed', [0, 0, -30], { targetname: 'ambush' });
  m.point('target_sound', [0, 1, -30], { targetname: 'growl', sound: 'demon_growl' });
  // z -12: checkpoint via trigger_once (any trigger can activate a checkpoint)
  k.trigger('trigger_once', { target: 'cp_mid' }, [-4, 4], [0, 3], [-11, -13]);
  m.point('info_checkpoint', [0, 0, -12], { targetname: 'cp_mid', angle: 90 });
  // z -20: encounter with start_target; its door (z -25) is locked until cleared
  k.trigger(
    'trigger_encounter',
    { targetname: 'enc', target: 'gate', start_target: 'lamp_off' },
    [-4, 4],
    [0, 3],
    [-19, -21],
  );
  m.point('enemy_drone', [0, 3, -23], { encounter: 'enc', wave: 0 });
  k.door('gate', [-4, 4], [0, 3], [-25, -25.5], 3);
  // a free door far away, and a toggle door used by a trigger_multiple
  k.door('free', [-4, 4], [0, 3], [-38, -38.5], 3);
  k.door('toggler', [-4, 4], [0, 3], [-33, -33.5], 3, 'rust', 'neon_red', { toggle: 1 });
  k.trigger('trigger_multiple', { target: 'toggler', wait: '0.5' }, [-4, 4], [0, 3], [-15, -16]);
  m.point('info_player_start', [0, 0, 0], { angle: 90 });
  const events: StageEvents = {
    onEncounterStart: vi.fn(),
    onWave: vi.fn(),
    onEncounterCleared: vi.fn(),
    onCheckpoint: vi.fn(),
    onStageEnd: vi.fn(),
    onMessage: vi.fn(),
    onSound: vi.fn(),
  };
  const world = await GameWorld.create(m.toString(), events);
  return { world, events };
}

function walk(world: GameWorld, z: number, seconds = 0.2) {
  const feet = new Vector3(0, 0, z);
  for (let i = 0; i < Math.round(seconds / DT); i++) world.stage.step(DT, feet);
  // GameWorld.step also runs doors + lights; drive those directly here
  world.doors.update(seconds);
}

describe('map wiring (trigger → relay → targets)', () => {
  it('trigger_once fires once; relay delays, shows messages, toggles lights, springs the ambush, plays a sound', async () => {
    const { world, events } = await wiredWorld();
    const lamp = world.level.lights.find((l) => l.name === 'lamp')!;
    expect(lamp.on).toBe(true);
    expect(world.enemies.list).toHaveLength(0);
    walk(world, -5, 0.1);
    expect(events.onMessage).toHaveBeenCalledWith('entered');
    expect(lamp.on).toBe(true); // relay has a 0.5 s delay
    walk(world, -5, 0.6);
    expect(events.onMessage).toHaveBeenCalledWith('relayed');
    expect(lamp.on).toBe(false);
    expect(world.enemies.list.map((e) => e.kind)).toEqual(['possessed']);
    expect(world.enemies.list[0].alerted).toBe(true);
    expect(events.onSound).toHaveBeenCalledWith('demon_growl', expect.any(Vector3), 1);
    walk(world, -2, 0.2);
    walk(world, -5, 1); // once: no second fire
    expect(world.stage.io.log.filter((n) => n === 'relay1')).toHaveLength(1);
    expect(world.enemies.list).toHaveLength(1);
  });

  it('a trigger_once can activate a checkpoint', async () => {
    const { world, events } = await wiredWorld();
    walk(world, -12);
    expect(events.onCheckpoint).toHaveBeenCalledWith('cp_mid');
    expect(world.stage.checkpoint.position.z).toBeCloseTo(-12);
  });

  it('encounter: start_target fires on start; targeted door stays shut until cleared, then opens', async () => {
    const { world } = await wiredWorld();
    const lampOff = world.level.lights.find((l) => l.name === 'lamp_off')!;
    expect(lampOff.on).toBe(false);
    walk(world, -20);
    expect(lampOff.on).toBe(true);
    const gate = world.doors.byName('gate')[0];
    walk(world, -24, 1); // standing at the gate: a targeted door does not open on approach
    expect(gate.target).toBe(0);
    for (const e of world.enemies.list) e.damage(999, 'body', e.position, new Vector3(0, 0, -1));
    world.enemies.step(DT, {
      colliders: world.colliders,
      player: {
        feet: new Vector3(0, 0, -24),
        eye: new Vector3(0, 1.6, -24),
        velocity: new Vector3(),
        alive: true,
      },
    });
    walk(world, -24, 0.1);
    expect(gate.target).toBe(1);
  });

  it('untargeted doors open on approach; toggle doors flip each time they are used', async () => {
    const { world } = await wiredWorld();
    walk(world, -36, 0.2);
    expect(world.doors.byName('free')[0].target).toBe(1);
    const toggler = world.doors.byName('toggler')[0];
    walk(world, -15.5, 0.1);
    expect(toggler.target).toBe(1);
    walk(world, -14, 0.6); // leave, wait re-arms
    walk(world, -15.5, 0.1);
    expect(toggler.target).toBe(0);
  });
});
