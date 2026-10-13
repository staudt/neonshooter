import { Vector3 } from 'three';
import type { Enemies } from '../ai/enemies';
import { brushContains, type BuiltBrush } from '../world/brushGeometry';
import type { Doors } from '../world/doors';
import type { LevelData, LevelEntity } from '../world/level';

type EncounterState = 'idle' | 'active' | 'cleared';

interface Encounter {
  name: string;
  triggers: BuiltBrush[];
  /** Doors (targetnames) that stay shut until this encounter is cleared. */
  doors: string[];
  waves: LevelEntity[][];
  state: EncounterState;
  wave: number;
  nextWaveT: number;
}

export interface StageEvents {
  onEncounterStart(name: string): void;
  onWave(name: string, wave: number): void;
  onEncounterCleared(name: string, stageComplete: boolean): void;
  onCheckpoint(name: string): void;
  onStageEnd(seconds: number): void;
}

const WAVE_DELAY = 1.4;

/**
 * Stage flow from map entities: encounters (trigger → waves → cleared → doors open), checkpoints,
 * stage end, and resetting the in-progress encounter when the player dies.
 */
export class Stage {
  readonly encounters: Encounter[] = [];
  checkpoint: { position: Vector3; yaw: number };
  elapsed = 0;
  ended = false;
  private checkpoints: { triggers: BuiltBrush[]; target: string }[] = [];
  private checkpointName = '';
  private endTriggers: BuiltBrush[] = [];
  /** Doors not gated by an encounter: open when the player walks up. */
  private freeDoors: string[] = [];

  constructor(
    private data: LevelData,
    private doors: Doors,
    private enemies: Enemies,
    private events: StageEvents,
  ) {
    this.checkpoint = { position: data.playerStart.position.clone(), yaw: data.playerStart.yaw };
    const byName = new Map<string, Encounter>();
    for (const e of data.entities) {
      if (e.classname === 'trigger_encounter') {
        const enc: Encounter = {
          name: e.props.targetname ?? `enc${byName.size}`,
          triggers: e.brushes,
          doors: e.props.target ? [e.props.target] : [],
          waves: [],
          state: 'idle',
          wave: 0,
          nextWaveT: 0,
        };
        byName.set(enc.name, enc);
        this.encounters.push(enc);
      } else if (e.classname === 'trigger_checkpoint' && e.props.target) {
        this.checkpoints.push({ triggers: e.brushes, target: e.props.target });
      } else if (e.classname === 'trigger_stage_end') {
        this.endTriggers.push(...e.brushes);
      }
    }
    for (const e of data.entities) {
      if (!(e.classname === 'enemy_grunt' || e.classname === 'enemy_drone')) continue;
      const enc = byName.get(e.props.encounter ?? '');
      if (!enc) continue;
      const w = Number(e.props.wave ?? 0);
      (enc.waves[w] ??= []).push(e);
    }
    for (const enc of this.encounters) enc.waves = enc.waves.filter(Boolean);
    const gated = new Set(this.encounters.flatMap((e) => e.doors));
    this.freeDoors = [...new Set(doors.doors.map((d) => d.name))].filter((n) => !gated.has(n));
    this.spawnFreeEnemies();
  }

  /** Enemies without an encounter are placed at load and wait to notice the player. */
  private spawnFreeEnemies() {
    const names = new Set(this.encounters.map((e) => e.name));
    for (const e of this.data.entities)
      if (
        (e.classname === 'enemy_grunt' || e.classname === 'enemy_drone') &&
        !names.has(e.props.encounter ?? '')
      )
        this.enemies.spawn(e, false);
  }

  get allCleared() {
    return this.encounters.every((e) => e.state === 'cleared');
  }

  step(dt: number, playerFeet: Vector3) {
    if (this.ended) return;
    this.elapsed += dt;
    const probe = playerFeet.clone().setY(playerFeet.y + 0.9);
    const inside = (brushes: BuiltBrush[]) => brushes.some((b) => brushContains(b, probe));

    for (const enc of this.encounters) {
      if (enc.state === 'idle' && inside(enc.triggers)) {
        enc.state = 'active';
        enc.wave = 0;
        for (const d of enc.doors) this.doors.close(d);
        this.spawnWave(enc);
        this.events.onEncounterStart(enc.name);
      } else if (enc.state === 'active') {
        const alive = this.enemies.list.some((e) => e.encounter === enc.name && e.alive);
        if (alive) continue;
        if (enc.wave + 1 < enc.waves.length) {
          enc.nextWaveT -= dt;
          if (enc.nextWaveT <= 0) {
            enc.wave++;
            this.spawnWave(enc);
            this.events.onWave(enc.name, enc.wave);
          }
        } else {
          enc.state = 'cleared';
          for (const d of enc.doors) this.doors.open(d);
          this.events.onEncounterCleared(enc.name, this.allCleared);
        }
      }
    }

    for (const cp of this.checkpoints) {
      if (cp.target === this.checkpointName || !inside(cp.triggers)) continue;
      const target = this.data.entities.find(
        (e) => e.classname === 'info_checkpoint' && e.props.targetname === cp.target,
      );
      if (!target) continue;
      this.checkpointName = cp.target;
      this.checkpoint = { position: target.origin.clone(), yaw: target.yaw };
      this.events.onCheckpoint(cp.target);
    }

    for (const name of this.freeDoors) {
      const door = this.doors.byName(name)[0];
      if (!door || door.target === 1) continue;
      const c = door.mover.entity.origin;
      if (Math.hypot(c.x - playerFeet.x, c.z - playerFeet.z) < 4) this.doors.open(name);
    }

    if (this.allCleared && inside(this.endTriggers)) {
      this.ended = true;
      this.events.onStageEnd(this.elapsed);
    }
  }

  private spawnWave(enc: Encounter) {
    for (const e of enc.waves[enc.wave] ?? []) this.enemies.spawn(e, true);
    enc.nextWaveT = WAVE_DELAY;
  }

  /** After death: reset in-progress encounters; cleared ones (and their open doors) stay. */
  resetToCheckpoint() {
    const active = new Set(this.encounters.filter((e) => e.state === 'active').map((e) => e.name));
    this.enemies.despawn((e) => active.has(e.encounter));
    this.enemies.projectiles.clear();
    for (const enc of this.encounters) if (enc.state === 'active') enc.state = 'idle';
    this.doors.reset();
    for (const enc of this.encounters)
      if (enc.state === 'cleared') for (const d of enc.doors) this.doors.snapOpen(d);
  }
}
