import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type Material,
} from 'three';
import type { WeaponDef } from './defs';

/**
 * Procedural placeholder gun models (boxes + cylinders, neon accents). Model space: barrel along -Z,
 * origin at the grip/receiver, sight line at y = def.sightHeight. Swap for CC0 glTF later — keep
 * the same anchors: `muzzle` (Group at the muzzle) and `mag` (Group that animates on reload).
 */
export interface GunModel {
  root: Group;
  muzzle: Group;
  mag: Group;
  flash: Mesh;
}

const mats = {
  body: new MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.45, metalness: 0.6 }),
  dark: new MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.4 }),
  light: new MeshStandardMaterial({ color: 0xbfc5cf, roughness: 0.5, metalness: 0.3 }),
  neon: new MeshStandardMaterial({ color: 0x000000, emissive: 0x22e6ff, emissiveIntensity: 3 }),
  dot: new MeshBasicMaterial({ color: 0xff2b4a }),
  glass: new MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.12,
  }),
};

function box(w: number, h: number, d: number, x: number, y: number, z: number, m: Material) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(r: number, len: number, x: number, y: number, z: number, m: Material) {
  const mesh = new Mesh(new CylinderGeometry(r, r, len, 12), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

let flashTexture: CanvasTexture | null = null;
function getFlashTexture() {
  if (flashTexture) return flashTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.2, 'rgba(255,220,140,0.9)');
  grad.addColorStop(0.5, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // A few spikes so it reads as a flash, not a glow.
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,230,180,0.8)';
  g.lineWidth = 6;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    g.stroke();
  }
  flashTexture = new CanvasTexture(c);
  return flashTexture;
}

function makeFlash() {
  const m = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: getFlashTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
  m.visible = false;
  m.renderOrder = 10;
  return m;
}

function buildAR(def: WeaponDef): GunModel {
  const root = new Group();
  const s = def.sightHeight;
  root.add(box(0.06, 0.075, 0.34, 0, 0, -0.08, mats.body)); // receiver
  root.add(box(0.052, 0.06, 0.2, 0, 0.004, -0.32, mats.dark)); // handguard
  root.add(box(0.054, 0.006, 0.18, 0, -0.018, -0.32, mats.neon)); // neon strip (both sides visible)
  root.add(cyl(0.011, 0.14, 0, 0.012, -0.47, mats.dark)); // barrel
  root.add(box(0.03, 0.03, 0.05, 0, 0.012, -0.53, mats.body)); // muzzle brake
  root.add(box(0.045, 0.06, 0.2, 0, -0.01, 0.17, mats.dark)); // stock
  root.add(box(0.035, 0.09, 0.04, 0, -0.07, 0.03, mats.dark)); // grip
  // Red dot: housing + glass + dot exactly on the sight line.
  root.add(box(0.04, 0.008, 0.08, 0, s - 0.03, -0.05, mats.dark));
  root.add(box(0.004, 0.035, 0.012, -0.018, s - 0.01, -0.07, mats.dark));
  root.add(box(0.004, 0.035, 0.012, 0.018, s - 0.01, -0.07, mats.dark));
  root.add(box(0.04, 0.004, 0.012, 0, s + 0.009, -0.07, mats.dark));
  root.add(box(0.032, 0.03, 0.002, 0, s, -0.07, mats.glass));
  root.add(box(0.0025, 0.0025, 0.001, 0, s, -0.071, mats.dot));
  const mag = new Group();
  mag.add(box(0.03, 0.12, 0.06, 0, -0.06, 0, mats.light));
  mag.add(box(0.032, 0.006, 0.062, 0, -0.118, 0, mats.neon));
  mag.position.set(0, -0.035, -0.13);
  mag.rotation.x = 0.18;
  root.add(mag);
  return finish(root, def, mag);
}

function buildPistol(def: WeaponDef): GunModel {
  const root = new Group();
  const s = def.sightHeight;
  root.add(box(0.032, 0.036, 0.19, 0, 0.022, -0.09, mats.body)); // slide
  root.add(box(0.03, 0.022, 0.15, 0, -0.005, -0.07, mats.dark)); // frame
  root.add(box(0.031, 0.004, 0.12, 0, 0.006, -0.1, mats.neon));
  const grip = box(0.03, 0.1, 0.045, 0, -0.06, 0.0, mats.dark);
  grip.rotation.x = -0.25;
  root.add(grip);
  // Sights: rear notch posts + front post with a glowing dot on the sight line.
  root.add(box(0.008, 0.016, 0.008, -0.009, s - 0.008, 0.0, mats.dark));
  root.add(box(0.008, 0.016, 0.008, 0.009, s - 0.008, 0.0, mats.dark));
  root.add(box(0.005, 0.016, 0.006, 0, s - 0.008, -0.175, mats.dark));
  root.add(box(0.003, 0.003, 0.001, 0, s - 0.0005, -0.1785, mats.dot));
  const mag = new Group();
  mag.add(box(0.024, 0.09, 0.034, 0, -0.045, 0, mats.light));
  mag.position.set(0, -0.02, 0.0);
  mag.rotation.x = -0.25;
  root.add(mag);
  return finish(root, def, mag);
}

function finish(root: Group, def: WeaponDef, mag: Group): GunModel {
  const muzzle = new Group();
  muzzle.position.set(...def.muzzle);
  root.add(muzzle);
  const flash = makeFlash();
  muzzle.add(flash);
  return { root, muzzle, mag, flash };
}

export function buildGunModel(def: WeaponDef): GunModel {
  return def.id === 'ar' ? buildAR(def) : buildPistol(def);
}

// ---- off-hand knife (pistol + knife) ----

/** Combat knife, grip at the origin, blade along -Z, edge facing -Y. */
export function buildKnife(): Group {
  const g = new Group();
  g.name = 'knife';
  const steel = new MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.25, metalness: 0.95 });
  g.add(box(0.026, 0.03, 0.11, 0, 0, 0.02, mats.dark)); // handle
  g.add(box(0.06, 0.012, 0.012, 0, 0, -0.04, mats.body)); // guard
  const blade = box(0.006, 0.032, 0.15, 0, 0.002, -0.12, steel);
  g.add(blade);
  const tip = new Mesh(new CylinderGeometry(0, 0.016, 0.05, 4), steel);
  tip.rotation.x = -Math.PI / 2;
  tip.scale.set(0.38, 1, 1);
  tip.position.set(0, 0.002, -0.22);
  g.add(tip);
  const glint = new MeshStandardMaterial({ color: 0x000000, emissive: 0x9fe8ff, emissiveIntensity: 0.6 });
  g.add(box(0.007, 0.003, 0.15, 0, -0.016, -0.12, glint)); // edge glint
  return g;
}

// ---- energy riot shield ----

export interface ShieldModel {
  root: Group;
  material: ShaderMaterial;
}

const SHIELD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHIELD_FRAG = /* glsl */ `
uniform float uTime, uFlash, uHealth, uAlpha;
varying vec2 vUv;
// distance to the nearest hex center edge (0 at edges)
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(vec2(1.0, 1.732))), q.x);
}
void main() {
  vec2 uv = vUv;
  float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float border = 1.0 - smoothstep(0.0, 0.06, edgeDist);
  float hex = 1.0 - smoothstep(0.0, 0.06, hexEdge(uv * vec2(30.0, 20.0)));
  // viewport: the middle is nearly clear so you can still see what's coming
  float center = smoothstep(0.08, 0.42, edgeDist);
  float scan = 0.5 + 0.5 * sin(uv.y * 180.0 - uTime * 6.0);
  float flicker = uHealth < 0.35 ? step(0.25, fract(sin(floor(uTime * 24.0) * 91.7) * 4375.5)) : 1.0;
  float a = (border * 0.55 + hex * mix(0.26, 0.025, center) + scan * 0.02 + uFlash * (0.3 + hex * 0.6)) * flicker;
  vec3 col = mix(vec3(0.25, 0.85, 1.0), vec3(1.0, 0.35, 0.2), (1.0 - uHealth) * 0.6);
  gl_FragColor = vec4(col * a * 1.6, a * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Curved translucent panel in front of the camera (viewmodel space), dark metal frame bars at the
 * edges. `material.uniforms`: uFlash (block hit), uHealth (0..1), uAlpha (raise fade).
 */
export function buildShield(): ShieldModel {
  const root = new Group();
  root.name = 'shield';
  const radius = 0.72;
  const arc = 1.2;
  const height = 0.66;
  const geo = new CylinderGeometry(radius, radius, height, 20, 1, true, Math.PI - arc / 2, arc);
  geo.translate(0, 0, radius - 0.44); // panel ~0.44 m in front of the camera
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uHealth: { value: 1 },
      uAlpha: { value: 1 },
    },
    vertexShader: SHIELD_VERT,
    fragmentShader: SHIELD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  root.add(new Mesh(geo, material));
  for (const t of [Math.PI - arc / 2, Math.PI + arc / 2]) {
    const bar = box(0.03, height + 0.03, 0.03, 0, 0, 0, mats.dark);
    bar.position.set(radius * Math.sin(t), 0, radius * Math.cos(t) + radius - 0.44);
    root.add(bar);
  }
  // grip: the left hand holds a strut behind the panel
  root.add(box(0.035, 0.11, 0.035, -0.14, -0.22, -0.33, mats.body));
  return { root, material };
}
