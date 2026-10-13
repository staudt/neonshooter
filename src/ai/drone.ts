import { Vector3 } from 'three';
import { defineTunables } from '../dev/tuning';
import { depenetrate, raycast } from '../player/collision';
import { approachAngle, Enemy, yawToward, type AIContext } from './enemy';
import { animateFlyer, buildDrone, type DroneModel } from './models';

export const DRONE = defineTunables('enemy: drone', {
  /** Model + hit volume scale (bigger = easier to hit). 2.4 keeps the old drone's hit radius. */
  scale: 2.4,
  health: 45,
  speed: 7,
  accel: 4,
  orbitRadiusMin: 8,
  orbitRadiusMax: 13,
  orbitSpeed: 0.35,
  heightMin: 2.5,
  heightMax: 5,
  chargeTime: 0.35,
  cooldownMin: 1.3,
  cooldownMax: 2.1,
  boltSpeed: 18,
  boltDamage: 8,
  spreadDeg: 1.8,
  lead: 0.6,
  staggerDamage: 30,
});

/**
 * Flying flanker (the "Maw" flying demon). Orbits the player at range and height, steering around
 * walls with a few raycasts, and spits single fireballs after a telegraph: eye + mouth flare while
 * the jaw opens.
 */
export class Drone extends Enemy {
  readonly kind = 'drone';
  private readonly model: DroneModel;
  private readonly vel = new Vector3();
  private orbitAngle = Math.random() * Math.PI * 2;
  private orbitDir = Math.random() < 0.5 ? -1 : 1;
  private radius =
    DRONE.orbitRadiusMin + Math.random() * (DRONE.orbitRadiusMax - DRONE.orbitRadiusMin);
  private height = DRONE.heightMin + Math.random() * (DRONE.heightMax - DRONE.heightMin);
  private yaw = 0;
  private cooldown = 1 + Math.random();
  private charge = -1;
  private animT = Math.random() * 10;
  private readonly animPhase = Math.random() * 6.28;
  private retargetT = 0;

  constructor(pos: Vector3, yaw: number, encounter: string, wave: number) {
    const model = buildDrone();
    super(model.root, model.mats, model.hit, DRONE.health, encounter, wave, DRONE.staggerDamage);
    this.model = model;
    this.root.position.copy(pos);
    this.root.scale.setScalar(DRONE.scale);
    this.yaw = yaw;
  }

  step(dt: number, ctx: AIContext) {
    const pos = this.root.position;
    this.tick(dt, ctx, pos);
    const toPlayer = new Vector3().subVectors(ctx.player.eye, pos);
    if (!this.alerted && (this.canSee || toPlayer.length() < 8)) this.alerted = true;

    // --- steering
    const desired = new Vector3();
    if (this.alerted) {
      this.orbitAngle += this.orbitDir * DRONE.orbitSpeed * dt;
      this.retargetT -= dt;
      if (this.retargetT <= 0) {
        // Occasionally change orbit lane / direction so drones don't look like satellites.
        this.retargetT = 3 + Math.random() * 3;
        if (Math.random() < 0.35) this.orbitDir *= -1;
        this.radius =
          DRONE.orbitRadiusMin + Math.random() * (DRONE.orbitRadiusMax - DRONE.orbitRadiusMin);
        this.height = DRONE.heightMin + Math.random() * (DRONE.heightMax - DRONE.heightMin);
      }
      const goal = ctx.player.feet
        .clone()
        .add(
          new Vector3(
            Math.cos(this.orbitAngle) * this.radius,
            this.height,
            Math.sin(this.orbitAngle) * this.radius,
          ),
        );
      desired.subVectors(goal, pos);
      const d = desired.length();
      desired.multiplyScalar(d > 0.01 ? ((Math.min(d, 4) / 4) * DRONE.speed) / d : 0);
    }
    // Wall avoidance: probe ahead and push away from what's there.
    const speed = this.vel.length();
    if (speed > 0.2) {
      const ahead = raycast(ctx.colliders, pos, this.vel.clone().divideScalar(speed), 2.5);
      if (ahead) desired.addScaledVector(ahead.normal, (2.5 - ahead.distance) * 4);
    }
    const clearance = 1.2 + 0.35 * DRONE.scale;
    const below = raycast(ctx.colliders, pos, new Vector3(0, -1, 0), clearance);
    if (below) desired.y += (clearance - below.distance) * 4;
    for (const a of ctx.allies) {
      if (a === this || !a.alive || a.kind !== 'drone') continue;
      const off = new Vector3().subVectors(pos, a.position);
      const l = off.length();
      const sep = 1.5 + DRONE.scale;
      if (l < sep && l > 1e-3) desired.addScaledVector(off, ((sep - l) / l) * 3);
    }
    this.vel.lerp(desired, Math.min(1, DRONE.accel * dt));
    pos.addScaledVector(this.vel, dt);
    // Keep out of walls (sphere-ish capsule around the body).
    const r = 0.35 * DRONE.scale;
    const feet = pos.clone().setY(pos.y - r);
    depenetrate(ctx.colliders, feet, { radius: r, height: 2 * r });
    pos.set(feet.x, feet.y + r, feet.z);

    // --- facing + banking
    if (this.alerted) this.yaw = approachAngle(this.yaw, yawToward(toPlayer), 6 * dt);
    this.root.rotation.y = this.yaw;
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.model.body.rotation.z = -this.vel.dot(right) * 0.06;
    this.model.body.rotation.x = -this.vel.dot(fwd) * 0.05;

    // --- attack
    let glowK = 1;
    if (this.alerted && ctx.player.alive) {
      if (this.staggerT > 0) this.charge = -1;
      if (this.charge >= 0) {
        this.charge -= dt;
        glowK = 1 + 4 * (1 - Math.max(0, this.charge) / DRONE.chargeTime);
        if (this.charge < 0) {
          this.fire(ctx);
          this.cooldown =
            DRONE.cooldownMin + Math.random() * (DRONE.cooldownMax - DRONE.cooldownMin);
        }
      } else {
        this.cooldown -= dt;
        if (this.cooldown <= 0 && this.canSee && this.staggerT <= 0) {
          this.charge = DRONE.chargeTime;
          this.events.charging.push(pos.clone());
        }
      }
    }
    this.mats.glow.emissiveIntensity = 3 * glowK;
    // tentacles trail with forward speed; jaw gapes during the charge; slow hover bob
    this.animT += dt;
    const open = this.charge >= 0 ? 1 - Math.max(0, this.charge) / DRONE.chargeTime : 0;
    animateFlyer(this.model, this.animT, this.animPhase, Math.min(1, Math.max(0, this.vel.dot(fwd) / DRONE.speed)), open);
    this.model.body.position.y = Math.sin(this.animT * 1.8 + this.animPhase) * 0.04;
  }

  private fire(ctx: AIContext) {
    this.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzle.getWorldPosition(new Vector3());
    const target = ctx.player.eye.clone().setY(ctx.player.eye.y - 0.3);
    const lead = (target.distanceTo(muzzle) / DRONE.boltSpeed) * DRONE.lead;
    target.addScaledVector(ctx.player.velocity, lead);
    const dir = new Vector3().subVectors(target, muzzle).normalize();
    const s = (DRONE.spreadDeg * Math.PI) / 180;
    dir.x += (Math.random() - 0.5) * 2 * s;
    dir.y += (Math.random() - 0.5) * 2 * s;
    dir.z += (Math.random() - 0.5) * 2 * s;
    ctx.projectiles.fire(
      muzzle,
      dir.normalize().multiplyScalar(DRONE.boltSpeed),
      DRONE.boltDamage,
      0.1,
    );
    this.events.fired.push(muzzle);
  }

  protected onFlinch(dir: Vector3) {
    this.vel.addScaledVector(dir, 2);
  }

  protected onStagger(dir: Vector3) {
    this.vel.addScaledVector(dir, 6);
    this.vel.y += 2;
  }
}
