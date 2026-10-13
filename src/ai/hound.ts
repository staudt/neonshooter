import { Vector3 } from 'three';
import type { CrowdAgent } from 'recast-navigation';
import { defineTunables } from '../dev/tuning';
import { raycast } from '../player/collision';
import { animateHound, buildHound, type HoundModel } from './demonModels';
import { approachAngle, Enemy, yawToward, type AIContext } from './enemy';
import type { Navigation } from './navigation';
import { segmentSegmentDistSq } from './projectiles';

export const HOUND = defineTunables('enemy: hound', {
  health: 55,
  /** Faster than a tac sprint: you dodge the pounce, you don't outrun it. */
  speed: 9.5,
  accel: 30,
  turnRate: 10,
  pounceMin: 3.5,
  pounceMax: 8.5,
  crouchTime: 0.38,
  pounceSpeed: 13,
  /** Extra launch height on top of the ballistic minimum (m/s). */
  pounceLift: 2.2,
  /** Fraction of the player's velocity it leads the pounce with. */
  lead: 0.45,
  pounceDamage: 22,
  pounceKnock: 6,
  /** Hit radius around the chest during the pounce. */
  pounceRadius: 0.75,
  cooldown: 1.6,
  recoverTime: 0.7,
  biteRange: 1.5,
  biteTime: 0.25,
  biteDamage: 12,
  repathTime: 0.2,
  gravity: 22,
  staggerDamage: 30,
});

type Phase = 'chase' | 'crouch' | 'pounce' | 'bite' | 'recover';

/**
 * Hell-hound. Runs you down on the navmesh, crouches (snarl — the telegraph), then pounces along a
 * ballistic arc at where you're going to be. Strafe or slide out of the line and it sails past.
 * Up close it bites. Mid-pounce it leaves the crowd and re-joins where it lands.
 */
export class Hound extends Enemy {
  readonly kind = 'hound';
  private readonly model: HoundModel;
  private agent: CrowdAgent | null = null;
  private nav: Navigation | null = null;
  private yaw = 0;
  private phase: Phase = 'chase';
  private phaseT = 0;
  private repathT = 0;
  private cooldownT = 0.2 + Math.random() * 0.3;
  /** Where the pounce goes: locked when the crouch starts, so the snarl is your cue to move. */
  private readonly pounceTarget = new Vector3();
  private gait = Math.random() * 6;
  private readonly seed = Math.random() * 100;
  private animT = 0;
  private crouchK = 0;
  private airK = 0;
  private biteK = 0;
  private struck = false;
  private readonly vel = new Vector3();

  constructor(pos: Vector3, yaw: number, encounter: string, wave: number) {
    const model = buildHound();
    super(model.root, model.mats, model.hit, HOUND.health, encounter, wave, HOUND.staggerDamage);
    this.model = model;
    this.root.position.copy(pos);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  attach(nav: Navigation | null) {
    this.nav = nav;
    if (!nav) return;
    const p = nav.closest(this.root.position) ?? this.root.position;
    this.agent = nav.addAgent(p, 0.45, HOUND.speed, HOUND.accel);
  }

  dispose(ctx: { nav: Navigation | null }) {
    if (this.agent && ctx.nav) ctx.nav.crowd.removeAgent(this.agent);
    this.agent = null;
  }

  step(dt: number, ctx: AIContext) {
    const pos = this.root.position;
    const eye = pos.clone().setY(pos.y + 0.8);
    this.tick(dt, ctx, eye);
    const toPlayer = new Vector3().subVectors(ctx.player.feet, pos);
    const dy = toPlayer.y;
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 1e-3 ? toPlayer.clone().divideScalar(dist) : new Vector3(0, 0, -1);
    if (!this.alerted && (this.canSee || dist < 8)) this.alerted = true;
    this.cooldownT -= dt;
    this.phaseT -= dt;

    if (this.phase === 'pounce') this.stepPounce(dt, ctx);
    else if (this.agent) {
      const p = this.agent.position();
      pos.set(p.x, p.y, p.z);
      const v = this.agent.velocity();
      this.vel.set(v.x, v.y, v.z);
    } else {
      const want =
        this.alerted && this.phase === 'chase' && dist > 1.2
          ? dir.clone().multiplyScalar(HOUND.speed)
          : new Vector3();
      this.vel.lerp(want, Math.min(1, 8 * dt));
      pos.addScaledVector(this.vel, dt);
    }

    if (this.staggerT > 0 && (this.phase === 'crouch' || this.phase === 'bite'))
      this.enter('recover', 0.5);
    switch (this.phase) {
      case 'chase':
        if (!this.alerted || !ctx.player.alive) break;
        this.repathT -= dt;
        if (this.agent && ctx.nav && this.repathT <= 0) {
          this.repathT = HOUND.repathTime;
          this.agent.requestMoveTarget(ctx.nav.closest(ctx.player.feet) ?? ctx.player.feet);
        }
        if (this.staggerT > 0) break;
        if (dist < HOUND.biteRange && Math.abs(dy) < 1.2) {
          this.enter('bite', HOUND.biteTime);
          this.events.charging.push(eye);
          this.halt();
        } else if (
          this.cooldownT <= 0 &&
          dist > HOUND.pounceMin &&
          dist < HOUND.pounceMax &&
          Math.abs(dy) < 2.5 &&
          this.canSee
        ) {
          this.enter('crouch', HOUND.crouchTime);
          this.events.charging.push(eye);
          this.halt();
          // commit: where the player will be, judged now (lead by their current velocity)
          const t = dist / HOUND.pounceSpeed + HOUND.crouchTime;
          this.pounceTarget.copy(ctx.player.feet).addScaledVector(ctx.player.velocity, t * HOUND.lead);
        }
        break;
      case 'crouch':
        if (this.phaseT <= 0) this.launch();
        break;
      case 'bite':
        if (this.phaseT <= 0) {
          const facing = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          if (ctx.player.alive && dist < HOUND.biteRange + 0.4 && facing.dot(dir) > 0.4)
            this.events.attacks.push({
              from: eye.clone(),
              damage: HOUND.biteDamage,
              knock: dir.clone().multiplyScalar(2),
            });
          this.enter('recover', HOUND.recoverTime * 0.6);
        }
        break;
      case 'recover':
        if (this.phaseT <= 0) {
          this.enter('chase', 0);
          this.repathT = 0;
        }
        break;
      case 'pounce':
        break;
    }

    // facing
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.phase !== 'pounce') {
      const faceDir = this.phase === 'chase' && speed > 1 && dist > 3 ? this.vel : toPlayer;
      if (this.alerted || speed > 0.3)
        this.yaw = approachAngle(this.yaw, yawToward(faceDir), HOUND.turnRate * dt);
    }
    this.root.rotation.y = this.yaw;

    // animation
    this.animT += dt;
    this.gait += speed * dt * 1.6;
    const k = Math.min(1, 14 * dt);
    this.crouchK += ((this.phase === 'crouch' ? 1 : 0) - this.crouchK) * k;
    this.airK += ((this.phase === 'pounce' ? 1 : 0) - this.airK) * k;
    this.biteK += ((this.phase === 'bite' || this.phase === 'pounce' ? 1 : 0) - this.biteK) * k;
    animateHound(
      this.model,
      this.animT,
      this.seed,
      this.gait,
      Math.min(1, speed / HOUND.speed),
      this.crouchK,
      this.airK,
      this.biteK,
    );
    this.mats.glow.emissiveIntensity = 3 * (1 + (this.crouchK + this.airK) * 1.5);
  }

  private halt() {
    this.agent?.requestMoveVelocity({ x: 0, y: 0, z: 0 });
  }

  /** Leave the ground toward the target committed at the start of the crouch. */
  private launch() {
    const pos = this.root.position;
    const target = this.pounceTarget.clone();
    const to = new Vector3(target.x - pos.x, 0, target.z - pos.z);
    const T = Math.max(0.2, to.length() / HOUND.pounceSpeed);
    this.vel.copy(to.divideScalar(T));
    // ballistic: arrive at the target height after T, plus a little lift for the arc
    this.vel.y = (target.y - pos.y) / T + 0.5 * HOUND.gravity * T + HOUND.pounceLift * 0.3;
    this.yaw = yawToward(this.vel.clone().setY(0));
    this.struck = false;
    this.enter('pounce', 2.5);
  }

  private stepPounce(dt: number, ctx: AIContext) {
    const pos = this.root.position;
    this.vel.y -= HOUND.gravity * dt;
    const step = this.vel.clone().multiplyScalar(dt);
    const len = step.length();
    // walls stop the leap
    const chest = pos.clone().setY(pos.y + 0.6);
    if (len > 1e-4) {
      const wall = raycast(ctx.colliders, chest, step.clone().divideScalar(len), len + 0.4);
      if (wall && wall.normal.y < 0.5) {
        this.vel.x = this.vel.z = 0;
        step.x = step.z = 0;
      }
    }
    pos.add(step);
    // contact with the player (once per pounce)
    if (!this.struck && ctx.player.alive) {
      const c = pos.clone().setY(pos.y + 0.6);
      const a = ctx.player.feet.clone().setY(ctx.player.feet.y + 0.4);
      const b = ctx.player.feet.clone().setY(ctx.player.feet.y + 1.4);
      if (segmentSegmentDistSq(a, b, c, c) < HOUND.pounceRadius * HOUND.pounceRadius) {
        this.struck = true;
        const knock = this.vel.clone().setY(0).normalize().multiplyScalar(HOUND.pounceKnock);
        this.events.attacks.push({ from: c, damage: HOUND.pounceDamage, knock });
        this.vel.multiplyScalar(0.25);
      }
    }
    // landing
    if (this.vel.y < 0) {
      const ground = raycast(
        ctx.colliders,
        pos.clone().setY(pos.y + 0.5),
        new Vector3(0, -1, 0),
        0.5 + Math.max(0.05, -this.vel.y * dt),
      );
      if (ground || this.phaseT <= 0) {
        if (ground) pos.y = ground.point.y;
        this.vel.set(0, 0, 0);
        const p = this.nav?.closest(pos) ?? null;
        if (p && this.agent) {
          this.agent.teleport(p);
          pos.copy(p);
        }
        this.cooldownT = HOUND.cooldown;
        this.enter('recover', HOUND.recoverTime);
      }
    }
  }

  private enter(phase: Phase, t: number) {
    this.phase = phase;
    this.phaseT = t;
  }

  protected onFlinch() {}

  protected onStagger(dir: Vector3) {
    if (this.phase === 'pounce') {
      // shot out of the air: knocked back down
      this.vel.x = dir.x * 3;
      this.vel.z = dir.z * 3;
      return;
    }
    this.agent?.requestMoveVelocity({ x: dir.x * 4, y: 0, z: dir.z * 4 });
    this.enter('recover', 0.5);
  }
}
