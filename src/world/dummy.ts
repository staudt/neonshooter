import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Ray,
  Sphere,
  SphereGeometry,
  Vector3,
} from 'three';
import type { HitPart, Hittable } from '../weapons/hitscan';

/**
 * Shooting-range target (FGD `target_dummy`): a body block with a glowing head core. Flashes when
 * hit, drops when killed, and respawns. Placeholder for the robot enemies' hit/feedback loop.
 */
export class TargetDummy implements Hittable {
  readonly root = new Group();
  health = 100;
  private readonly bodyBox: Box3;
  private readonly headSphere: Sphere;
  private readonly bodyMat = new MeshStandardMaterial({
    color: 0x9aa1ad,
    roughness: 0.6,
    metalness: 0.3,
  });
  private readonly headMat = new MeshStandardMaterial({
    color: 0x111111,
    emissive: new Color(0xff3b5c),
    emissiveIntensity: 2.5,
  });
  private flashT = 0;
  private deadT = 0;

  constructor(
    readonly position: Vector3,
    readonly maxHealth = 100,
    private respawnTime = 2.5,
  ) {
    const body = new Mesh(new BoxGeometry(0.55, 1.35, 0.3), this.bodyMat);
    body.position.y = 0.675;
    const head = new Mesh(new SphereGeometry(0.14, 16, 12), this.headMat);
    head.position.y = 1.55;
    this.root.add(body, head);
    this.root.position.copy(position);
    for (const m of [body, head]) m.castShadow = m.receiveShadow = true;
    this.bodyBox = new Box3(
      new Vector3(position.x - 0.275, position.y, position.z - 0.15),
      new Vector3(position.x + 0.275, position.y + 1.35, position.z + 0.15),
    );
    this.headSphere = new Sphere(new Vector3(position.x, position.y + 1.55, position.z), 0.14);
  }

  get alive() {
    return this.deadT <= 0;
  }

  raycast(ray: Ray, maxDist: number) {
    const p = new Vector3();
    let best: { distance: number; part: HitPart; normal: Vector3 } | null = null;
    if (ray.intersectSphere(this.headSphere, p)) {
      const d = p.distanceTo(ray.origin);
      if (d <= maxDist)
        best = {
          distance: d,
          part: 'head',
          normal: p.clone().sub(this.headSphere.center).normalize(),
        };
    }
    if (ray.intersectBox(this.bodyBox, p)) {
      const d = p.distanceTo(ray.origin);
      if (d <= maxDist && (!best || d < best.distance))
        best = { distance: d, part: 'body', normal: ray.direction.clone().negate() };
    }
    return best;
  }

  damage(amount: number) {
    if (!this.alive) return false;
    this.health -= amount;
    this.flashT = 0.08;
    if (this.health <= 0) {
      this.deadT = this.respawnTime;
      return true;
    }
    return false;
  }

  update(dt: number) {
    this.flashT = Math.max(0, this.flashT - dt);
    this.bodyMat.emissive.setRGB(
      this.flashT > 0 ? 0.6 : 0,
      this.flashT > 0 ? 0.6 : 0,
      this.flashT > 0 ? 0.6 : 0,
    );
    if (this.deadT > 0) {
      this.deadT -= dt;
      // Topple backwards while dead, pop back up on respawn.
      const t = Math.min(1, (this.respawnTime - this.deadT) / 0.25);
      this.root.rotation.x = -t * (Math.PI / 2) * 0.95;
      this.headMat.emissiveIntensity = 0.2;
      if (this.deadT <= 0) {
        this.health = this.maxHealth;
        this.root.rotation.x = 0;
        this.headMat.emissiveIntensity = 2.5;
      }
    }
  }
}
