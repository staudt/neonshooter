// Reusable TrenchBroom .map generator (Valve 220). Authoring units are METERS, game space
// (Y-up, x right, z toward the viewer; forward is -Z); converted to Quake units (32/m, Z-up) on output.
// Plain TS runnable with `node` type stripping (no enums/namespaces/parameter properties).
import { writeFileSync } from 'node:fs';

export type V3 = [number, number, number];
const U = 32;
/** game (x, y, z) meters → Quake (x, -z, y) units */
const q = ([x, y, z]: V3): V3 =>
  [x * U, -z * U, y * U].map((v) => Math.round(v * 1000) / 1000) as V3;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Valve 220 texture axes for a face normal (Quake space): project on the dominant plane. */
function axes(n: V3): string {
  const [ax, ay, az] = n.map(Math.abs);
  const [u, v]: [V3, V3] =
    az >= ax && az >= ay
      ? [
          [1, 0, 0],
          [0, -1, 0],
        ]
      : ax >= ay
        ? [
            [0, 1, 0],
            [0, 0, -1],
          ]
        : [
            [1, 0, 0],
            [0, 0, -1],
          ];
  return `[ ${u.join(' ')} 0 ] [ ${v.join(' ')} 0 ] 0 1 1`;
}

type Props = Record<string, string | number>;

const kvLines = (props: Props) =>
  Object.entries(props)
    .map(([k, v]) => `"${k}" "${v}"`)
    .join('\n');

export class MapBuilder {
  worldBrushes: string[] = [];
  entities: string[] = [];
  /** where brushes currently go (swapped inside brushEntity) */
  private target: string[] = this.worldBrushes;

  /**
   * Convex brush from its vertices (meters) and faces (vertex index triples on each face, any order).
   * Winding is fixed so that (p0 - p1) × (p2 - p1) points away from the centroid, per TrenchBroom.
   */
  convex(verts: V3[], faces: [number, number, number][], tex: string | string[]) {
    const qv = verts.map(q);
    const c = qv
      .reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]] as V3, [0, 0, 0] as V3)
      .map((x) => x / qv.length) as V3;
    const lines = faces.map(([i, j, k], fi) => {
      let [p0, p1, p2] = [qv[i], qv[j], qv[k]];
      let n = cross(sub(p0, p1), sub(p2, p1));
      if (dot(n, sub(p1, c)) < 0) {
        [p0, p2] = [p2, p0];
        n = cross(sub(p0, p1), sub(p2, p1));
      }
      const t = Array.isArray(tex) ? tex[fi] : tex;
      return `( ${p0.join(' ')} ) ( ${p1.join(' ')} ) ( ${p2.join(' ')} ) ${t} ${axes(n)}`;
    });
    this.target.push(`{\n${lines.join('\n')}\n}`);
  }

  /** Axis-aligned box from min to max corner (meters). `top` overrides the +Y face texture. */
  box(min: V3, max: V3, tex = 'concrete', top?: string) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const v: V3[] = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ];
    // faces: -y, +y, -x, +x, -z, +z
    this.convex(
      v,
      [
        [0, 1, 2],
        [4, 5, 6],
        [0, 3, 7],
        [1, 2, 6],
        [0, 1, 5],
        [3, 2, 6],
      ],
      [tex, top ?? tex, tex, tex, tex, tex],
    );
  }

  /** Ramp rising along -Z from (x0..x1, y=base, z=zStart) to height `h` at z=zEnd (zEnd < zStart). */
  ramp(
    x0: number,
    x1: number,
    base: number,
    zStart: number,
    zEnd: number,
    h: number,
    tex = 'concrete_floor',
  ) {
    const v: V3[] = [
      [x0, base, zStart],
      [x1, base, zStart],
      [x0, base, zEnd],
      [x1, base, zEnd],
      [x0, base + h, zEnd],
      [x1, base + h, zEnd],
    ];
    // bottom, back (vertical at zEnd), slope, left, right
    this.convex(
      v,
      [
        [0, 1, 3],
        [2, 3, 5],
        [0, 1, 5],
        [0, 2, 4],
        [1, 3, 5],
      ],
      tex,
    );
  }

  point(classname: string, pos: V3, props: Props = {}) {
    this.entities.push(`{\n${kvLines({ classname, origin: q(pos).join(' '), ...props })}\n}`);
  }

  /** Brush entity: brushes created inside `build` belong to this entity instead of worldspawn. */
  brushEntity(classname: string, props: Props, build: (b: MapBuilder) => void) {
    const saved = this.target;
    const mine: string[] = [];
    this.target = mine;
    try {
      build(this);
    } finally {
      this.target = saved;
    }
    this.entities.push(`{\n${kvLines({ classname, ...props })}\n${mine.join('\n')}\n}`);
  }

  toString() {
    return `{
"classname" "worldspawn"
"mapversion" "220"
${this.worldBrushes.join('\n')}
}
${this.entities.join('\n')}
`;
  }

  write(path: string, headerComment: string) {
    writeFileSync(path, `// ${headerComment}\n// Game: Neon\n// Format: Valve\n${this.toString()}`);
    console.log(
      `${path}: ${this.worldBrushes.length} world brushes, ${this.entities.length} entities`,
    );
  }
}
