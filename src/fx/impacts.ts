import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';

const MAX_PARTICLES = 256;
const MAX_DECALS = 256;
const EMBER_LIFE = 1.4;
const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _o = new Object3D();
const Z = new Vector3(0, 0, 1);

interface Particle {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  gravity: number;
}

/** One instanced particle layer (sparks or dust): fixed GPU cost, ring-buffer allocation. */
class ParticleLayer {
  readonly mesh: InstancedMesh;
  private parts: Particle[] = [];
  private next = 0;

  constructor(
    color: Color,
    additive: boolean,
    private stretch: number,
  ) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({
        color,
        blending: additive ? AdditiveBlending : 1,
        transparent: true,
        opacity: additive ? 1 : 0.55,
        depthWrite: false,
        toneMapped: !additive,
      }),
      MAX_PARTICLES,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.parts.push({
        pos: new Vector3(),
        vel: new Vector3(),
        life: 0,
        maxLife: 1,
        size: 0,
        drag: 0,
        gravity: 0,
      });
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
  }

  emit(pos: Vector3, vel: Vector3, life: number, size: number, drag: number, gravity: number) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % MAX_PARTICLES;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = p.maxLife = life;
    p.size = size;
    p.drag = drag;
    p.gravity = gravity;
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      const speed = p.vel.length();
      _q.setFromUnitVectors(Z, speed > 1e-4 ? _v.copy(p.vel).divideScalar(speed) : Z);
      const len = p.size * (1 + speed * this.stretch);
      _s.set(p.size * k, p.size * k, len * k);
      this.mesh.setMatrixAt(i, _m.compose(p.pos, _q, _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function bulletHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.28, 'rgba(8,8,10,0.95)');
  grad.addColorStop(0.55, 'rgba(30,30,35,0.55)');
  grad.addColorStop(1, 'rgba(60,60,65,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

function emberTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,200,120,1)');
  grad.addColorStop(0.35, 'rgba(255,110,30,0.6)');
  grad.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** Decals: bullet holes that persist (ring buffer) + a hot ember on each that cools over EMBER_LIFE. */
class DecalLayer {
  readonly holes: InstancedMesh;
  readonly embers: InstancedMesh;
  private emberLife = new Float32Array(MAX_DECALS);
  private emberMatrices: Matrix4[] = [];
  private next = 0;

  constructor() {
    const geo = new PlaneGeometry(1, 1);
    this.holes = new InstancedMesh(
      geo,
      new MeshBasicMaterial({
        map: bulletHoleTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
      MAX_DECALS,
    );
    this.embers = new InstancedMesh(
      geo,
      new MeshBasicMaterial({
        map: emberTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        toneMapped: false,
      }),
      MAX_DECALS,
    );
    for (const m of [this.holes, this.embers]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      for (let i = 0; i < MAX_DECALS; i++) m.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    for (let i = 0; i < MAX_DECALS; i++) this.emberMatrices.push(new Matrix4());
  }

  add(point: Vector3, normal: Vector3) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_DECALS;
    _o.position.copy(point).addScaledVector(normal, 0.003);
    _o.quaternion.setFromUnitVectors(Z, normal);
    _o.rotateZ(Math.random() * Math.PI * 2);
    const size = 0.1 + Math.random() * 0.04;
    _o.scale.set(size, size, 1);
    _o.updateMatrix();
    this.holes.setMatrixAt(i, _o.matrix);
    this.holes.instanceMatrix.needsUpdate = true;
    this.emberMatrices[i].copy(_o.matrix);
    this.emberLife[i] = EMBER_LIFE;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < MAX_DECALS; i++) {
      if (this.emberLife[i] <= 0) continue;
      this.emberLife[i] -= dt;
      const k = Math.max(0, this.emberLife[i] / EMBER_LIFE);
      const sk = 1.2 * Math.sqrt(k); // stays big, then cools quickly at the end
      _m.copy(this.emberMatrices[i]).multiply(new Matrix4().makeScale(sk, sk, 1));
      this.embers.setMatrixAt(i, k > 0 ? _m : _m.makeScale(0, 0, 0));
      any = true;
    }
    if (any) this.embers.instanceMatrix.needsUpdate = true;
  }
}

export type ImpactKind = 'concrete' | 'metal' | 'target';

/** Bullet impact effects: sparks, dust, decals. Fixed budget, no allocations per shot. */
export class Impacts {
  readonly root = new Group();
  private sparks = new ParticleLayer(new Color(1, 0.6, 0.25).multiplyScalar(5), true, 0.04);
  private hotSparks = new ParticleLayer(new Color(1, 0.25, 0.35).multiplyScalar(5), true, 0.03);
  private dust = new ParticleLayer(new Color(0.55, 0.56, 0.6), false, 0);
  private decals = new DecalLayer();

  constructor() {
    this.root.add(
      this.sparks.mesh,
      this.hotSparks.mesh,
      this.dust.mesh,
      this.decals.holes,
      this.decals.embers,
    );
  }

  spawn(point: Vector3, normal: Vector3, kind: ImpactKind, incoming: Vector3) {
    // Reflect the incoming direction off the surface, then scatter.
    const refl = incoming.clone().reflect(normal);
    const sparkCount = kind === 'metal' ? 12 : kind === 'target' ? 10 : 5;
    const layer = kind === 'target' ? this.hotSparks : this.sparks;
    for (let i = 0; i < sparkCount; i++) {
      const v = refl
        .clone()
        .multiplyScalar(0.6)
        .add(normal.clone().multiplyScalar(0.5))
        .add(
          new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(
            1.2,
          ),
        )
        .normalize()
        .multiplyScalar(4 + Math.random() * 8);
      layer.emit(point, v, 0.15 + Math.random() * 0.25, 0.012, 2, 12);
    }
    if (kind === 'concrete') {
      for (let i = 0; i < 6; i++) {
        const v = normal
          .clone()
          .add(
            new Vector3(
              Math.random() - 0.5,
              Math.random() - 0.5,
              Math.random() - 0.5,
            ).multiplyScalar(0.9),
          )
          .multiplyScalar(0.8 + Math.random() * 1.5);
        this.dust.emit(point, v, 0.5 + Math.random() * 0.5, 0.05 + Math.random() * 0.05, 4, -0.3);
      }
    }
    if (kind !== 'target') this.decals.add(point, normal);
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.hotSparks.update(dt);
    this.dust.update(dt);
    this.decals.update(dt);
  }
}
