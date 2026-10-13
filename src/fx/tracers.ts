import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { defineTunables } from '../dev/tuning';

export const TRACER = defineTunables('tracers', {
  speed: 320,
  length: 9,
  width: 0.04,
  brightness: 7,
  every: 1,
});

/** Unit tracer: two crossed quads from z=0 to z=-1 (so it reads from any angle), tapered tail. */
function tracerGeometry() {
  const g = new BufferGeometry();
  const w = 0.5;
  // prettier-ignore
  const pos = [
    -w, 0, 0,  w, 0, 0,  0, 0, -1,
    0, -w, 0,  0, w, 0,  0, 0, -1,
  ];
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

interface Tracer {
  mesh: Mesh;
  start: Vector3;
  end: Vector3;
  dir: Vector3;
  total: number;
  head: number;
}

/** Pooled bullet tracers. A bright streak travels from the muzzle to the impact. */
export class Tracers {
  readonly root = new Group();
  private pool: Tracer[] = [];
  private live: Tracer[] = [];
  private geometry = tracerGeometry();
  private shotCount = 0;

  constructor(private color = new Color(1.0, 0.82, 0.45)) {}

  spawn(start: Vector3, end: Vector3) {
    if (++this.shotCount % Math.max(1, Math.round(TRACER.every)) !== 0) return;
    let t = this.pool.pop();
    if (!t) {
      const mesh = new Mesh(
        this.geometry,
        new MeshBasicMaterial({
          color: this.color.clone().multiplyScalar(TRACER.brightness),
          blending: AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: 2,
          toneMapped: false,
        }),
      );
      mesh.frustumCulled = false;
      t = { mesh, start: new Vector3(), end: new Vector3(), dir: new Vector3(), total: 0, head: 0 };
    }
    t.start.copy(start);
    t.end.copy(end);
    t.dir.subVectors(end, start);
    t.total = t.dir.length();
    t.dir.normalize();
    t.head = Math.min(t.total, 1.5); // first frame already a bit out of the barrel
    this.root.add(t.mesh);
    this.live.push(t);
  }

  update(dt: number) {
    const tmp = new Vector3();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      // `head` keeps advancing past the impact so the tail can catch up and the tracer retires.
      t.head += TRACER.speed * dt;
      const tail = Math.max(0, t.head - TRACER.length);
      if (tail >= t.total) {
        t.mesh.removeFromParent();
        this.pool.push(t);
        this.live.splice(i, 1);
        continue;
      }
      const head = Math.min(t.total, t.head);
      // Mesh origin at the head, pointing back toward the tail (geometry extends along -Z).
      t.mesh.position.copy(t.start).addScaledVector(t.dir, head);
      t.mesh.lookAt(tmp.copy(t.mesh.position).sub(t.dir));
      t.mesh.scale.set(TRACER.width, TRACER.width, Math.max(1e-3, head - tail));
    }
  }

  get liveCount() {
    return this.live.length;
  }
}
