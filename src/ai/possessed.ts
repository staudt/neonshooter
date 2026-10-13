import { Vector3 } from 'three';
import type { CrowdAgent } from 'recast-navigation';
import { defineTunables } from '../dev/tuning';
import { animatePossessed, buildPossessed, type PossessedModel } from './demonModels';
import { approachAngle, Enemy, yawToward, type AIContext } from './enemy';
import type { Navigation } from './navigation';

export const POSSESSED = defineTunables('enemy: possessed', {
  health: 80,
  /** Faster than walking, slower than a sprint: you can outrun them, not out-walk them. */
  speed: 6.2,
  accel: 24,
  turnRate: 9,
  /** Starts the wind-up inside this range. */
  attackRange: 2.1,
  /** The swipe lands if you're still inside this range and cone. */
  hitRange: 2.6,
  hitConeDeg: 70,
  windTime: 0.42,
  swipeTime: 0.16,
  recoverTime: 0.55,
  damage: 24,
  lungeSpeed: 7,
  knock: 3.5,
  repathTime: 0.25,
  staggerDamage: 40,
});

type Phase = 'chase' | 'wind' | 'swipe' | 'recover';

/**
 * Corrupted human melee rusher. Chases on the navmesh, winds up (arms back, shriek — the telegraph),
 * lunges and swipes. Slide or sprint out of the wind-up and the claws hit air; the shield blocks it.
 */
export class Possessed extends Enemy {
  readonly kind = 'possessed';
  private readonly model: PossessedModel;
  private agent: CrowdAgent | null = null;
  private yaw = 0;
  private phase: Phase = 'chase';
  private phaseT = 0;
  private repathT = 0;
  private gait = Math.random() * 6;
  private readonly seed = Math.random() * 100;
  private animT = 0;
  private windK = 0;
  private readonly vel = new Vector3();

  constructor(pos: Vector3, yaw: number, encounter: string, wave: number) {
    const model = buildPossessed();
    super(
      model.root,
      model.mats,
      model.hit,
      POSSESSED.health,
      encounter,
      wave,
      POSSESSED.staggerDamage,
    );
    this.model = model;
    this.root.position.copy(pos);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  attach(nav: Navigation | null) {
    if (!nav) return;
    const p = nav.closest(this.root.position) ?? this.root.position;
    this.agent = nav.addAgent(p, 0.4, POSSESSED.speed, POSSESSED.accel);
  }

  dispose(ctx: { nav: Navigation | null }) {
    if (this.agent && ctx.nav) ctx.nav.crowd.removeAgent(this.agent);
    this.agent = null;
  }

  step(dt: number, ctx: AIContext) {
    const pos = this.root.position;
    const eye = pos.clone().setY(pos.y + 1.6);
    this.tick(dt, ctx, eye);
    const toPlayer = new Vector3().subVectors(ctx.player.feet, pos);
    const dy = toPlayer.y;
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 1e-3 ? toPlayer.clone().divideScalar(dist) : new Vector3(0, 0, -1);
    if (!this.alerted && (this.canSee || dist < 7)) this.alerted = true;

    // movement: the crowd moves the agent; without a navmesh, steer straight (tests / broken nav)
    if (this.agent) {
      const p = this.agent.position();
      pos.set(p.x, p.y, p.z);
      const v = this.agent.velocity();
      this.vel.set(v.x, v.y, v.z);
    } else {
      const want =
        this.alerted && this.phase === 'chase' && dist > 1.2
          ? dir.clone().multiplyScalar(POSSESSED.speed)
          : new Vector3();
      if (this.phase === 'swipe') want.copy(dir).multiplyScalar(POSSESSED.lungeSpeed);
      this.vel.lerp(want, Math.min(1, 10 * dt));
      pos.addScaledVector(this.vel, dt);
    }

    this.phaseT -= dt;
    if (this.staggerT > 0 && (this.phase === 'wind' || this.phase === 'swipe'))
      this.enter('recover', 0.5);
    switch (this.phase) {
      case 'chase':
        if (!this.alerted || !ctx.player.alive) break;
        this.repathT -= dt;
        if (this.agent && ctx.nav && this.repathT <= 0) {
          this.repathT = POSSESSED.repathTime;
          this.agent.requestMoveTarget(ctx.nav.closest(ctx.player.feet) ?? ctx.player.feet);
        }
        if (dist < POSSESSED.attackRange && Math.abs(dy) < 1.5 && this.staggerT <= 0) {
          this.enter('wind', POSSESSED.windTime);
          this.events.charging.push(eye);
          this.agent?.requestMoveVelocity({ x: 0, y: 0, z: 0 });
        }
        break;
      case 'wind':
        if (this.phaseT <= 0) {
          this.enter('swipe', POSSESSED.swipeTime);
          this.agent?.requestMoveVelocity({
            x: dir.x * POSSESSED.lungeSpeed,
            y: 0,
            z: dir.z * POSSESSED.lungeSpeed,
          });
          // the claws land at the start of the swipe: still in range and in front?
          const facing = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          const inCone = facing.dot(dir) > Math.cos((POSSESSED.hitConeDeg * Math.PI) / 180);
          if (ctx.player.alive && dist < POSSESSED.hitRange && inCone && Math.abs(dy) < 1.6)
            this.events.attacks.push({
              from: eye.clone(),
              damage: POSSESSED.damage,
              knock: dir.clone().multiplyScalar(POSSESSED.knock),
            });
        }
        break;
      case 'swipe':
        if (this.phaseT <= 0) {
          this.enter('recover', POSSESSED.recoverTime);
          this.agent?.requestMoveVelocity({ x: 0, y: 0, z: 0 });
        }
        break;
      case 'recover':
        if (this.phaseT <= 0) {
          this.enter('chase', 0);
          this.repathT = 0;
        }
        break;
    }

    // facing: toward the player when close or attacking, else along the path
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const attacking = this.phase !== 'chase';
    const faceDir = !attacking && speed > 1 && dist > 4 ? this.vel : toPlayer;
    if (this.alerted || speed > 0.3)
      this.yaw = approachAngle(
        this.yaw,
        yawToward(faceDir),
        POSSESSED.turnRate * (this.phase === 'wind' ? 1.4 : 1) * dt,
      );
    this.root.rotation.y = this.yaw;

    // animation
    this.animT += dt;
    this.gait += speed * dt * 2.3;
    const windTarget = this.phase === 'wind' ? 1 : this.phase === 'swipe' ? 1 : 0;
    this.windK += (windTarget - this.windK) * Math.min(1, 14 * dt);
    const swipe =
      this.phase === 'swipe'
        ? 1 - Math.max(0, this.phaseT) / POSSESSED.swipeTime
        : this.phase === 'recover'
          ? 1
          : 0;
    animatePossessed(
      this.model,
      this.animT,
      this.seed,
      this.gait,
      Math.min(1, speed / POSSESSED.speed),
      this.windK,
      swipe,
    );
    this.mats.glow.emissiveIntensity = 3 * (1 + this.windK * 2);
  }

  private enter(phase: Phase, t: number) {
    this.phase = phase;
    this.phaseT = t;
  }

  protected onFlinch() {}

  protected onStagger(dir: Vector3) {
    this.agent?.requestMoveVelocity({ x: dir.x * 3, y: 0, z: dir.z * 3 });
    this.enter('recover', 0.5);
  }
}
