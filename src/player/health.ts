import { Vector3 } from 'three';
import { defineTunables } from '../dev/tuning';

export const HEALTH = defineTunables('health', {
  max: 100,
  /** Seconds without damage before regen starts (MW-style). */
  regenDelay: 3.5,
  regenRate: 45,
  /** Seconds on the death cam before respawning at the checkpoint. */
  deathTime: 1.1,
  /** Brief damage immunity after respawn. */
  spawnProtection: 1.0,
});

/** Player health with delayed regeneration. Records hit directions for the HUD. */
export class PlayerHealth {
  hp = HEALTH.max;
  dead = false;
  deadT = 0;
  private sinceHit = 999;
  private protectT = 0;
  /** World-space directions *toward* the attackers of hits taken this step (HUD indicators). */
  readonly hitsThisStep: Vector3[] = [];

  get fraction() {
    return Math.max(0, this.hp / HEALTH.max);
  }

  /** `from` = world position the damage came from. Returns true if this killed the player. */
  damage(amount: number, from: Vector3, playerPos: Vector3): boolean {
    if (this.dead || this.protectT > 0) return false;
    this.hp -= amount;
    this.sinceHit = 0;
    this.hitsThisStep.push(from.clone().sub(playerPos).setY(0).normalize());
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deadT = 0;
      return true;
    }
    return false;
  }

  step(dt: number) {
    this.hitsThisStep.length = 0;
    this.protectT = Math.max(0, this.protectT - dt);
    if (this.dead) {
      this.deadT += dt;
      return;
    }
    this.sinceHit += dt;
    if (this.sinceHit > HEALTH.regenDelay)
      this.hp = Math.min(HEALTH.max, this.hp + HEALTH.regenRate * dt);
  }

  /** True once the death cam has played and it's time to respawn. */
  get respawnDue() {
    return this.dead && this.deadT >= HEALTH.deathTime;
  }

  respawn() {
    this.hp = HEALTH.max;
    this.dead = false;
    this.deadT = 0;
    this.sinceHit = 999;
    this.protectT = HEALTH.spawnProtection;
  }
}
