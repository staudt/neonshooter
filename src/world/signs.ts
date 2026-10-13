import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import type { LevelEntity } from './level';

/**
 * `info_sign` entities → canvas-rendered signage: metro wayfinding, backlit corporate ads,
 * spray-paint graffiti, floor markings. Text is free worldbuilding (and wayfinding).
 *
 * Keys: text ("|" = new line), style (metro | metro_badge | ad | ad_red | graffiti | floor),
 * width/height (m), angle (facing; floor signs: direction the text's top points), arrow (left|right).
 * Origin = center of the sign face; put it ~2 cm off the wall.
 */

type Style = 'metro' | 'metro_badge' | 'ad' | 'ad_red' | 'graffiti' | 'floor';

const PX_PER_M = 256;
const MAX_PX = 2048;
const CONDENSED =
  '"Barlow Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const SPRAY = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

/** Deterministic per-sign randomness (graffiti jitter) from its text. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  family: string,
  maxW: number,
  px: number,
) {
  let size = px;
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.floor((size * maxW) / w);
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, dir: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1);
  ctx.beginPath();
  ctx.moveTo(-s * 0.45, 0);
  ctx.lineTo(0, -s * 0.38);
  ctx.lineTo(0, -s * 0.14);
  ctx.lineTo(s * 0.45, -s * 0.14);
  ctx.lineTo(s * 0.45, s * 0.14);
  ctx.lineTo(0, s * 0.14);
  ctx.lineTo(0, s * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMetro(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: string[],
  arr?: string,
) {
  ctx.fillStyle = '#1b1c1e';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a3b3e';
  ctx.lineWidth = Math.max(2, h * 0.03);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  const pad = h * 0.14;
  let x0 = pad;
  if (arr) {
    ctx.fillStyle = '#f2f2ee';
    const s = h - pad * 2;
    arrow(
      ctx,
      arr === 'right' ? w - pad - s * 0.5 : pad + s * 0.5,
      h / 2,
      Math.min(s, h * 0.6),
      arr === 'right' ? -1 : 1,
    );
    if (arr !== 'right') x0 += s + pad * 0.5;
  }
  // red roundel "M" on the right (left if the arrow sits there)
  const r = h * 0.2;
  const rx = arr === 'right' ? w - pad - (h - pad * 2) - r - pad * 0.5 : w - pad - r;
  const showRoundel = lines.length > 1 && w / h > 2.4;
  if (showRoundel) {
    ctx.fillStyle = '#c8261c';
    ctx.beginPath();
    ctx.arc(rx, h - pad - r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${r * 1.3}px ${CONDENSED}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', rx, h - pad - r * 0.92);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f2f2ee';
  const maxW = (arr === 'right' ? w - h : w) - x0 - pad - (showRoundel ? r * 2.5 : 0);
  if (lines.length === 1) {
    const size = fitFont(ctx, lines[0], '600', CONDENSED, maxW, h * 0.62);
    ctx.fillText(lines[0], x0, h / 2 + size * 0.36);
    return;
  }
  const big = fitFont(ctx, lines[0], '700', CONDENSED, maxW, h * 0.42);
  ctx.fillText(lines[0], x0, pad + big * 0.8);
  ctx.fillStyle = '#c9cac6';
  let y = pad + big * 0.8;
  for (const line of lines.slice(1)) {
    const size = fitFont(ctx, line, '500', CONDENSED, maxW, h * 0.24);
    y += size * 1.2;
    ctx.fillText(line, x0, y);
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.fillStyle = '#1b1c1e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f2f2ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * 0.72}px ${CONDENSED}`;
  ctx.fillText(text, w / 2, h * 0.54);
}

/** Backlit billboard. Korvex = cold teal corporate; ad_red = hell propaganda. */
function drawAd(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: string[],
  red: boolean,
) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (red) {
    g.addColorStop(0, '#120203');
    g.addColorStop(1, '#2a0604');
  } else {
    g.addColorStop(0, '#04141c');
    g.addColorStop(1, '#0a2a33');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const main = red ? '#ff3b26' : '#7ff6ff';
  const sub = red ? '#ff8a6a' : '#cffcff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
  let y = h * 0.18;
  if (!red) {
    // Korvex mark: a trident chevron
    const s = h * 0.22;
    ctx.strokeStyle = main;
    ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    for (const dx of [-0.35, 0, 0.35]) {
      ctx.moveTo(w / 2 + dx * s, y + s * (dx === 0 ? 0 : 0.2));
      ctx.lineTo(w / 2 + dx * s * 0.2, y + s);
    }
    ctx.moveTo(w / 2 - s * 0.4, y + s * 0.55);
    ctx.lineTo(w / 2, y + s * 0.8);
    ctx.lineTo(w / 2 + s * 0.4, y + s * 0.55);
    ctx.stroke();
    y += s * 1.15;
  }
  ctx.shadowColor = main;
  ctx.shadowBlur = h * 0.03;
  ctx.fillStyle = main;
  const first = fitFont(ctx, lines[0], '700', CONDENSED, w * 0.86, red ? h * 0.36 : h * 0.28);
  y += first * (red ? 1.0 : 0.9);
  ctx.fillText(lines[0], w / 2, y);
  ctx.fillStyle = sub;
  for (const line of lines.slice(1)) {
    const size = fitFont(
      ctx,
      line,
      red ? '700' : '500',
      CONDENSED,
      w * 0.8,
      red ? h * 0.36 : h * 0.13,
    );
    y += size * 1.25;
    ctx.fillText(line, w / 2, y);
  }
  ctx.shadowBlur = 0;
}

/** Spray paint: jittered letters, overspray, drips. Transparent background. */
function drawGraffiti(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: string[],
  seed: string,
) {
  const r = rng(seed);
  const lh = h / lines.length;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const red = 'rgba(178, 18, 12, 0.92)';
  lines.forEach((line, li) => {
    const size = fitFont(ctx, line, '400', SPRAY, w * 0.9, lh * 0.85);
    const total = ctx.measureText(line).width;
    let x = (w - total) / 2 + (r() - 0.5) * w * 0.05;
    const y = lh * (li + 0.5);
    for (const ch of line) {
      const cw = ctx.measureText(ch).width;
      ctx.save();
      ctx.translate(x + cw / 2, y + (r() - 0.5) * size * 0.12);
      ctx.rotate((r() - 0.5) * 0.18);
      ctx.shadowColor = 'rgba(150, 10, 6, 0.8)';
      ctx.shadowBlur = size * 0.08;
      ctx.fillStyle = red;
      ctx.fillText(ch, -cw / 2, 0);
      ctx.restore();
      // drips
      if (ch !== ' ' && r() < 0.45) {
        const dx = x + cw * (0.2 + r() * 0.6);
        const len = size * (0.2 + r() * 0.9);
        const wd = size * (0.025 + r() * 0.03);
        ctx.fillStyle = red;
        ctx.fillRect(dx, y + size * 0.3, wd, len);
        ctx.beginPath();
        ctx.arc(dx + wd / 2, y + size * 0.3 + len, wd * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      x += cw;
    }
  });
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: string[],
  seed: string,
) {
  const r = rng(seed);
  ctx.fillStyle = 'rgba(210, 170, 40, 0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, lines[0], '700', CONDENSED, w * 0.95, h * 0.8);
  ctx.fillText(lines[0], w / 2, h / 2);
  // wear: punch holes in the paint
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 400; i++) {
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 1 + r() * h * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Standalone billboard texture (backdrop ads), same art as `ad` / `ad_red` signs. */
export function adTexture(lines: string[], red: boolean, w = 1024, h = 512): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawAd(ctx, w, h, lines, red);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Build one sign's meshes, or null when headless / unknown style. */
function buildSign(e: LevelEntity): Group | null {
  const style = (e.props.style ?? 'metro') as Style;
  const text = e.props.text ?? '';
  const lines = text.split('|');
  const wm = Number(e.props.width ?? 2);
  const hm = Number(e.props.height ?? 0.5);
  const scale = Math.min(PX_PER_M, MAX_PX / Math.max(wm, hm));
  const w = Math.max(16, Math.round(wm * scale));
  const h = Math.max(16, Math.round(hm * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const transparent = style === 'graffiti' || style === 'floor';
  switch (style) {
    case 'metro':
      drawMetro(ctx, w, h, lines, e.props.arrow);
      break;
    case 'metro_badge':
      drawBadge(ctx, w, h, lines[0]);
      break;
    case 'ad':
    case 'ad_red':
      drawAd(ctx, w, h, lines, style === 'ad_red');
      break;
    case 'graffiti':
      drawGraffiti(ctx, w, h, lines, text);
      break;
    case 'floor':
      drawFloor(ctx, w, h, lines, text);
      break;
    default:
      return null;
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  const backlit = style === 'ad' || style === 'ad_red';
  const lit = style === 'metro' || style === 'metro_badge';
  const mat = new MeshStandardMaterial({
    map: tex,
    transparent,
    alphaTest: transparent ? 0.05 : 0,
    depthWrite: !transparent,
    roughness: transparent ? 0.9 : backlit ? 0.4 : 0.55,
    metalness: 0,
    emissive: backlit || lit ? 0xffffff : 0x000000,
    emissiveMap: backlit || lit ? tex : null,
    emissiveIntensity: backlit ? 2.2 : lit ? 0.35 : 0,
    polygonOffset: transparent,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const g = new Group();
  g.name = `sign:${text}`;
  const face = new Mesh(new PlaneGeometry(wm, hm), mat);
  g.add(face);
  if (!transparent) {
    // backing slab so hanging signs have thickness
    const back = new Mesh(
      new BoxGeometry(wm + 0.04, hm + 0.04, 0.05),
      new MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.4 }),
    );
    back.position.z = -0.026;
    g.add(back);
  }
  g.position.copy(e.origin);
  if (style === 'floor') {
    g.rotation.set(-Math.PI / 2, e.yaw, 0, 'YXZ');
  } else {
    g.rotation.y = e.yaw + Math.PI;
  }
  return g;
}

/** All `info_sign` entities of a level as one group (empty when headless). */
export function buildSigns(entities: LevelEntity[]): Group {
  const root = new Group();
  root.name = 'signs';
  if (typeof document === 'undefined') return root;
  for (const e of entities) {
    if (e.classname !== 'info_sign') continue;
    const s = buildSign(e);
    if (s) root.add(s);
  }
  return root;
}
