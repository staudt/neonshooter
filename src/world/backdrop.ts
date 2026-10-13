import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type Texture,
} from 'three';
import { defineTunables } from '../dev/tuning';
import { NOISE_GLSL } from './materials';
import { adTexture } from './signs';

/**
 * Non-colliding depth layer behind the playable space: hell sky with a burning ring, a procedural
 * megacity (instanced towers with window-grid shader, elevated rails, billboards, traffic, aviation
 * lights), the hell-spire, and the glowing lower city in the void below. Rendered in its own pass
 * with its own camera (near 5 m, far 9 km) so the level keeps tight depth precision.
 *
 * Enabled per map by worldspawn keys: `backdrop` "city" | "none", `corruption` 0..1 (redness),
 * `spire_angle` (degrees, 0 = +X; where the spire stands).
 */

export const BACKDROP = defineTunables(
  'look: backdrop',
  { haze: 1, windows: 0.16, skyGlow: 1, ringGlow: 1, traffic: 1 },
  {
    haze: [0, 3, 0.01],
    windows: [0, 1, 0.01],
    skyGlow: [0, 3, 0.01],
    ringGlow: [0, 3, 0.01],
    traffic: [0, 3, 0.01],
  },
);

export interface BackdropOptions {
  mode: 'city' | 'none';
  /** Center + radius of the playable area (towers stay outside it). */
  center: Vector3;
  radius: number;
  corruption: number;
  spireDir: Vector3;
  /** Background color when mode = none. */
  fallback: number;
}

const GROUND_Y = -230;

/** Deterministic PRNG so the skyline is the same every load. */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shared by every backdrop shader: sky color per direction (also the haze color) + haze.
const SKY_GLSL = /* glsl */ `
uniform float uTime, uCorr, uHaze, uSkyGlow, uRingGlow, uWindows;
uniform vec3 uSpireDir;
${NOISE_GLSL}
vec3 horizonColor(vec3 d) {
  vec2 sd = normalize(uSpireDir.xz);
  float toward = max(dot(normalize(d.xz + 1e-5), sd), 0.0);
  vec3 hor = mix(vec3(0.06, 0.03, 0.035), vec3(0.16, 0.025, 0.012), uCorr);
  return hor + vec3(0.42, 0.04, 0.008) * pow(toward, 4.0) * (0.4 + uCorr) * uSkyGlow;
}
vec3 skyColor(vec3 d) {
  float h = d.y;
  vec3 hor = horizonColor(d);
  vec3 zen = vec3(0.018, 0.006, 0.012);
  vec3 col = mix(hor, zen, smoothstep(-0.02, 0.5, h));
  // smog below the horizon: the lower city glow
  col = mix(col, hor * 0.8 + vec3(0.05, 0.015, 0.0), smoothstep(0.0, -0.25, h));
  return col;
}
vec3 hazeMix(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float d = length(v);
  // aerial perspective: near = dark silhouettes, far = melting into the glowing horizon
  float dens = 0.00042 * uHaze * (1.0 + 2.0 * smoothstep(-40.0, ${GROUND_Y.toFixed(1)}, wp.y));
  float f = 1.0 - exp(-pow(d * dens, 1.5));
  vec3 hc = horizonColor(v / d) * mix(0.45, 1.0, smoothstep(600.0, 2600.0, d));
  return mix(col, hc, clamp(f, 0.0, 1.0));
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
${SKY_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  vec2 sd = normalize(uSpireDir.xz);
  float toward = max(dot(normalize(d.xz + 1e-5), sd), 0.0);
  // clouds: projected onto a plane, lit red from below
  vec2 cp = d.xz / max(d.y + 0.12, 0.05);
  float cl = fbm(vec3(cp * 0.9 + vec2(uTime * 0.004, 0.0), uTime * 0.006));
  float mask = smoothstep(0.42, 0.85, cl) * smoothstep(-0.05, 0.12, d.y) * (1.0 - smoothstep(0.45, 0.95, d.y));
  vec3 lit = horizonColor(d) * 1.7 + vec3(0.25, 0.03, 0.01) * pow(toward, 3.0) * uCorr;
  col = mix(col, lit, mask * 0.75);
  // burning ring around the spire
  vec3 rc = normalize(vec3(sd.x, 0.36, sd.y));
  float ang = acos(clamp(dot(d, rc), -1.0, 1.0));
  float br = 0.75 + 0.5 * fbm(d * 26.0 + vec3(0.0, uTime * 0.15, 0.0));
  float ring = exp(-pow((ang - 0.19) / 0.010, 2.0)) * br;
  float glow = exp(-pow((ang - 0.19) / 0.07, 2.0));
  float inner = exp(-pow(ang / 0.14, 2.0));
  col += (vec3(1.0, 0.13, 0.04) * ring * 3.0 + vec3(0.45, 0.05, 0.02) * glow * 0.6 + vec3(0.25, 0.02, 0.01) * inner * 0.5)
    * uRingGlow * smoothstep(0.1, 0.6, uCorr);
  gl_FragColor = vec4(col, 1.0);
}
`;

const TOWER_VERT = /* glsl */ `
attribute vec4 aInfo; // seed, kind (0 tower, 1 rail, 2 spire), neon, unused
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vScale;
varying vec4 vInfo;
varying vec3 vLocalN;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vLocalN = normal;
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(m) * normal);
  vLocal = position;
  vScale = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TOWER_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vScale;
varying vec4 vInfo;
varying vec3 vLocalN;
${SKY_GLSL}
void main() {
  vec3 n = normalize(vN);
  float seed = vInfo.x;
  float kind = vInfo.y;
  vec3 col = vec3(0.012, 0.012, 0.016) * (0.8 + 0.4 * seed);
  vec2 sd = normalize(uSpireDir.xz);
  // faint red key from the spire side + sky fill from above
  col += vec3(0.05, 0.008, 0.004) * max(dot(n.xz, sd), 0.0) * (0.3 + uCorr);
  col *= 0.6 + 0.6 * max(n.y, 0.0);
  float vertical = 1.0 - abs(n.y);
  if (kind < 0.5 && vertical > 0.5) {
    vec2 uv = vec2(dot(vWorld.xz, vec2(-n.z, n.x)), vWorld.y);
    vec2 cell = uv / vec2(2.6, 3.4);
    vec2 ci = floor(cell);
    vec2 cf = fract(cell);
    float win = step(0.22, cf.x) * step(cf.x, 0.78) * step(0.3, cf.y) * step(cf.y, 0.75);
    float r = nHash12(ci + seed * 113.0);
    float density = uWindows * (0.35 + seed);
    float lit = step(1.0 - density, r) * step(0.3, nHash12(vec2(ci.y, seed * 71.0))) * step(0.15, nHash12(vec2(floor(ci.x / 6.0), seed * 37.0)));
    vec3 wc = mix(vec3(1.0, 0.68, 0.38), vec3(0.6, 0.8, 1.0), step(0.55, fract(r * 7.0)));
    wc = mix(wc, vec3(1.0, 0.12, 0.04), step(0.94, fract(r * 13.0)));
    // sub-pixel windows average out instead of shimmering
    float fw = length(fwidth(cell));
    float w = mix(win * lit, density * 0.12, smoothstep(0.18, 0.6, fw));
    col += wc * w * (0.9 + 0.5 * r);
    // neon edge strips on some towers
    float neon = vInfo.z;
    if (neon > 0.0) {
      bool xFace = abs(vLocalN.x) > 0.5;
      float ex = xFace ? abs(vLocal.z) : abs(vLocal.x);
      float sx = xFace ? vScale.z : vScale.x;
      float edge = step(0.5 - 1.4 / sx, ex);
      vec3 nc = neon > 0.5 ? vec3(0.2, 0.9, 1.0) : vec3(1.0, 0.15, 0.08);
      col += nc * edge * 2.2;
    }
  } else if (kind > 0.5 && kind < 1.5 && vertical > 0.5) {
    // rail: a dashed light line along the side
    float along = dot(vWorld.xz, vec2(-n.z, n.x));
    float dash = step(0.5, fract(along / 9.0)) * (1.0 - step(0.12, abs(vLocal.y - 0.15)));
    col += vec3(1.0, 0.75, 0.45) * dash * 1.5;
  } else if (kind > 1.5) {
    // spire: dark stone with molten veins brightening toward the top
    float t = clamp((vWorld.y - ${GROUND_Y.toFixed(1)}) / 1400.0, 0.0, 1.0);
    float vein = smoothstep(0.62, 0.7, fbm(vec3(vWorld.xz * 0.02, vWorld.y * 0.004 - uTime * 0.02)));
    col = vec3(0.02, 0.008, 0.008) + vec3(1.0, 0.12, 0.03) * (vein * (0.6 + 2.5 * t * t) + pow(t, 6.0) * 1.5) * (0.4 + uCorr);
  }
  gl_FragColor = vec4(hazeMix(col, vWorld), 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
varying vec3 vWorld;
${SKY_GLSL}
void main() {
  // lower city: dark, with an orange street grid and fires
  vec2 p = vWorld.xz;
  vec2 g = abs(fract(p / 70.0 + 0.5) - 0.5) * 70.0;
  vec2 aa = fwidth(p) + 0.5;
  float street = max(1.0 - smoothstep(1.5, 1.5 + aa.x, g.x), 1.0 - smoothstep(1.5, 1.5 + aa.y, g.y));
  float fires = smoothstep(0.72, 0.9, fbm(vec3(p * 0.004, uTime * 0.03)));
  vec3 col = vec3(0.02, 0.01, 0.01) + vec3(1.0, 0.45, 0.15) * street * 0.5 + vec3(1.0, 0.18, 0.05) * fires * 1.4;
  gl_FragColor = vec4(hazeMix(col, vWorld), 1.0);
}
`;

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const POINTS_VERT = /* glsl */ `
attribute vec3 aDir;      // lane direction * length (flyers), zero for static lights
attribute vec4 aParams;   // speed, phase, size, blink (0 = steady)
attribute vec3 aColor;
uniform float uTime, uTraffic;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float len = length(aDir);
  vec3 p = position;
  if (len > 0.0) p += aDir / len * (mod(uTime * aParams.x + aParams.y * len, len) - len * 0.5);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aParams.z * 900.0 / -mv.z, 1.5, 14.0);
  vColor = aColor;
  float blink = aParams.w > 0.0 ? step(0.82, fract(uTime * aParams.w + aParams.y)) : 1.0;
  vAlpha = blink * (len > 0.0 ? uTraffic : 1.0) * exp(-(-mv.z) * 0.0006);
}
`;

const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 14.0) * vAlpha;
  gl_FragColor = vec4(vColor * a * 2.0, a);
}
`;

export class Backdrop {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 5, 9000);
  private readonly uniforms = {
    uTime: { value: 0 },
    uCorr: { value: 0.5 },
    uHaze: { value: 1 },
    uSkyGlow: { value: 1 },
    uRingGlow: { value: 1 },
    uWindows: { value: 0.3 },
    uTraffic: { value: 1 },
    uSpireDir: { value: new Vector3(1, 0, 0) },
  };
  private sky: Mesh | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(readonly opts: BackdropOptions) {
    if (opts.mode === 'none') {
      this.scene.background = new Color(opts.fallback);
      return;
    }
    this.uniforms.uCorr.value = opts.corruption;
    this.uniforms.uSpireDir.value.copy(opts.spireDir).setY(0).normalize();
    const rand = mulberry(1337);
    this.buildSky();
    this.buildCity(rand);
    this.buildGround();
    this.buildLights(rand);
    // MeshBasic billboards use scene fog as their haze (shaders do their own).
    this.scene.fog = new FogExp2(0x2a0d0b, 0.0008);
  }

  private shader(vertexShader: string, fragmentShader: string, extra = {}) {
    const m = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      ...extra,
    });
    this.disposables.push(m);
    return m;
  }

  private buildSky() {
    const geo = new SphereGeometry(4000, 48, 24);
    const sky = new Mesh(
      geo,
      this.shader(SKY_VERT, SKY_FRAG, { side: BackSide, depthWrite: false }),
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;
    this.disposables.push(geo);
  }

  private buildCity(rand: () => number) {
    const { center, radius, spireDir } = this.opts;
    const rMin = radius + 140;
    type Inst = {
      pos: Vector3;
      scale: Vector3;
      yaw: number;
      info: [number, number, number, number];
    };
    const inst: Inst[] = [];
    // towers: denser close in, taller toward the distance for a layered skyline
    for (let i = 0; i < 900; i++) {
      // near towers top out below the (elevated) station; the skyline rises with distance
      const r = rMin + Math.pow(rand(), 1.3) * 2400;
      const a = rand() * Math.PI * 2;
      const fw = 22 + rand() * 50;
      const fd = 22 + rand() * 50;
      const k = (r - rMin) / 2400;
      const h = 110 + k * 620 + Math.pow(rand(), 2) * (160 + k * 420);
      const neonRoll = rand();
      inst.push({
        pos: new Vector3(center.x + Math.cos(a) * r, GROUND_Y, center.z + Math.sin(a) * r),
        scale: new Vector3(fw, h, fd),
        yaw: rand() < 0.7 ? 0 : rand() * Math.PI,
        info: [rand(), 0, neonRoll > 0.88 ? 1 : neonRoll > 0.8 ? 0.4 : 0, 0],
      });
    }
    // megatowers flanking the spire
    for (let i = 0; i < 7; i++) {
      const a = Math.atan2(spireDir.z, spireDir.x) + (rand() - 0.5) * 1.6;
      const r = 700 + rand() * 900;
      const fw = 70 + rand() * 60;
      inst.push({
        pos: new Vector3(center.x + Math.cos(a) * r, GROUND_Y, center.z + Math.sin(a) * r),
        scale: new Vector3(fw, 800 + rand() * 500, fw * (0.7 + rand() * 0.5)),
        yaw: rand() * Math.PI,
        info: [rand(), 0, rand() < 0.5 ? 1 : 0.4, 0],
      });
    }
    // elevated rails: long thin boxes that pass outside the play area
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const off = rMin + 30 + rand() * 900;
      const dir = new Vector3(-Math.sin(a), 0, Math.cos(a));
      const mid = new Vector3(
        center.x + Math.cos(a) * off,
        -90 + rand() * 170,
        center.z + Math.sin(a) * off,
      );
      const len = 600 + rand() * 1400;
      inst.push({
        pos: mid,
        scale: new Vector3(len, 5, 8),
        yaw: -Math.atan2(dir.z, dir.x),
        info: [rand(), 1, 0, 0],
      });
    }
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const mesh = new InstancedMesh(box, this.shader(TOWER_VERT, TOWER_FRAG), inst.length);
    const info = new Float32Array(inst.length * 4);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);
    inst.forEach((t, i) => {
      const pos = t.info[1] === 1 ? t.pos.clone().setY(t.pos.y - t.scale.y / 2) : t.pos;
      m4.compose(pos, q.setFromAxisAngle(yAxis, t.yaw), t.scale);
      mesh.setMatrixAt(i, m4);
      info.set(t.info, i * 4);
    });
    // the spire: tapered 4-sided cones (separate mesh, same shader via kind = 2)
    const spireGeo = new ConeGeometry(0.5, 1, 4, 1);
    spireGeo.translate(0, 0.5, 0);
    const spire = new InstancedMesh(spireGeo, this.shader(TOWER_VERT, TOWER_FRAG), 9);
    const base = center.clone().addScaledVector(spireDir, 1500).setY(GROUND_Y);
    const sinfo = new Float32Array(9 * 4);
    for (let i = 0; i < 9; i++) {
      const main = i === 0;
      const a = (i / 8) * Math.PI * 2;
      const p = main ? base : base.clone().add(new Vector3(Math.cos(a) * 95, 0, Math.sin(a) * 95));
      const s = main ? new Vector3(150, 1500, 150) : new Vector3(50, 600 + rand() * 450, 50);
      m4.compose(p, q.setFromAxisAngle(yAxis, a + 0.4), s);
      spire.setMatrixAt(i, m4);
      sinfo.set([rand(), 2, 0, 0], i * 4);
    }
    mesh.geometry.setAttribute('aInfo', new InstancedBufferAttribute(info, 4));
    spireGeo.setAttribute('aInfo', new InstancedBufferAttribute(sinfo, 4));
    mesh.frustumCulled = spire.frustumCulled = false;
    this.scene.add(mesh, spire);
    this.disposables.push(box, spireGeo);

    // billboards on near towers, facing the play area
    const ads: [string[], boolean][] = [
      [['KORVEX', 'A CLEANER TOMORROW'], false],
      [['SAME FLESH', 'DIFFERENT GODS'], true],
      [['KORVEX', 'REBORN · RENEWED · RESTORED'], false],
      [['REPENT'], true],
    ];
    const textures = ads.map(([lines, red]) => adTexture(lines, red));
    const near = inst
      .filter((t) => t.info[1] === 0 && t.pos.distanceTo(center) < rMin + 500)
      .slice(0, 10);
    near.forEach((t, i) => {
      const tex = textures[i % textures.length] as Texture | null;
      if (!tex) return;
      const w = Math.min(t.scale.x, t.scale.z) * 0.9;
      const plane = new PlaneGeometry(w, w * 0.5);
      const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide, fog: true });
      mat.color.setScalar(1.6);
      const mesh = new Mesh(plane, mat);
      const toCenter = center.clone().sub(t.pos).setY(0).normalize();
      mesh.position.copy(t.pos).addScaledVector(toCenter, Math.max(t.scale.x, t.scale.z) * 0.75);
      mesh.position.y = -40 + rand() * 120;
      mesh.lookAt(center.x, mesh.position.y, center.z);
      this.scene.add(mesh);
      this.disposables.push(plane, mat);
    });
    for (const t of textures) if (t) this.disposables.push(t);
  }

  private buildGround() {
    const geo = new PlaneGeometry(12000, 12000);
    geo.rotateX(-Math.PI / 2);
    const m = new Mesh(geo, this.shader(GROUND_VERT, GROUND_FRAG));
    m.position.y = GROUND_Y;
    this.scene.add(m);
    this.disposables.push(geo);
  }

  private buildLights(rand: () => number) {
    const { center, radius } = this.opts;
    const pos: number[] = [];
    const dir: number[] = [];
    const params: number[] = [];
    const color: number[] = [];
    // flyer lanes (each car: head + tail light share a lane)
    for (let l = 0; l < 46; l++) {
      const a = rand() * Math.PI * 2;
      const off = radius + 80 + rand() * 1100;
      const len = 1400 + rand() * 1400;
      const ld = new Vector3(-Math.sin(a), 0, Math.cos(a));
      const y = -60 + rand() * 320;
      const speed = (35 + rand() * 60) * (rand() < 0.5 ? 1 : -1);
      const cars = 5 + Math.floor(rand() * 8);
      for (let c = 0; c < cars; c++) {
        const phase = rand();
        pos.push(
          center.x + Math.cos(a) * off,
          y + (rand() - 0.5) * 6,
          center.z + Math.sin(a) * off,
        );
        dir.push(ld.x * len, 0, ld.z * len);
        params.push(speed, phase, 2.2, 0);
        const red = rand() < 0.4;
        color.push(...(red ? [1, 0.15, 0.08] : [0.9, 0.95, 1]));
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aDir', new Float32BufferAttribute(dir, 3));
    geo.setAttribute('aParams', new Float32BufferAttribute(params, 4));
    geo.setAttribute('aColor', new Float32BufferAttribute(color, 3));
    const pts = new Points(
      geo,
      this.shader(POINTS_VERT, POINTS_FRAG, {
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.disposables.push(geo);
  }

  /** Follow the main camera (call every render frame before rendering the pass). */
  update(time: number, main: Camera & { fov: number; aspect: number }) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uHaze.value = BACKDROP.haze;
    u.uSkyGlow.value = BACKDROP.skyGlow;
    u.uRingGlow.value = BACKDROP.ringGlow;
    u.uWindows.value = BACKDROP.windows;
    u.uTraffic.value = BACKDROP.traffic;
    main.updateMatrixWorld();
    this.camera.position.setFromMatrixPosition(main.matrixWorld);
    this.camera.quaternion.setFromRotationMatrix(main.matrixWorld);
    if (this.camera.fov !== main.fov || this.camera.aspect !== main.aspect) {
      this.camera.fov = main.fov;
      this.camera.aspect = main.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.sky?.position.copy(this.camera.position);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

/** Backdrop options from a level's worldspawn keys + bounds. */
export function backdropOptionsFor(
  worldProps: Record<string, string>,
  bounds: { min: Vector3; max: Vector3 },
  fallback: number,
): BackdropOptions {
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const radius = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
  const a = (Number(worldProps.spire_angle ?? 0) * Math.PI) / 180;
  return {
    mode: worldProps.backdrop === 'city' ? 'city' : 'none',
    center,
    radius,
    corruption: Number(worldProps.corruption ?? 0.5),
    spireDir: new Vector3(Math.cos(a), 0, -Math.sin(a)),
    fallback,
  };
}
