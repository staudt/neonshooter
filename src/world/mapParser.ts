/**
 * Quake / TrenchBroom `.map` parser (Standard and Valve 220 face formats).
 * Pure text → data; no three.js, so it runs anywhere (tests, workers).
 * Coordinates stay in Quake space (Z-up, map units); conversion happens in brushGeometry.
 */

export type Vec3Tuple = [number, number, number];

export interface MapFace {
  /** Three points on the plane, as written in the file. */
  points: [Vec3Tuple, Vec3Tuple, Vec3Tuple];
  /** Lowercased material name with any directory prefix stripped. */
  texture: string;
  /** Valve 220 texture axes (absent in Standard format). */
  uAxis?: Vec3Tuple;
  vAxis?: Vec3Tuple;
  offset: [number, number];
  rotation: number;
  scale: [number, number];
}

export interface MapBrush {
  faces: MapFace[];
  /** 1-based line where the brush starts, for error messages. */
  line: number;
}

export interface MapEntity {
  props: Record<string, string>;
  brushes: MapBrush[];
}

export class MapParseError extends Error {
  constructor(message: string, line: number) {
    super(`.map line ${line}: ${message}`);
  }
}

/** `quoted` tokens are strings, never structure (a value may legitimately be "{"). */
type Token = { text: string; line: number; quoted?: boolean };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '"') {
      const start = ++i;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') line++;
        i++;
      }
      tokens.push({ text: src.slice(start, i), line, quoted: true });
      i++;
    } else if ('{}()[]'.includes(c)) {
      tokens.push({ text: c, line });
      i++;
    } else {
      const start = i;
      while (i < n && !' \t\r\n{}()[]"'.includes(src[i])) i++;
      tokens.push({ text: src.slice(start, i), line });
    }
  }
  return tokens;
}

export function normalizeTextureName(raw: string): string {
  const base = raw.split('/').pop() ?? raw;
  return base.toLowerCase();
}

export function parseMap(src: string): MapEntity[] {
  const tokens = tokenize(src);
  let p = 0;

  const peek = () => tokens[p];
  /** True when the next token is the structural symbol `sym` (not a quoted string). */
  const at = (sym: string) =>
    tokens[p] !== undefined && !tokens[p].quoted && tokens[p].text === sym;
  const next = () => {
    const t = tokens[p++];
    if (!t) throw new MapParseError('unexpected end of file', tokens.at(-1)?.line ?? 0);
    return t;
  };
  const expect = (text: string) => {
    const t = next();
    if (t.text !== text || t.quoted)
      throw new MapParseError(`expected "${text}", got "${t.text}"`, t.line);
    return t;
  };
  const num = () => {
    const t = next();
    const v = Number(t.text);
    if (!Number.isFinite(v)) throw new MapParseError(`expected number, got "${t.text}"`, t.line);
    return v;
  };
  const vec3 = (): Vec3Tuple => {
    expect('(');
    const v: Vec3Tuple = [num(), num(), num()];
    expect(')');
    return v;
  };

  const parseFace = (): MapFace => {
    const points: MapFace['points'] = [vec3(), vec3(), vec3()];
    const texture = normalizeTextureName(next().text);
    if (at('[')) {
      // Valve 220: [ ux uy uz uoff ] [ vx vy vz voff ] rot sx sy
      expect('[');
      const uAxis: Vec3Tuple = [num(), num(), num()];
      const uOff = num();
      expect(']');
      expect('[');
      const vAxis: Vec3Tuple = [num(), num(), num()];
      const vOff = num();
      expect(']');
      const rotation = num();
      const scale: [number, number] = [num(), num()];
      skipFaceExtras();
      return { points, texture, uAxis, vAxis, offset: [uOff, vOff], rotation, scale };
    }
    // Standard: xoff yoff rot sx sy
    const offset: [number, number] = [num(), num()];
    const rotation = num();
    const scale: [number, number] = [num(), num()];
    skipFaceExtras();
    return { points, texture, offset, rotation, scale };
  };

  /** Quake 2/3 style maps append surface flags (content, flags, value) on the same face line. */
  const skipFaceExtras = () => {
    while (peek() && !at('(') && !at('}')) next();
  };

  const parseBrush = (): MapBrush | null => {
    const open = expect('{');
    // Patches / brushDef3 aren't supported: skip their block.
    if (peek()?.text === 'patchDef2' || peek()?.text === 'brushDef') {
      let depth = 1;
      while (depth > 0) {
        const t = next().text;
        if (t === '{') depth++;
        else if (t === '}') depth--;
      }
      return null;
    }
    const faces: MapFace[] = [];
    while (at('(')) faces.push(parseFace());
    expect('}');
    return { faces, line: open.line };
  };

  const entities: MapEntity[] = [];
  while (p < tokens.length) {
    expect('{');
    const ent: MapEntity = { props: {}, brushes: [] };
    while (peek() && !at('}')) {
      if (at('{')) {
        const b = parseBrush();
        if (b) ent.brushes.push(b);
      } else {
        const key = next().text;
        ent.props[key] = next().text;
      }
    }
    expect('}');
    entities.push(ent);
  }
  return entities;
}
