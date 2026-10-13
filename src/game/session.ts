import { Group, type Scene, Vector3 } from 'three';
import { Enemies } from '../ai/enemies';
import { initNavigation, Navigation } from '../ai/navigation';
import type { BoltImpact } from '../ai/projectiles';
import type { PlayerController } from '../player/controller';
import type { Hittable } from '../weapons/hitscan';
import { Doors } from '../world/doors';
import { TargetDummy } from '../world/dummy';
import { createLevel, type Level } from '../world/level';
import { Stage, type StageEvents } from './stage';

/**
 * Everything that belongs to one loaded level: geometry, doors, navigation, enemies, stage flow,
 * dummies. Rebuilt on map load / hot reload; the player, weapons and camera live outside it.
 */
export class GameWorld {
  readonly root = new Group();
  private constructor(
    readonly level: Level,
    readonly doors: Doors,
    readonly enemies: Enemies,
    readonly stage: Stage,
    readonly dummies: TargetDummy[],
  ) {
    this.root.add(level.root, enemies.root);
    for (const d of dummies) this.root.add(d.root);
  }

  static async create(src: string, events: StageEvents): Promise<GameWorld> {
    const level = createLevel(src);
    const doors = new Doors(level.data);
    let nav: Navigation | null = null;
    try {
      await initNavigation();
      nav = Navigation.build(level.data.collision);
    } catch (err) {
      console.warn('[nav] navmesh unavailable, ground enemies will hold position', err);
    }
    const enemies = new Enemies(nav);
    const stage = new Stage(level.data, doors, enemies, events);
    const dummies = level.data.entities
      .filter((e) => e.classname === 'target_dummy')
      .map((e) => new TargetDummy(e.origin, Number(e.props.health ?? 100)));
    return new GameWorld(level, doors, enemies, stage, dummies);
  }

  addTo(scene: Scene) {
    scene.add(this.root);
  }

  /** Static world + dynamic doors (array is updated in place as doors move). */
  get colliders() {
    return this.doors.colliders;
  }

  /** Everything bullets can hit besides the world. */
  targets(): Hittable[] {
    return [...this.dummies, ...this.enemies.list];
  }

  step(
    dt: number,
    player: PlayerController,
    eye: Vector3,
    alive: boolean,
  ): { impacts: BoltImpact[]; enemies: ReturnType<Enemies['step']> } {
    this.doors.update(dt);
    for (const d of this.dummies) d.update(dt);
    const enemies = this.enemies.step(dt, {
      colliders: this.colliders,
      player: { feet: player.position, eye, velocity: player.velocity, alive },
    });
    const cap = player.capsule;
    const p = player.position;
    const impacts = this.enemies.projectiles.step(
      dt,
      this.colliders,
      alive
        ? {
            a: new Vector3(p.x, p.y + cap.radius, p.z),
            b: new Vector3(p.x, p.y + cap.height - cap.radius, p.z),
            radius: cap.radius,
          }
        : null,
    );
    this.stage.step(dt, player.position);
    return { impacts, enemies };
  }

  /** Keep the player from walking through grunts (they're solid). */
  pushPlayerOut(player: PlayerController) {
    for (const e of this.enemies.list) {
      if (e.kind !== 'grunt') continue;
      const dx = player.position.x - e.position.x;
      const dz = player.position.z - e.position.z;
      const dy = player.position.y - e.position.y;
      if (dy > 1.8 || dy < -1.7) continue;
      const min = 0.42 + player.capsule.radius;
      const d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) / d;
      player.position.x += dx * push;
      player.position.z += dz * push;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.enemies.dispose();
    this.level.dispose();
  }
}
