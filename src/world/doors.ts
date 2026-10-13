import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Collider } from '../player/collision';
import { MAP_SCALE, toWorld } from './brushGeometry';
import type { LevelData } from './level';

/**
 * `func_door` movers: slide by their `move` offset when opened. Their collision lives in one small
 * dynamic BVH, rebuilt only while something is moving (a few dozen triangles — microseconds).
 */
export class Door {
  readonly name: string;
  readonly openOffset: Vector3;
  readonly speed: number;
  /** 0 = closed, 1 = open. */
  t = 0;
  target = 0;

  constructor(readonly mover: LevelData['movers'][number]) {
    const e = mover.entity;
    this.name = e.props.targetname ?? '';
    const m = (e.props.move ?? '0 0 128').trim().split(/\s+/).map(Number) as [
      number,
      number,
      number,
    ];
    this.openOffset = toWorld(m);
    this.speed = Number(e.props.speed ?? 256) * MAP_SCALE;
  }

  get offset() {
    const k = this.t * this.t * (3 - 2 * this.t);
    return this.openOffset.clone().multiplyScalar(k);
  }

  /** Returns true if it moved. */
  update(dt: number) {
    if (this.t === this.target) return false;
    const dist = this.openOffset.length() || 1;
    const step = (this.speed / dist) * dt;
    this.t =
      this.target > this.t
        ? Math.min(this.target, this.t + step)
        : Math.max(this.target, this.t - step);
    this.mover.group?.position.copy(this.offset);
    return true;
  }
}

export class Doors {
  readonly doors: Door[];
  /** Shared array handed to the player/AI collision: [static world, dynamic movers]. Mutated in place. */
  readonly colliders: Collider[];

  constructor(data: LevelData) {
    this.doors = data.movers
      .filter((m) => m.entity.classname === 'func_door')
      .map((m) => new Door(m));
    this.colliders = [data.collision];
    this.rebuild();
  }

  byName(name: string) {
    return this.doors.filter((d) => d.name === name);
  }

  open(name: string) {
    for (const d of this.byName(name)) d.target = 1;
  }

  close(name: string) {
    for (const d of this.byName(name)) d.target = 0;
  }

  /** Open instantly (restoring cleared areas after a respawn). */
  snapOpen(name: string) {
    for (const d of this.byName(name)) {
      d.t = d.target = 1;
      d.mover.group?.position.copy(d.offset);
    }
    this.rebuild();
  }

  /** Snap all doors to closed (stage restart). */
  reset() {
    for (const d of this.doors) {
      d.t = d.target = 0;
      d.mover.group?.position.set(0, 0, 0);
    }
    this.rebuild();
  }

  update(dt: number) {
    let moved = false;
    for (const d of this.doors) moved = d.update(dt) || moved;
    if (moved) this.rebuild();
  }

  private rebuild() {
    for (const c of this.colliders.slice(1)) c.dispose();
    this.colliders.length = 1;
    const parts: number[] = [];
    for (const d of this.doors) {
      if (d.t >= 1) continue; // fully open doors are out of the way
      const o = d.offset;
      const src = d.mover.collision;
      for (let i = 0; i < src.length; i += 3)
        parts.push(src[i] + o.x, src[i + 1] + o.y, src[i + 2] + o.z);
    }
    if (!parts.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(parts, 3));
    this.colliders.push(Object.assign(g, { boundsTree: new MeshBVH(g) }));
  }
}
