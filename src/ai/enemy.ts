import { Color, Group, Ray, Sphere, Vector3 } from 'three';
import { raycast, type Colliders } from '../player/collision';
import type { HitPart, Hittable } from '../weapons/hitscan';
import type { HitVolumes, RobotMaterials } from './models';
import type { Navigation } from './navigation';
import type { Projectiles } from './projectiles';

/** What every enemy can see of the world each step. */
export interface AIContext {
  time: number;
  colliders: Colliders;
  nav: Navigation | null;
  projectiles: Projectiles;
  player: {
    feet: Vector3;
    eye: Vector3;
    velocity: Vector3;
    alive: boolean;
  };
  allies: readonly Enemy[];
}

/** A melee hit on the player (claw, bite, pounce). Shield can block it like a projectile. */
export interface MeleeAttack {
  from: Vector3;
  damage: number;
  /** Shove applied to the player (m/s), optional. */
  knock?: Vector3;
}

/** Events for audio/FX, drained by the manager each step. */
export interface EnemyEvents {
  fired: Vector3[];
  charging: Vector3[];
  attacks: MeleeAttack[];
  /** Became alerted this step (growl). */
  alerted: boolean;
}

export type EnemyKind = 'grunt' | 'drone' | 'possessed' | 'hound';

/** Ray vs vertical capsule (segment center ± halfHeight on Y). Returns entry distance or null. */
export function rayCapsuleY(
  ray: Ray,
  center: Vector3,
  halfHeight: number,
  radius: number,
): number | null {
  let best: number | null = null;
  const consider = (t: number) => {
    if (t >= 0 && (best === null || t < best)) best = t;
  };
  // Infinite cylinder around the axis, clipped to the segment.
  const ox = ray.origin.x - center.x;
  const oz = ray.origin.z - center.z;
  const dx = ray.direction.x;
  const dz = ray.direction.z;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      const y = ray.origin.y + ray.direction.y * t - center.y;
      if (Math.abs(y) <= halfHeight) consider(t);
    }
  }
  // End caps.
  const p = new Vector3();
  for (const sy of [-halfHeight, halfHeight]) {
    const s = new Sphere(new Vector3(center.x, center.y + sy, center.z), radius);
    if (ray.intersectSphere(s, p)) consider(p.distanceTo(ray.origin));
  }
  return best;
}

const FLASH = new Color(1, 1, 1);

/**
 * Shared enemy behaviour: health, hit volumes (world-space from the model's local volumes),
 * hit flash, stagger, perception helpers. Subclasses implement movement and attacks.
 */
export abstract class Enemy implements Hittable {
  abstract readonly kind: EnemyKind;
  /** Demons bleed; the robot grunt sparks. */
  get bleeds() {
    return this.kind !== 'grunt';
  }
  health: number;
  dead = false;
  alerted = false;
  /** Set when shot this step (manager uses it to alert allies). */
  wasHit = false;
  readonly events: EnemyEvents = { fired: [], charging: [], attacks: [], alerted: false };
  private wasAlerted = false;
  protected flashT = 0;
  protected staggerT = 0;
  private recentDamage = 0;
  protected losT = 0;
  protected canSee = false;

  constructor(
    readonly root: Group,
    protected readonly mats: RobotMaterials,
    protected readonly hit: HitVolumes,
    readonly maxHealth: number,
    readonly encounter: string,
    readonly wave: number,
    /** Damage taken within ~0.5 s that triggers a stagger (interrupts attacks). */
    private staggerThreshold: number,
  ) {
    this.health = maxHealth;
  }

  get alive() {
    return !this.dead;
  }

  get position() {
    return this.root.position;
  }

  raycast(ray: Ray, maxDist: number) {
    this.root.updateMatrixWorld();
    const body = this.root.localToWorld(this.hit.body.center.clone());
    const core = this.root.localToWorld(this.hit.core.center.clone());
    const k = this.root.scale.x; // models may be scaled up (drones); volumes scale with them
    let best: { distance: number; part: HitPart; normal: Vector3 } | null = null;
    const p = new Vector3();
    if (ray.intersectSphere(new Sphere(core, this.hit.core.radius * k), p)) {
      const d = p.distanceTo(ray.origin);
      if (d <= maxDist)
        best = { distance: d, part: 'head', normal: p.clone().sub(core).normalize() };
    }
    let t = rayCapsuleY(ray, body, this.hit.body.halfHeight * k, this.hit.body.radius * k);
    // extra body spheres (long bodies: hounds)
    for (const e of this.hit.extra ?? []) {
      const c = this.root.localToWorld(e.center.clone());
      if (ray.intersectSphere(new Sphere(c, e.radius * k), p)) {
        const d = p.distanceTo(ray.origin);
        if (t === null || d < t) t = d;
      }
    }
    // The core sits in the body's surface: prefer it when both are hit at about the same depth.
    if (t !== null && t <= maxDist && (!best || t < best.distance - 0.08)) {
      const point = ray.at(t, new Vector3());
      best = { distance: t, part: 'body', normal: point.sub(body).setY(0).normalize() };
    }
    return best;
  }

  damage(amount: number, part: HitPart, _point: Vector3, dir: Vector3): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.flashT = part === 'head' ? 0.09 : 0.06;
    this.alerted = true;
    this.wasHit = true;
    this.recentDamage += amount;
    if (this.recentDamage >= this.staggerThreshold) {
      this.recentDamage = 0;
      this.staggerT = 0.5;
      this.onStagger(dir);
    } else this.onFlinch(dir);
    if (this.health <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  /** Small hit reaction. */
  protected abstract onFlinch(dir: Vector3): void;
  /** Big hit reaction; attacks are interrupted while `staggerT > 0`. */
  protected abstract onStagger(dir: Vector3): void;

  /** Common per-step bookkeeping; subclasses call this first. */
  protected tick(dt: number, ctx: AIContext, eye: Vector3) {
    this.events.fired.length = 0;
    this.events.charging.length = 0;
    this.events.attacks.length = 0;
    this.events.alerted = this.alerted && !this.wasAlerted;
    this.wasAlerted = this.alerted;
    this.wasHit = false;
    this.flashT = Math.max(0, this.flashT - dt);
    this.staggerT = Math.max(0, this.staggerT - dt);
    this.recentDamage = Math.max(0, this.recentDamage - 90 * dt);
    const k = this.flashT > 0 ? 0.9 : 0;
    this.mats.hull.emissive.copy(FLASH).multiplyScalar(k);
    // Line of sight is the expensive bit: refresh ~10x/s.
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1 + Math.random() * 0.03;
      this.canSee = ctx.player.alive && this.lineOfSight(ctx.colliders, eye, ctx.player.eye);
    }
  }

  protected lineOfSight(colliders: Colliders, from: Vector3, to: Vector3) {
    const d = new Vector3().subVectors(to, from);
    const dist = d.length();
    if (dist > 70) return false;
    return !raycast(colliders, from, d.divideScalar(dist), dist - 0.3);
  }

  abstract step(dt: number, ctx: AIContext): void;
  /** Free navigation agents etc. */
  dispose(_ctx: { nav: Navigation | null }) {}
}

/** Yaw that makes a -Z-facing model look along `dir`. */
export function yawToward(dir: Vector3) {
  return Math.atan2(-dir.x, -dir.z);
}

/** Move angle `a` toward `b` by at most `maxStep` (radians), shortest way round. */
export function approachAngle(a: number, b: number, maxStep: number) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}
