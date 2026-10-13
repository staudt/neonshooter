import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { defineTunables } from '../dev/tuning';

/**
 * Drifting embers + ash in a box that wraps around the camera (no per-particle CPU work).
 * Amount scales with the level's `corruption`.
 */

export const EMBERS = defineTunables(
  'look: embers',
  { amount: 1, rise: 0.35, size: 1 },
  { amount: [0, 3, 0.01], rise: [0, 2, 0.01], size: [0, 3, 0.01] },
);

const COUNT = 900;
const BOX = 28;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uRise, uSize, uAmount;
uniform vec3 uCam;
varying float vHeat;
varying float vAlpha;
void main() {
  float box = ${BOX.toFixed(1)};
  float t = uTime;
  vec3 drift = vec3(sin(t * 0.3 + aSeed.x * 6.28) * 0.6, uRise * (0.4 + aSeed.y), cos(t * 0.23 + aSeed.z * 6.28) * 0.6);
  vec3 p = position + drift * t + vec3(sin(t * (1.0 + aSeed.w * 2.0) + aSeed.x * 40.0), 0.0, cos(t * 1.3 + aSeed.y * 40.0)) * 0.25;
  // wrap into a box centered on the camera
  p = uCam + mod(p - uCam + box * 0.5, box) - box * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vHeat = step(0.55, aSeed.w);
  float sz = mix(0.05, 0.11, aSeed.y) * (vHeat > 0.5 ? 1.0 : 1.6) * uSize;
  gl_PointSize = clamp(sz * 700.0 / -mv.z, 1.0, 9.0);
  float flicker = 0.6 + 0.4 * sin(t * (6.0 + aSeed.z * 9.0) + aSeed.x * 30.0);
  vAlpha = step(aSeed.x, uAmount * 0.5) * flicker * smoothstep(box * 0.5, box * 0.3, length(mv.xyz));
}
`;

const FRAG = /* glsl */ `
varying float vHeat;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 16.0) * vAlpha;
  vec3 col = vHeat > 0.5 ? vec3(1.0, 0.32, 0.08) * 3.0 : vec3(0.35, 0.33, 0.32) * 0.5;
  gl_FragColor = vec4(col * a, a);
}
`;

export class Embers {
  readonly points: Points;
  private readonly mat: ShaderMaterial;

  constructor() {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = (Math.random() - 0.5) * BOX;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new Float32BufferAttribute(seed, 4));
    this.mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRise: { value: 0.35 },
        uSize: { value: 1 },
        uAmount: { value: 1 },
        uCam: { value: new Vector3() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(time: number, camPos: Vector3, corruption: number) {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uRise.value = EMBERS.rise;
    u.uSize.value = EMBERS.size;
    u.uAmount.value = EMBERS.amount * (0.25 + corruption);
    u.uCam.value.copy(camPos);
  }
}
