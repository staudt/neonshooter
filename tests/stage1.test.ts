import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Enemies } from '../src/ai/enemies';
import { initNavigation, Navigation } from '../src/ai/navigation';
import { buildLevelData, type LevelData } from '../src/world/level';

const data: LevelData = buildLevelData(readFileSync('maps/stage1.map', 'utf8'));
let nav: Navigation;
beforeAll(async () => {
  await initNavigation();
  nav = Navigation.build(data.collision);
});

const byClass = (c: string) => data.entities.filter((e) => e.classname === c);

describe('stage1 (STAGE 1 · DESCENT)', () => {
  it('loads cleanly', () => {
    expect(data.warnings).toEqual([]);
    expect(data.worldProps.backdrop).toBe('city');
  });

  it('has 4 encounters, each with waves of enemies and a door that exists', () => {
    const encounters = byClass('trigger_encounter');
    expect(encounters.map((e) => e.props.targetname)).toEqual([
      'enc_platform',
      'enc_market',
      'enc_bridge',
      'enc_plaza',
    ]);
    const doors = new Set(byClass('func_door').map((d) => d.props.targetname));
    for (const enc of encounters) {
      expect(doors.has(enc.props.target)).toBe(true);
      const enemies = data.entities.filter(
        (e) => Enemies.isEnemy(e) && e.props.encounter === enc.props.targetname,
      );
      expect(enemies.length).toBeGreaterThanOrEqual(5);
      expect(new Set(enemies.map((e) => e.props.wave)).size).toBeGreaterThanOrEqual(2);
    }
    expect(byClass('trigger_stage_end')).toHaveLength(1);
  });

  it('uses the new demons', () => {
    expect(byClass('enemy_possessed').length).toBeGreaterThanOrEqual(15);
    expect(byClass('enemy_hound').length).toBeGreaterThanOrEqual(8);
    expect(byClass('enemy_drone').length).toBeGreaterThanOrEqual(10);
  });

  it('every checkpoint (but the start) sits past an encounter door, so respawns never skip a fight', () => {
    const doorZ = byClass('func_door').map((d) => d.origin.z);
    for (const t of byClass('trigger_checkpoint')) {
      const doorsBefore = doorZ.filter((z) => z > t.origin.z).length;
      expect(doorsBefore).toBeGreaterThanOrEqual(1);
    }
    // and each checkpoint trigger lies before (outside) the next encounter trigger
    const encZ = byClass('trigger_encounter').map((e) => e.origin.z);
    for (const t of byClass('trigger_checkpoint'))
      for (const z of encZ) expect(Math.abs(t.origin.z - z)).toBeGreaterThan(1.5);
  });

  it('ground enemies spawn on the navmesh', () => {
    for (const e of data.entities.filter(
      (e) =>
        e.classname === 'enemy_possessed' ||
        e.classname === 'enemy_hound' ||
        e.classname === 'enemy_grunt',
    )) {
      const p = nav.closest(e.origin);
      expect(p, `${e.classname} at ${e.origin.toArray()}`).not.toBeNull();
      expect(p!.distanceTo(e.origin)).toBeLessThan(1.2);
    }
  });

  it('the navmesh connects the start through every area to the stage end (doors open)', () => {
    const end = byClass('trigger_stage_end')[0].origin.clone().setY(0);
    const legs: Vector3[] = [
      data.playerStart.position,
      new Vector3(-4, 0, -40), // platform
      new Vector3(0, -6, -105), // market
      new Vector3(0, 0, -165), // bridge
      new Vector3(0, 0, -222), // plaza
      end,
    ];
    for (let i = 0; i + 1 < legs.length; i++) {
      const a = nav.closest(legs[i])!;
      const b = nav.closest(legs[i + 1])!;
      expect(a, `leg ${i} start`).not.toBeNull();
      expect(b, `leg ${i} end`).not.toBeNull();
      const r = nav.query.computePath(a, b);
      expect(r.success, `leg ${i}`).toBe(true);
      const last = r.path[r.path.length - 1];
      expect(new Vector3(last.x, last.y, last.z).distanceTo(b), `leg ${i} reaches`).toBeLessThan(
        0.5,
      );
    }
  });
});
