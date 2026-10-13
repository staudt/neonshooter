import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { corruptionMaterial } from '../fx/corruption';
import { raycast, type Colliders } from '../player/collision';
import type { LevelEntity } from '../world/level';
import { Drone } from './drone';
import type { AIContext, Enemy, EnemyKind, MeleeAttack } from './enemy';
import { Grunt } from './grunt';
import { Hound } from './hound';
import { Possessed } from './possessed';
import { buildDebris } from './models';
import { Navigation } from './navigation';
import { Projectiles } from './projectiles';

const ENEMY_CLASSES = new Set(['enemy_grunt', 'enemy_drone', 'enemy_possessed', 'enemy_hound']);

/** Death-burst size per kind (gore + gib count). */
const DEATH_SIZE: Record<EnemyKind, number> = { grunt: 1, drone: 1.5, possessed: 1.1, hound: 1 };

interface Chunk {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  floor: number;
  life: number;
  flesh: boolean;
  landed: boolean;
}

const debrisMaterial = new MeshStandardMaterial({
  color: 0xd8dce2,
  roughness: 0.5,
  metalness: 0.3,
});
/** Demon chunks: corruption skin, veins still glowing (gore pass will add blood). */
const fleshMaterial = corruptionMaterial({ color: 0x2a0d0a, veins: 1, scale: 14 });

export interface KindEvent {
  position: Vector3;
  kind: EnemyKind;
}

export interface EnemyStepResult {
  /** Positions of enemies that died this step (for FX/audio). */
  deaths: { position: Vector3; kind: EnemyKind; encounter: string; size: number }[];
  fired: KindEvent[];
  /** Attack telegraphs (charge, wind-up, crouch). */
  charging: KindEvent[];
  /** Became alerted (growl). */
  alerts: KindEvent[];
  /** Melee hits on the player. */
  attacks: MeleeAttack[];
}

/** Gore hooks for flesh debris (set by main; visual only). */
export interface DebrisFx {
  trail(pos: Vector3): void;
  land(pos: Vector3): void;
}

/** Spawns, steps and despawns enemies; owns their navigation, projectiles and death debris. */
export class Enemies {
  readonly root = new Group();
  readonly projectiles = new Projectiles();
  readonly list: Enemy[] = [];
  private chunks: Chunk[] = [];
  private time = 0;

  constructor(readonly nav: Navigation | null) {
    this.root.add(this.projectiles.root);
  }

  static isEnemy(e: LevelEntity) {
    return ENEMY_CLASSES.has(e.classname);
  }

  spawn(e: LevelEntity, alerted: boolean): Enemy {
    const encounter = e.props.encounter ?? '';
    const wave = Number(e.props.wave ?? 0);
    let enemy: Enemy;
    if (e.classname === 'enemy_drone') {
      enemy = new Drone(e.origin.clone(), e.yaw, encounter, wave);
    } else if (e.classname === 'enemy_possessed') {
      const p = new Possessed(e.origin.clone(), e.yaw, encounter, wave);
      p.attach(this.nav);
      enemy = p;
    } else if (e.classname === 'enemy_hound') {
      const h = new Hound(e.origin.clone(), e.yaw, encounter, wave);
      h.attach(this.nav);
      enemy = h;
    } else {
      const g = new Grunt(e.origin.clone(), e.yaw, encounter, wave);
      g.attach(this.nav);
      enemy = g;
    }
    enemy.alerted = alerted;
    this.list.push(enemy);
    this.root.add(enemy.root);
    return enemy;
  }

  /** Remove enemies (all, or those belonging to `encounter`). */
  despawn(filter?: (e: Enemy) => boolean) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (filter && !filter(e)) continue;
      e.dispose({ nav: this.nav });
      e.root.removeFromParent();
      this.list.splice(i, 1);
    }
  }

  /** Player gunfire is loud: wakes up enemies nearby. */
  hearGunfire(pos: Vector3, radius = 30) {
    for (const e of this.list) if (e.position.distanceTo(pos) < radius) e.alerted = true;
  }

  step(
    dt: number,
    ctx: Omit<AIContext, 'nav' | 'projectiles' | 'allies' | 'time'>,
  ): EnemyStepResult {
    this.time += dt;
    const full: AIContext = {
      ...ctx,
      time: this.time,
      nav: this.nav,
      projectiles: this.projectiles,
      allies: this.list,
    };
    this.nav?.update(dt);
    const result: EnemyStepResult = { deaths: [], fired: [], charging: [], alerts: [], attacks: [] };
    for (const e of this.list) {
      if (e.dead) continue;
      e.step(dt, full);
      for (const p of e.events.fired) result.fired.push({ position: p, kind: e.kind });
      for (const p of e.events.charging) result.charging.push({ position: p, kind: e.kind });
      if (e.events.alerted) result.alerts.push({ position: e.position.clone(), kind: e.kind });
      result.attacks.push(...e.events.attacks);
      // Getting shot alerts the squad.
      if (e.wasHit)
        for (const a of this.list)
          if (a.encounter === e.encounter && a.position.distanceTo(e.position) < 25)
            a.alerted = true;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.dead) continue;
      const lift = e.kind === 'grunt' ? 1.1 : e.kind === 'possessed' ? 1.0 : e.kind === 'hound' ? 0.6 : 0;
      const center = e.position.clone().setY(e.position.y + lift);
      const size = DEATH_SIZE[e.kind];
      result.deaths.push({ position: center, kind: e.kind, encounter: e.encounter, size });
      if (e.kind === 'grunt') this.explode(center, ctx.colliders, 14, debrisMaterial);
      else this.explode(center, ctx.colliders, Math.round(12 * size), fleshMaterial, true);
      e.dispose({ nav: this.nav });
      e.root.removeFromParent();
      this.list.splice(i, 1);
    }
    return result;
  }

  /** Death: the body bursts into chunks that tumble, bounce once, and shrink away. */
  private explode(
    center: Vector3,
    colliders: Colliders,
    count: number,
    material: MeshStandardMaterial,
    flesh = false,
  ) {
    const ground = raycast(colliders, center, new Vector3(0, -1, 0), 10);
    const floor = ground ? ground.point.y : center.y - 10;
    for (const mesh of buildDebris(count, material)) {
      mesh.position
        .copy(center)
        .add(
          new Vector3(
            (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 0.8,
            (Math.random() - 0.5) * 0.6,
          ),
        );
      const vel = new Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8 + 0.3,
        Math.random() - 0.5,
      ).multiplyScalar(7);
      const spin = new Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).multiplyScalar(20);
      this.root.add(mesh);
      this.chunks.push({ mesh, vel, spin, floor, life: 2.5 + Math.random(), flesh, landed: false });
    }
  }

  /** Visual-only debris update (per frame). Flesh chunks drip and splat through `fx`. */
  updateDebris(dt: number, fx?: DebrisFx) {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.removeFromParent();
        this.chunks.splice(i, 1);
        continue;
      }
      c.vel.y -= 20 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.flesh && !c.landed) fx?.trail(c.mesh.position);
      if (c.mesh.position.y < c.floor + 0.05) {
        if (c.flesh && !c.landed) fx?.land(c.mesh.position);
        c.landed = true;
        c.mesh.position.y = c.floor + 0.05;
        c.vel.y = Math.abs(c.vel.y) * 0.3;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.6);
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life < 0.5) c.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 6));
    }
  }

  clearAll() {
    this.despawn();
    this.projectiles.clear();
    for (const c of this.chunks) c.mesh.removeFromParent();
    this.chunks.length = 0;
  }

  dispose() {
    this.clearAll();
    this.nav?.dispose();
  }
}
