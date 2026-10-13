import { Color, MeshStandardMaterial, type Material } from 'three';
import { defineTunables } from '../dev/tuning';
import {
  FALLBACK_MATERIAL,
  PALETTE,
  paletteEntry,
  type PaletteEntry,
  type SurfaceStyle,
} from './palette';

/**
 * World materials: MeshStandardMaterial + a procedural, world-space surface layer per palette
 * `style` (onBeforeCompile). Brushes carry no meaningful UVs, so all detail is derived from world
 * position and normal: concrete formwork, metro tiles, puddles, rust, grating, glowing hell cracks.
 */

export const SURFACE = defineTunables(
  'look: surfaces',
  {
    detail: 1,
    bump: 1,
    puddles: 0.55,
    grime: 0.7,
    crackGlow: 1,
    crackPulse: 0.35,
  },
  {
    detail: [0, 2, 0.01],
    bump: [0, 4, 0.01],
    puddles: [0, 1, 0.01],
    grime: [0, 1.5, 0.01],
    crackGlow: [0, 3, 0.01],
    crackPulse: [0, 1, 0.01],
  },
);

const uniforms = {
  uDetail: { value: 1 },
  uBump: { value: 1 },
  uPuddles: { value: 0.5 },
  uGrime: { value: 0.7 },
  uCrackGlow: { value: 1 },
  uCrackPulse: { value: 0.35 },
  uTime: { value: 0 },
};

/** Push tunables + time into the shared surface uniforms (once per render frame). */
export function updateSurfaceUniforms(time: number) {
  uniforms.uDetail.value = SURFACE.detail;
  uniforms.uBump.value = SURFACE.bump;
  uniforms.uPuddles.value = SURFACE.puddles;
  uniforms.uGrime.value = SURFACE.grime;
  uniforms.uCrackGlow.value = SURFACE.crackGlow;
  uniforms.uCrackPulse.value = SURFACE.crackPulse;
  uniforms.uTime.value = time;
}

const STYLE_IDS: Record<SurfaceStyle, number> = {
  concrete: 1,
  floor: 2,
  tile: 3,
  metal: 4,
  rust: 5,
  grate: 6,
  hazard: 7,
  panel: 8,
  hellcrack: 9,
};

/** Shared GLSL: hashes, value noise, fbm, 2D cells. Also used by corruption/backdrop shaders. */
export const NOISE_GLSL = /* glsl */ `
float nHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float nHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 nHash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(nHash13(i), nHash13(i + vec3(1, 0, 0)), f.x), mix(nHash13(i + vec3(0, 1, 0)), nHash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(nHash13(i + vec3(0, 0, 1)), nHash13(i + vec3(1, 0, 1)), f.x), mix(nHash13(i + vec3(0, 1, 1)), nHash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
// 2D cells: x = distance to nearest feature, y = F2 - F1 (0 on cell borders), z = cell id hash.
vec3 cells2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = nHash22(i + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = nHash12(i + g); } else if (d < d2) { d2 = d; }
  }
  return vec3(d1, d2 - d1, id);
}
`;

const SURFACE_GLSL = /* glsl */ `
uniform float uDetail, uBump, uPuddles, uGrime, uCrackGlow, uCrackPulse, uTime;
varying vec3 vSurfPos;
varying vec3 vSurfN;
${NOISE_GLSL}
// Grid lines of width w (meters) every s meters along both plane axes; 1 on a line.
float gridLine(vec2 p, vec2 s, float w) {
  vec2 q = abs(fract(p / s + 0.5) - 0.5) * s;
  vec2 aa = fwidth(p) * 0.75 + 1e-4;
  vec2 l = 1.0 - smoothstep(vec2(w) - aa, vec2(w) + aa, q);
  return max(l.x, l.y);
}
vec3 surfPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

/** Per-style body: reads p (world pos), n (world normal), uv (plane coords), up (0..1 facing up);
 *  writes alb (albedo multiplier/replacement), rough, metal, hgt (bump height), emit (emissive mask). */
const STYLE_GLSL = /* glsl */ `
  vec3 p = vSurfPos;
  vec3 n = normalize(vSurfN);
  vec3 an = abs(n);
  vec2 uv = an.x > an.y && an.x > an.z ? p.zy : (an.y > an.z ? p.xz : p.xy);
  float up = clamp(n.y, 0.0, 1.0);
  float vertical = 1.0 - an.y;
  // high-frequency detail fades out when it would alias
  float hfFade = 1.0 - smoothstep(0.02, 0.08, length(fwidth(p)));
  vec3 alb = diffuseColor.rgb;
  float rough = roughnessFactor;
  float metal = metalnessFactor;
  float hgt = 0.0;
  float emit = 1.0;
  float big = fbm(p * 0.35);
  float mid = fbm(p * 1.7 + 3.1);
  float fine = vnoise(p * 9.0) * hfFade;
  // Grime: big blotches + vertical rain streaks on walls (stronger lower down).
  float streak = fbm(vec3(uv.x * 4.0, p.y * 0.12, uv.x * 0.7)) * vertical;
  float grime = clamp((big - 0.45) * 1.6 + streak * 0.6, 0.0, 1.0) * uGrime;

#if SURF_STYLE == 1 || SURF_STYLE == 2
  // Board-formed concrete: mottling, board seams every 0.6 m (walls), tie holes on a 1.2 x 0.6 grid.
  alb *= mix(0.78, 1.08, mid) * mix(0.93, 1.04, fine * uDetail + (1.0 - uDetail) * 0.5);
  float seam = gridLine(vec2(0.0, p.y), vec2(1.0, 0.6), 0.006) * vertical * uDetail * hfFade;
  vec2 tie = abs(fract(vec2(uv.x / 1.2, p.y / 0.6) + 0.5) - 0.5) * vec2(1.2, 0.6);
  float hole = (1.0 - smoothstep(0.012, 0.022, length(tie))) * vertical * uDetail * hfFade;
  alb *= 1.0 - seam * 0.25 - hole * 0.6;
  hgt = fine * 0.15 + mid * 0.2 - seam * 0.3 - hole * 0.5;
  alb *= 1.0 - grime * 0.45;
  rough = clamp(rough + (mid - 0.5) * 0.15, 0.0, 1.0);
#endif
#if SURF_STYLE == 2
  // Wet patches on up-facing surfaces: dark, mirror-smooth, flat.
  float wetN = fbm(vec3(p.x * 0.28, 0.0, p.z * 0.28) + 11.0);
  float wet = smoothstep(0.62 - uPuddles * 0.22, 0.66 - uPuddles * 0.22, wetN) * up;
  float damp = smoothstep(0.45 - uPuddles * 0.2, 0.62 - uPuddles * 0.2, wetN) * up;
  alb *= mix(1.0, 0.62, damp);
  rough = mix(rough, 0.55, damp * 0.6);
  rough = mix(rough, 0.04, wet);
  hgt *= 1.0 - wet;
#endif
#if SURF_STYLE == 3
  // Metro tiles 0.3 x 0.15, running bond; grout, per-tile tint, chipped/missing tiles.
  vec2 t = vec2(uv.x / 0.3, p.y / 0.15);
  if (an.y > 0.5) t = uv / vec2(0.3, 0.15);
  t.x += step(1.0, mod(floor(t.y), 2.0)) * 0.5;
  vec2 ti = floor(t);
  vec2 tf = abs(fract(t) - 0.5) * vec2(0.3, 0.15);
  float tileH = nHash12(ti);
  vec2 aa = fwidth(t) * vec2(0.3, 0.15) + 1e-4;
  vec2 g2 = smoothstep(vec2(0.15, 0.075) - 0.006 - aa, vec2(0.15, 0.075) - 0.006 + aa, tf);
  float grout = max(g2.x, g2.y) * hfFade;
  float missing = step(0.93, nHash12(ti + 7.7)) * step(0.5, fbm(p * 0.6 + 2.0));
  alb *= mix(0.9, 1.05, tileH);
  alb = mix(alb, alb * 0.45, grout);
  alb = mix(alb, vec3(0.22, 0.21, 0.2) * (0.7 + mid * 0.5), missing);
  rough = mix(rough, 0.85, max(grout, missing));
  rough = mix(rough, 0.6, grime);
  hgt = (1.0 - grout) * 0.4 - missing * 0.6 + fine * 0.05;
  alb *= 1.0 - grime * 0.5;
#endif
#if SURF_STYLE == 4 || SURF_STYLE == 8
  // Panels with seams; rust bleeding from seams and blotches.
  vec2 ps = SURF_STYLE == 8 ? vec2(2.2, 1.2) : vec2(1.0, 1.0);
  float seamM = gridLine(uv, ps, 0.008) * hfFade;
  float bleed = clamp((fbm(p * 1.3) - 0.55) * 3.0 + seamM * 0.6, 0.0, 1.0) * (SURF_STYLE == 8 ? 0.45 : 0.8);
  vec3 rustC = vec3(0.30, 0.15, 0.08) * (0.7 + mid * 0.6);
  alb = mix(alb * (0.9 + fine * 0.15), rustC, bleed);
  alb *= 1.0 - seamM * 0.6;
  rough = mix(rough + fine * 0.1, 0.85, bleed);
  metal = mix(metal, 0.2, bleed);
  hgt = -seamM * 0.6 + bleed * 0.2 + fine * 0.08;
  alb *= 1.0 - grime * 0.4;
#endif
#if SURF_STYLE == 5
  float c = fbm(p * 2.2);
  alb = mix(vec3(0.20, 0.10, 0.05), vec3(0.42, 0.22, 0.10), c) * (0.8 + fine * 0.3);
  float pit = smoothstep(0.6, 0.75, vnoise(p * 14.0)) * hfFade;
  alb *= 1.0 - pit * 0.4;
  rough = 0.7 + c * 0.25;
  metal = 0.25 + (1.0 - c) * 0.3;
  hgt = c * 0.4 - pit * 0.4;
#endif
#if SURF_STYLE == 6
  // Grating: bars 3 cm every 9 cm one way, 1 cm cross bars every 30 cm; black gaps.
  vec2 g = abs(fract(uv / vec2(0.09, 0.3) + 0.5) - 0.5) * vec2(0.09, 0.3);
  vec2 aa6 = fwidth(uv) + 1e-4;
  float bar = max(1.0 - smoothstep(0.015 - aa6.x, 0.015 + aa6.x, g.x), 1.0 - smoothstep(0.006 - aa6.y, 0.006 + aa6.y, g.y));
  bar = mix(0.7, bar, hfFade);
  alb = mix(vec3(0.015), alb * (0.8 + mid * 0.4), bar);
  rough = mix(0.9, rough, bar);
  hgt = bar * 0.6;
  float rustG = smoothstep(0.55, 0.75, big);
  alb = mix(alb, alb * vec3(1.2, 0.75, 0.5), rustG * bar);
#endif
#if SURF_STYLE == 7
  // Tactile hazard strip: raised dots, worn paint.
  vec2 d = abs(fract(uv / 0.06 + 0.5) - 0.5) * 0.06;
  float dot6 = (1.0 - smoothstep(0.013, 0.017, length(d))) * hfFade;
  float worn = smoothstep(0.5, 0.8, fbm(p * 2.5));
  alb = mix(alb, vec3(0.18, 0.17, 0.15), worn * 0.7);
  alb *= 0.85 + dot6 * 0.25;
  hgt = dot6 * 0.8;
  rough = mix(rough, 0.9, worn);
  alb *= 1.0 - grime * 0.4;
#endif
#if SURF_STYLE == 9
  // Hell cracks: dark rock/flesh plates, glowing borders that pulse slowly.
  vec2 q = uv * 1.1 + vec2(fbm(p * 0.8), fbm(p * 0.8 + 5.0)) * 0.9;
  vec3 cl = cells2(q);
  float crack = 1.0 - smoothstep(0.02, 0.12 + 0.08 * big, cl.y);
  float pulse = 1.0 + uCrackPulse * sin(uTime * 1.7 + cl.z * 6.28 + p.y * 0.8);
  alb = mix(alb * (0.6 + mid * 0.8), vec3(0.05, 0.01, 0.0), crack);
  emit = (crack * (0.6 + 0.4 * fbm(p * 3.0 + uTime * 0.1)) + smoothstep(0.7, 1.0, big) * 0.08) * uCrackGlow * pulse;
  rough = mix(0.35 + mid * 0.3, 0.9, crack);
  hgt = -crack * 0.8 + cl.x * 0.3 + fine * 0.1;
#endif
  diffuseColor.rgb = alb;
`;

function create(entry: PaletteEntry): Material {
  const m = new MeshStandardMaterial({
    color: new Color(entry.color),
    roughness: entry.roughness,
    metalness: entry.metalness ?? 0,
    emissive: new Color(entry.emissive ?? 0x000000),
    emissiveIntensity: entry.emissiveIntensity ?? 0,
  });
  const style = entry.style ? STYLE_IDS[entry.style] : 0;
  if (!style) return m;
  m.customProgramCacheKey = () => `surf${style}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...shader.defines, SURF_STYLE: style };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSurfPos;\nvarying vec3 vSurfN;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSurfPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSurfN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
      // roughness/metalness locals exist from here on; color is set after both are declared
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\n${STYLE_GLSL}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        roughnessFactor = rough; metalnessFactor = metal;
        normal = surfPerturb(-vViewPosition, normal, vec2(dFdx(hgt), dFdy(hgt)) * uBump * 0.6, faceDirection);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= emit;',
      );
  };
  return m;
}

const cache = new Map<string, Material>();

/** Shared material for a palette name. Unknown names fall back to concrete. */
export function getMaterial(name: string): Material {
  let m = cache.get(name);
  if (!m) {
    m = create(paletteEntry(name) ?? PALETTE[FALLBACK_MATERIAL]);
    cache.set(name, m);
  }
  return m;
}
