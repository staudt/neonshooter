import { readFileSync } from 'node:fs';
import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildLevelData } from '../src/world/level';

describe('arena_test level', () => {
  const data = buildLevelData(readFileSync('maps/arena_test.map', 'utf8'));
  const all = (cls: string) => data.entities.filter((e) => e.classname === cls);
  const castDown = (x: number, y: number, z: number) =>
    data.collision.boundsTree.raycastFirst(new Ray(new Vector3(x, y, z), new Vector3(0, -1, 0)), 2)
      ?.point.y ?? null;

  it('builds without warnings and has a player start on the floor', () => {
    expect(data.warnings).toEqual([]);
    const p = data.playerStart.position;
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-2);
    expect(castDown(p.x, 3, p.z)).toBeCloseTo(0);
  });

  it('has the expected flow entities', () => {
    expect(all('trigger_encounter')).toHaveLength(2);
    expect(all('func_door')).toHaveLength(2);
    expect(data.movers.filter((mv) => mv.entity.classname === 'func_door')).toHaveLength(2);
    expect(all('trigger_stage_end')).toHaveLength(1);
    expect(all('info_checkpoint')).toHaveLength(2);
    expect(all('trigger_checkpoint')).toHaveLength(1);
  });

  it('places enemies per encounter and wave', () => {
    const count = (cls: string, enc: string, wave: number) =>
      all(cls).filter((e) => e.props.encounter === enc && Number(e.props.wave ?? 0) === wave)
        .length;
    expect(count('enemy_grunt', 'enc_a', 0)).toBe(3);
    expect(count('enemy_drone', 'enc_a', 0)).toBe(0);
    expect(count('enemy_grunt', 'enc_a', 1)).toBe(2);
    expect(count('enemy_drone', 'enc_a', 1)).toBe(3);
    expect(count('enemy_grunt', 'enc_b', 0)).toBe(2);
    expect(count('enemy_drone', 'enc_b', 0)).toBe(2);
    expect(count('enemy_grunt', 'enc_b', 1)).toBe(3);
    expect(count('enemy_drone', 'enc_b', 1)).toBe(0);
  });

  it('every enemy names an existing encounter; encounters target existing doors', () => {
    const names = new Set(all('trigger_encounter').map((e) => e.props.targetname));
    const enemies = [...all('enemy_grunt'), ...all('enemy_drone')];
    expect(enemies).toHaveLength(15);
    for (const e of enemies) expect(names.has(e.props.encounter)).toBe(true);
    const doors = new Set(all('func_door').map((e) => e.props.targetname));
    for (const t of all('trigger_encounter')) expect(doors.has(t.props.target)).toBe(true);
  });

  it('platforms and balconies have the authored heights', () => {
    expect(castDown(17, 10, -44)).toBeCloseTo(2);
    expect(castDown(-17, 10, -44)).toBeCloseTo(2);
    expect(castDown(13.5, 10, -100)).toBeCloseTo(3.5);
    expect(castDown(0, 4, -70)).toBeCloseTo(0);
  });
});
