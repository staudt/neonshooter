import { Crowd, init, NavMesh, NavMeshQuery, type CrowdAgent } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { Vector3, type BufferGeometry } from 'three';

let ready: Promise<void> | null = null;
/** Load the Recast WASM once. Await before building a navmesh. */
export function initNavigation() {
  return (ready ??= init());
}

/** Agent dimensions the navmesh is baked for (grunts). Recast works in voxel cells. */
const CELL = 0.2;
const CELL_H = 0.1;
const AGENT_RADIUS = 0.45;
const AGENT_HEIGHT = 1.9;
/** 0.6 m: stairs bake (a 0.2 m cell can straddle two 0.25 m steps); real cover is all taller. */
const AGENT_CLIMB = 0.6;
const AGENT_SLOPE = 40;

/**
 * Navigation for ground enemies: navmesh baked from the level's collision triangles at load time,
 * a crowd for path following + local avoidance, and point queries for AI position picking.
 */
export class Navigation {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  readonly crowd: Crowd;

  private constructor(navMesh: NavMesh) {
    this.navMesh = navMesh;
    this.query = new NavMeshQuery(navMesh);
    this.crowd = new Crowd(navMesh, { maxAgents: 48, maxAgentRadius: 0.8 });
  }

  /** Bake from a non-indexed collision geometry (positions only). Requires `initNavigation()` first. */
  static build(collision: BufferGeometry): Navigation {
    const pos = collision.getAttribute('position').array as ArrayLike<number>;
    const indices = new Uint32Array(pos.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    const { success, navMesh } = generateSoloNavMesh(pos, indices, {
      cs: CELL,
      ch: CELL_H,
      walkableRadius: Math.ceil(AGENT_RADIUS / CELL),
      walkableHeight: Math.ceil(AGENT_HEIGHT / CELL_H),
      walkableClimb: Math.floor(AGENT_CLIMB / CELL_H),
      walkableSlopeAngle: AGENT_SLOPE,
      maxEdgeLen: 12,
      maxSimplificationError: 1.3,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!success || !navMesh) throw new Error('navmesh generation failed');
    return new Navigation(navMesh);
  }

  /** Nearest navmesh point (within a few meters), or null. */
  closest(p: Vector3): Vector3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: { x: 2, y: 4, z: 2 } });
    return r.success ? new Vector3(r.point.x, r.point.y, r.point.z) : null;
  }

  /** Random reachable point within `radius` of `p`, or null. */
  randomAround(p: Vector3, radius: number): Vector3 | null {
    const r = this.query.findRandomPointAroundCircle(p, radius, {
      halfExtents: { x: 2, y: 4, z: 2 },
    });
    return r.success ? new Vector3(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z) : null;
  }

  addAgent(p: Vector3, radius: number, maxSpeed: number, maxAcceleration: number): CrowdAgent {
    return this.crowd.addAgent(p, {
      radius,
      height: AGENT_HEIGHT,
      maxSpeed,
      maxAcceleration,
      collisionQueryRange: radius * 8,
      pathOptimizationRange: 20,
      separationWeight: 2,
    });
  }

  update(dt: number) {
    this.crowd.update(dt);
  }

  dispose() {
    this.crowd.destroy();
    this.query.destroy();
    this.navMesh.destroy();
  }
}
