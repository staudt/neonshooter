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
