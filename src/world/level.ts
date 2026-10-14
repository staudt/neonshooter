import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  PointLight,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  angleToYaw,
  buildBrush,
  toWorld,
  type BrushPolygon,
  type BuiltBrush,
} from './brushGeometry';
import { parseMap, type MapEntity } from './mapParser';
import { getMaterial } from './materials';
import { paletteEntry } from './palette';
import { buildSigns } from './signs';

/** Brush entities whose brushes are plain static world geometry. */
const WORLD_CLASSES = new Set(['worldspawn', 'func_group', 'func_detail']);

export interface LevelEntity {
  classname: string;
  props: Record<string, string>;
  /** Point entities: world-space origin. Brush entities: center of their bounds. */
  origin: Vector3;
  /** From "angle", converted to camera yaw. 0 when absent. */
  yaw: number;
  /** Brush entities only. */
  brushes: BuiltBrush[];
}

export interface LevelData {
  /** Render geometry grouped by material name. */
  renderGeometry: Map<string, BufferGeometry>;
  /** Static collision triangles (world + clip brushes) with a BVH in `boundsTree`. */
  collision: BufferGeometry & { boundsTree: MeshBVH };
  /**
   * Surface material of a collision triangle, from a raycast hit's `face.a` (vertex index).
   * Collision geometry is non-indexed, so triangle = floor(a / 3) even after the BVH reorders its index.
   */
  surfaceAt(faceA: number): string;
  /** Every non-world entity (point and brush), in file order. */
  entities: LevelEntity[];
  /** Brush entities other than world/trigger (doors, movers): their own render geometry. */
  movers: {
    entity: LevelEntity;
    geometry: Map<string, BufferGeometry>;
    /** Non-indexed collision triangle positions at the authored (closed) position. */
    collision: Float32Array;
    /** Scene group holding the mover's meshes (set by createLevel; null for headless data). */
    group: Group | null;
  }[];
  playerStart: { position: Vector3; yaw: number };
  /** worldspawn keys (backdrop, corruption, ...). */
  worldProps: Record<string, string>;
  warnings: string[];
}

class GeometryBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  /** Material name per triangle (collision geometry uses it for impact surfaces). */
  triSurfaces: string[] = [];

  /** Fan-triangulate a convex polygon. UVs are planar world-space meters (triplanar shading ignores them). */
  addPolygon(poly: BrushPolygon, withAttributes: boolean) {
    const n = poly.normal;
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const uv = (v: Vector3): [number, number] =>
      ax >= ay && ax >= az ? [v.z, v.y] : ay >= az ? [v.x, v.z] : [v.x, v.y];
    const verts = poly.vertices;
    for (let i = 1; i < verts.length - 1; i++) {
      this.triSurfaces.push(poly.texture);
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        this.positions.push(v.x, v.y, v.z);
        if (withAttributes) {
          this.normals.push(n.x, n.y, n.z);
          this.uvs.push(...uv(v));
        }
      }
    }
  }

  build(withAttributes = true): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    if (withAttributes) {
      g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
      g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function isRendered(texture: string) {
  const e = paletteEntry(texture);
  return !e?.tool;
}

function parseOrigin(ent: MapEntity): Vector3 | null {
  const o = ent.props.origin?.trim().split(/\s+/).map(Number);
  if (!o || o.length !== 3 || o.some((v) => !Number.isFinite(v))) return null;
  return toWorld(o as [number, number, number]);
}

/** Parse + build everything that doesn't need a GPU. Safe to call in tests. */
export function buildLevelData(src: string): LevelData {
  const warnings: string[] = [];
  const unknownTextures = new Set<string>();
  const render = new Map<string, GeometryBuilder>();
  const collision = new GeometryBuilder();
  const entities: LevelEntity[] = [];
  const movers: LevelData['movers'] = [];
  let worldProps: Record<string, string> = {};

  const builderFor = (map: Map<string, GeometryBuilder>, tex: string) => {
    let b = map.get(tex);
    if (!b) map.set(tex, (b = new GeometryBuilder()));
    return b;
  };

  for (const ent of parseMap(src)) {
    const classname = ent.props.classname ?? '';
    const built: BuiltBrush[] = [];
    for (const brush of ent.brushes) {
      const b = buildBrush(brush);
      if (b) built.push(b);
      else warnings.push(`degenerate brush at line ${brush.line} (${classname})`);
    }
    for (const b of built)
      for (const poly of b.polygons)
        if (!paletteEntry(poly.texture)) unknownTextures.add(poly.texture);

    if (WORLD_CLASSES.has(classname)) {
      if (classname === 'worldspawn') worldProps = ent.props;
      for (const b of built) {
        const allTrigger = b.polygons.every((p) => paletteEntry(p.texture)?.tool === 'trigger');
        if (allTrigger) continue;
        for (const poly of b.polygons) {
          collision.addPolygon(poly, false);
          if (isRendered(poly.texture)) builderFor(render, poly.texture).addPolygon(poly, true);
        }
      }
      continue;
    }

    let origin = parseOrigin(ent);
    if (!origin && built.length) {
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const b of built) {
        min.min(b.min);
        max.max(b.max);
      }
      origin = min.add(max).multiplyScalar(0.5);
    }
    const entity: LevelEntity = {
      classname,
      props: ent.props,
      origin: origin ?? new Vector3(),
      yaw: ent.props.angle ? angleToYaw(Number(ent.props.angle)) : 0,
      brushes: built,
    };
    entities.push(entity);

    if (built.length && !classname.startsWith('trigger_')) {
      const geo = new Map<string, GeometryBuilder>();
      const col = new GeometryBuilder();
      for (const b of built)
        for (const poly of b.polygons) {
          col.addPolygon(poly, false);
          if (isRendered(poly.texture)) builderFor(geo, poly.texture).addPolygon(poly, true);
        }
      movers.push({
        entity,
        geometry: new Map([...geo].map(([k, v]) => [k, v.build()])),
        collision: new Float32Array(col.positions),
        group: null,
      });
    }
  }

  if (unknownTextures.size)
    warnings.push(`unknown textures (rendered as concrete): ${[...unknownTextures].join(', ')}`);

  const start = entities.find((e) => e.classname === 'info_player_start');
  if (!start) warnings.push('no info_player_start; spawning at origin');

  const collisionGeometry = collision.build(false);
  // Indexed copy is what MeshBVH wants; it reorders the index, not the positions.
  const boundsTree = new MeshBVH(collisionGeometry);
  const collisionWithBvh = Object.assign(collisionGeometry, { boundsTree });

  return {
    renderGeometry: new Map([...render].map(([k, v]) => [k, v.build()])),
    collision: collisionWithBvh,
    surfaceAt: (faceA: number) => collision.triSurfaces[Math.floor(faceA / 3)] ?? 'concrete',
    entities,
    movers,
    playerStart: {
      position: start?.origin.clone() ?? new Vector3(0, 2, 0),
      yaw: start?.yaw ?? 0,
    },
    worldProps,
    warnings,
  };
}

/** A map light_point: `targetname` (toggled by I/O), `style` (flicker | pulse), `start_off`. */
export interface LevelLight {
  light: PointLight;
  name: string;
  base: number;
  style: string;
  on: boolean;
  seed: number;
}

export interface Level {
  data: LevelData;
  root: Group;
  lights: LevelLight[];
  dispose(): void;
}

/** Create scene objects for a level. Add `root` to the scene. */
export function createLevel(src: string): Level {
  const data = buildLevelData(src);
  const root = new Group();
  root.name = 'level';

  const addMeshes = (parent: Group, geometry: Map<string, BufferGeometry>) => {
    for (const [tex, geo] of geometry) {
      const mesh = new Mesh(geo, getMaterial(tex));
      mesh.name = tex;
      mesh.castShadow = mesh.receiveShadow = !paletteEntry(tex)?.emissive;
      parent.add(mesh);
    }
  };
  addMeshes(root, data.renderGeometry);

  for (const mover of data.movers) {
    const g = new Group();
    g.name = `${mover.entity.classname}${mover.entity.props.targetname ? ':' + mover.entity.props.targetname : ''}`;
    addMeshes(g, mover.geometry);
    root.add(g);
    mover.group = g;
  }

  const lights: LevelLight[] = [];
  for (const e of data.entities) {
    if (e.classname !== 'light_point') continue;
    const [r, g, b] = (e.props._color ?? '1 1 1').split(/\s+/).map(Number);
    const light = new PointLight(
      0xffffff,
      Number(e.props.intensity ?? 20),
      Number(e.props.range ?? 12),
      2,
    );
    light.color.setRGB(r, g, b);
    light.position.copy(e.origin);
    root.add(light);
    const on = e.props.start_off !== '1';
    lights.push({ light, name: e.props.targetname ?? '', base: light.intensity, style: e.props.style ?? '', on, seed: lights.length * 7.31 });
    if (!on) light.intensity = 0;
  }

  root.add(buildSigns(data.entities));

  for (const w of data.warnings) console.warn(`[level] ${w}`);

  return {
    data,
    root,
    lights,
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        // per-level materials (signs); shared palette materials are cached and kept
        const mat = o.material as Material & { map?: Texture | null };
        if (o.parent?.name.startsWith('sign:')) {
          mat.map?.dispose();
          mat.dispose();
        }
      });
      data.collision.dispose();
    },
  };
}
