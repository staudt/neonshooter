import { Vector3 } from 'three';
import type { CrowdAgent } from 'recast-navigation';
import { Spring3 } from '../core/springs';
import { defineTunables } from '../dev/tuning';
import { approachAngle, Enemy, yawToward, type AIContext } from './enemy';
import { buildGrunt, type GruntModel } from './models';
import type { Navigation } from './navigation';

export const GRUNT = defineTunables('enemy: grunt', {
  health: 120,
  speed: 3.6,
  accel: 14,
  preferredRange: 13,
  minRange: 7,
  maxRange: 22,
  repositionMin: 2.5,
  repositionMax: 4.5,
  turnRate: 5,
  chargeTime: 0.5,
  burstCount: 3,
  burstInterval: 0.13,
  cooldownMin: 1.4,
  cooldownMax: 2.4,
  boltSpeed: 26,
  boltDamage: 12,
  spreadDeg: 1.4,
  /** Fraction of the player's velocity used to lead shots (1 = perfect lead). */
  lead: 0.45,
  staggerDamage: 45,
});

type Phase = 'idle' | 'cooldown' | 'charge' | 'burst';

/**
 * Hover trooper. Moves between firing positions on the navmesh (chosen for line of sight and
 * preferred range), aims its turret, and fires telegraphed bursts of slow bolts you can dodge.
 */
export class Grunt extends Enemy {
  readonly kind = 'grunt';
  private readonly model: GruntModel;
  private agent: CrowdAgent | null = null;
  private yaw = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private phase: Phase = 'cooldown';
  private phaseT = 0;
  private shotsLeft = 0;
  private repositionT = 0;
  private readonly tilt = new Spring3(3, 0.5);
  private readonly lastVel = new Vector3();
  private bobT = Math.random() * 10;

  constructor(pos: Vector3, yaw: number, encounter: string, wave: number) {
    const model = buildGrunt();
    super(model.root, model.mats, model.hit, GRUNT.health, encounter, wave, GRUNT.staggerDamage);
    this.model = model;
    this.root.position.copy(pos);
    this.yaw = this.aimYaw = yaw;
    this.root.rotation.y = yaw;
    this.phaseT = 0.6 + Math.random() * 0.8; // don't all fire on the first frame
  }

  attach(nav: Navigation | null) {
    if (!nav) return;
    const p = nav.closest(this.root.position) ?? this.root.position;
    this.agent = nav.addAgent(p, 0.45, GRUNT.speed, GRUNT.accel);
  }

  dispose(ctx: { nav: Navigation | null }) {
    if (this.agent && ctx.nav) ctx.nav.crowd.removeAgent(this.agent);
    this.agent = null;
  }

  private eye() {
    return this.root.position.clone().setY(this.root.position.y + 1.75);
  }

  step(dt: number, ctx: AIContext) {
    const eye = this.eye();
    this.tick(dt, ctx, eye);
    const glow = this.mats.glow;
    const toPlayer = new Vector3().subVectors(ctx.player.feet, this.root.position);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    if (!this.alerted && (this.canSee || dist < 6)) this.alerted = true;

    // --- movement (crowd moves the agent; we follow it)
    let vel = new Vector3();
    if (this.agent) {
      const p = this.agent.position();
      this.root.position.set(p.x, p.y, p.z);
      const v = this.agent.velocity();
      vel = new Vector3(v.x, v.y, v.z);
    }
    if (this.alerted && ctx.nav && this.agent) {
      this.repositionT -= dt;
      if (this.repositionT <= 0) {
        this.repositionT =
          GRUNT.repositionMin + Math.random() * (GRUNT.repositionMax - GRUNT.repositionMin);
        const target = this.pickPosition(ctx);
        if (target) this.agent.requestMoveTarget(target);
      }
    }

    // --- facing: body follows movement when moving fast, else the player
    const speed = Math.hypot(vel.x, vel.z);
    const faceDir =
      speed > 1.2 && this.phase !== 'charge' && this.phase !== 'burst' ? vel : toPlayer;
    if (this.alerted || speed > 0.3)
      this.yaw = approachAngle(this.yaw, yawToward(faceDir), GRUNT.turnRate * 0.6 * dt);
    this.root.rotation.y = this.yaw;

    // --- aim the turret (with lead) at the player's chest
    const target = ctx.player.eye.clone().setY(ctx.player.eye.y - 0.3);
    const lead = (target.distanceTo(eye) / GRUNT.boltSpeed) * GRUNT.lead;
    target.addScaledVector(ctx.player.velocity, lead);
    const aimDir = new Vector3().subVectors(
      target,
      this.root.position.clone().setY(this.root.position.y + 1.4),
    );
    if (this.alerted) {
      this.aimYaw = approachAngle(this.aimYaw, yawToward(aimDir), GRUNT.turnRate * dt);
      const pitch = Math.atan2(aimDir.y, Math.hypot(aimDir.x, aimDir.z));
      this.aimPitch += (pitch - this.aimPitch) * Math.min(1, 8 * dt);
    } else {
      this.aimYaw = this.yaw + Math.sin(ctx.time * 0.6 + this.bobT) * 0.6; // idle scan
    }
    this.model.turret.rotation.y = this.aimYaw - this.yaw;
    this.model.turret.rotation.x = this.aimPitch;

    // --- attack: cooldown → charge (telegraph) → burst
    let glowK = 1;
    if (!this.alerted || !ctx.player.alive) this.phase = 'cooldown';
    this.phaseT -= dt;
    const aimedWell =
      Math.abs(
        Math.atan2(
          Math.sin(this.aimYaw - yawToward(aimDir)),
          Math.cos(this.aimYaw - yawToward(aimDir)),
        ),
      ) < 0.25;
    if (this.staggerT > 0 && (this.phase === 'charge' || this.phase === 'burst')) {
      this.phase = 'cooldown';
      this.phaseT = 0.6;
    }
    switch (this.phase) {
      case 'cooldown':
        if (
          this.phaseT <= 0 &&
          this.canSee &&
          this.alerted &&
          this.staggerT <= 0 &&
          dist < GRUNT.maxRange + 15
        ) {
          this.phase = 'charge';
          this.phaseT = GRUNT.chargeTime;
          this.events.charging.push(eye);
        }
        break;
      case 'charge':
        glowK = 1 + 3 * (1 - this.phaseT / GRUNT.chargeTime);
        if (this.phaseT <= 0) {
          this.phase = 'burst';
          this.shotsLeft = GRUNT.burstCount;
          this.phaseT = 0;
        }
        break;
      case 'burst':
        glowK = 3.5;
        if (this.phaseT <= 0) {
          if (aimedWell || this.shotsLeft < GRUNT.burstCount) this.fire(ctx, target);
          this.shotsLeft--;
          this.phaseT = GRUNT.burstInterval;
          if (this.shotsLeft <= 0) {
            this.phase = 'cooldown';
            this.phaseT =
              GRUNT.cooldownMin + Math.random() * (GRUNT.cooldownMax - GRUNT.cooldownMin);
          }
        }
        break;
    }
    glow.emissiveIntensity = 3 * glowK;

    // --- body: lean into acceleration, hover bob, flinch springs
    const accel = vel.clone().sub(this.lastVel).divideScalar(Math.max(dt, 1e-4));
    this.lastVel.copy(vel);
    const local = accel.applyAxisAngle(new Vector3(0, 1, 0), -this.yaw);
    this.tilt.target.set(
      Math.max(-0.25, Math.min(0.25, local.z * -0.02)),
      0,
      Math.max(-0.25, Math.min(0.25, local.x * -0.02)),
    );
    this.tilt.step(dt);
    this.bobT += dt;
    this.model.body.position.y = Math.sin(this.bobT * 2.2) * 0.04;
    this.model.body.rotation.set(this.tilt.value.x, 0, this.tilt.value.z);
    this.model.thruster.scale.setScalar(0.9 + Math.sin(this.bobT * 30) * 0.08);
  }

  private fire(ctx: AIContext, target: Vector3) {
    this.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzle.getWorldPosition(new Vector3());
    const dir = new Vector3().subVectors(target, muzzle).normalize();
    // Random spread cone.
    const s = (GRUNT.spreadDeg * Math.PI) / 180;
    dir.x += (Math.random() - 0.5) * 2 * s;
    dir.y += (Math.random() - 0.5) * 2 * s;
    dir.z += (Math.random() - 0.5) * 2 * s;
    dir.normalize();
    ctx.projectiles.fire(muzzle, dir.multiplyScalar(GRUNT.boltSpeed), GRUNT.boltDamage);
    this.events.fired.push(muzzle);
  }

  /** Sample reachable points nearby; prefer line of sight at the preferred range, away from allies. */
  private pickPosition(ctx: AIContext): Vector3 | null {
    const nav = ctx.nav!;
    let best: Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      const p = nav.randomAround(this.root.position, 9);
      if (!p) continue;
      const d = Math.hypot(p.x - ctx.player.feet.x, p.z - ctx.player.feet.z);
      if (d < GRUNT.minRange || d > GRUNT.maxRange) continue;
      let score = -Math.abs(d - GRUNT.preferredRange) * 0.5 + Math.random();
      if (this.lineOfSight(ctx.colliders, p.clone().setY(p.y + 1.6), ctx.player.eye)) score += 5;
      for (const a of ctx.allies)
        if (a !== this && a.alive && a.position.distanceTo(p) < 3) score -= 4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  protected onFlinch(dir: Vector3) {
    const local = dir.clone().applyAxisAngle(new Vector3(0, 1, 0), -this.yaw);
    this.tilt.impulse(local.z * 1.5, 0, -local.x * 1.5);
  }

  protected onStagger(dir: Vector3) {
    const local = dir.clone().applyAxisAngle(new Vector3(0, 1, 0), -this.yaw);
    this.tilt.impulse(local.z * 4, 0, -local.x * 4);
  }
}
