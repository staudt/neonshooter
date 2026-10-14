import { Vector3 } from 'three';
import { Enemies } from '../ai/enemies';
import { brushContains, type BuiltBrush } from '../world/brushGeometry';
import type { Doors } from '../world/doors';
import type { LevelData, LevelEntity } from '../world/level';
import { EntityIO, splitTargets } from './io';

type EncounterState = 'idle' | 'active' | 'cleared';

interface Encounter {
  name: string;
  triggers: BuiltBrush[];
  /** Fired when cleared. Doors among them are also shut while it's active (lock-in). */
  target: string;
  startTarget: string;
  message: string;
  waves: LevelEntity[][];
  state: EncounterState;
  wave: number;
  nextWaveT: number;
}

/** trigger_once / trigger_multiple / trigger_checkpoint: fire `target` when the player is inside. */
interface TouchTrigger {
  brushes: BuiltBrush[];
  target: string;
  message: string;
  delay: number;
  /** Seconds before it can fire again; < 0 = once. */
  wait: number;
  cooldown: number;
  fired: boolean;
  name: string;
}

export interface StageEvents {
  onEncounterStart(name: string): void;
  onWave(name: string, wave: number): void;
  onEncounterCleared(name: string, stageComplete: boolean): void;
  onCheckpoint(name: string): void;
  onStageEnd(seconds: number): void;
  /** A trigger/relay/encounter `message` (toast). */
  onMessage?(text: string): void;
  /** target_sound used. */
  onSound?(name: string, position: Vector3, volume: number): void;
}

const WAVE_DELAY = 1.4;
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

/**
 * Stage flow from map entities, wired Quake-style through `io` (targetname / target):
 * - `trigger_encounter`: entering starts its waves (enemies with `encounter` = its targetname); its
 *   `target` doors shut while active; cleared → fires `target`. `start_target` fires on start.
 * - `trigger_once` / `trigger_multiple` (`wait`) / `trigger_relay` (point): fire `target` after
 *   `delay`; `message` shows a toast.
 * - Used: `func_door` opens (`toggle` 1 = open/close), `info_checkpoint` becomes the respawn point,
 *   `target_sound` plays, an enemy with a `targetname` (and no encounter) spawns alerted (ambush).
 *   Lights are registered by GameWorld (scene side).
 * - Doors nobody targets open on approach; `trigger_stage_end` ends the stage once all encounters
 *   are cleared. On death the in-progress encounter resets.
 */
export class Stage {
  readonly io = new EntityIO();
  readonly encounters: Encounter[] = [];
  checkpoint: { position: Vector3; yaw: number };
  elapsed = 0;
  ended = false;
  private checkpointName = '';
  private touches: TouchTrigger[] = [];
  private endTriggers: BuiltBrush[] = [];
  /** Doors nothing targets: open when the player walks up. */
  private freeDoors: string[] = [];

  constructor(
    data: LevelData,
    private doors: Doors,
    private enemies: Enemies,
    private events: StageEvents,
  ) {
    this.checkpoint = { position: data.playerStart.position.clone(), yaw: data.playerStart.yaw };
    const io = this.io;
    const byName = new Map<string, Encounter>();
    const targeted = new Set<string>();

    for (const e of data.entities) {
      const p = e.props;
      for (const t of [...splitTargets(p.target), ...splitTargets(p.start_target)]) targeted.add(t);
      switch (e.classname) {
        case 'trigger_encounter': {
          const enc: Encounter = {
            name: p.targetname ?? `enc${byName.size}`,
            triggers: e.brushes,
            target: p.target ?? '',
            startTarget: p.start_target ?? '',
            message: p.message ?? '',
            waves: [],
            state: 'idle',
            wave: 0,
            nextWaveT: 0,
          };
          byName.set(enc.name, enc);
          this.encounters.push(enc);
          break;
        }
        case 'trigger_once':
        case 'trigger_multiple':
        case 'trigger_checkpoint':
          this.touches.push({
            brushes: e.brushes,
            target: p.target ?? '',
            message: p.message ?? '',
            delay: num(p.delay, 0),
            wait: e.classname === 'trigger_multiple' ? num(p.wait, 1) : -1,
            cooldown: 0,
            fired: false,
            name: p.targetname ?? '',
          });
          break;
        case 'trigger_relay':
          io.on(p.targetname, () =>
            this.relay(p.target, p.message, num(p.delay, 0), p.targetname ?? ''),
          );
          break;
        case 'trigger_stage_end':
          this.endTriggers.push(...e.brushes);
          break;
        case 'info_checkpoint':
          io.on(p.targetname, () => this.activateCheckpoint(e));
          break;
        case 'target_sound':
          io.on(p.targetname, () =>
            events.onSound?.(p.sound ?? 'kill', e.origin, num(p.volume, 1)),
          );
          break;
      }
    }

    // a trigger_* brush with a targetname can also be fired from elsewhere (chains)
    for (const t of this.touches)
      if (t.name)
        io.on(t.name, () => this.relay(t.target, t.message, t.delay, t.name));

    for (const name of new Set(doors.doors.map((d) => d.name))) {
      const toggle = doors.byName(name).some((d) => d.mover.entity.props.toggle === '1');
      io.on(name, () => {
        if (toggle && doors.byName(name)[0]?.target === 1) doors.close(name);
        else doors.open(name);
      });
    }
    this.freeDoors = [...new Set(doors.doors.map((d) => d.name))].filter((n) => !targeted.has(n));

    for (const e of data.entities) {
      if (!Enemies.isEnemy(e)) continue;
      const enc = byName.get(e.props.encounter ?? '');
      if (enc) {
        const w = Number(e.props.wave ?? 0);
        (enc.waves[w] ??= []).push(e);
      } else if (e.props.targetname) {
        let spawned = false;
        io.on(e.props.targetname, () => {
          if (spawned) return;
          spawned = true;
          enemies.spawn(e, true); // ambush
        });
      } else enemies.spawn(e, false); // placed: waits to notice the player
    }
    for (const enc of this.encounters) enc.waves = enc.waves.filter(Boolean);
  }

  get allCleared() {
    return this.encounters.every((e) => e.state === 'cleared');
  }

  private relay(
    target: string | undefined,
    message: string | undefined,
    delay: number,
    by: string,
  ) {
    if (message) this.events.onMessage?.(message);
    this.io.fire(target, by, delay);
  }

  private activateCheckpoint(e: LevelEntity) {
    const name = e.props.targetname ?? '';
    if (name === this.checkpointName) return;
    this.checkpointName = name;
    this.checkpoint = { position: e.origin.clone(), yaw: e.yaw };
    this.events.onCheckpoint(name);
  }

  step(dt: number, playerFeet: Vector3) {
    if (this.ended) return;
    this.elapsed += dt;
    this.io.step(dt);
    const probe = playerFeet.clone().setY(playerFeet.y + 0.9);
    const inside = (brushes: BuiltBrush[]) => brushes.some((b) => brushContains(b, probe));

    for (const enc of this.encounters) {
      if (enc.state === 'idle' && inside(enc.triggers)) {
        enc.state = 'active';
        enc.wave = 0;
        for (const d of this.doorTargets(enc)) this.doors.close(d);
        this.spawnWave(enc);
        if (enc.message) this.events.onMessage?.(enc.message);
        this.io.fire(enc.startTarget, enc.name);
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
          this.io.fire(enc.target, enc.name);
          this.events.onEncounterCleared(enc.name, this.allCleared);
        }
      }
    }

    for (const t of this.touches) {
      t.cooldown = Math.max(0, t.cooldown - dt);
      if ((t.fired && t.wait < 0) || t.cooldown > 0 || !inside(t.brushes)) continue;
      t.fired = true;
      t.cooldown = t.wait;
      this.relay(t.target, t.message, t.delay, t.name);
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

  private doorTargets(enc: Encounter) {
    return splitTargets(enc.target).filter((n) => this.doors.byName(n).length);
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
    this.io.clearPending();
    for (const enc of this.encounters) if (enc.state === 'active') enc.state = 'idle';
    this.doors.reset();
    for (const enc of this.encounters)
      if (enc.state === 'cleared') for (const d of this.doorTargets(enc)) this.doors.snapOpen(d);
  }
}
