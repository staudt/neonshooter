import { Color, MeshStandardMaterial, Vector3 } from 'three';
import { defineTunables } from '../dev/tuning';
import { NOISE_GLSL } from '../world/materials';

/**
 * The shared demon look: near-black skin, glowing ridged veins (object-space noise, so the pattern
 * sticks to the model and needs no UVs), a fresnel rim that keeps silhouettes readable in fog, and a
 * slow heartbeat pulse. Every enemy uses it, whatever the mesh source, so mismatched or low-poly
 * models read as one set. Standard `emissive` still works on top (hit flash).
 */

export const CORRUPTION = defineTunables(
  'look: corruption',
  { veinGlow: 2.6, veinWidth: 0.022, rim: 0.9, pulse: 0.45, char: 0.7 },
  {
    veinGlow: [0, 8, 0.01],
    veinWidth: [0.005, 0.3, 0.001],
    rim: [0, 6, 0.01],
    pulse: [0, 1, 0.01],
    char: [0, 1, 0.01],
  },
);

const shared = {
  uVeinGlow: { value: 2.2 },
  uVeinWidth: { value: 0.07 },
  uRim: { value: 1.4 },
  uPulse: { value: 0.45 },
  uChar: { value: 0.6 },
  uTime: { value: 0 },
};

/** Push tunables + time (once per render frame). */
export function updateCorruptionUniforms(time: number) {
  shared.uVeinGlow.value = CORRUPTION.veinGlow;
  shared.uVeinWidth.value = CORRUPTION.veinWidth;
  shared.uRim.value = CORRUPTION.rim;
  shared.uPulse.value = CORRUPTION.pulse;
  shared.uChar.value = CORRUPTION.char;
  shared.uTime.value = time;
}

export interface SkinOptions {
  /** Base albedo (keep it dark). */
  color?: number;
  veinColor?: number;
  /** 0..1: how much of the surface carries veins (bone/horn ≈ 0.2, flesh 1). */
  veins?: number;
  /** Noise frequency in the mesh's local units (bigger = finer veins). */
  scale?: number;
  roughness?: number;
  metalness?: number;
}

/** One material per enemy part (per instance: the hit flash writes `emissive`). */
export function corruptionMaterial(o: SkinOptions = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: o.color ?? 0x120d0c,
    roughness: o.roughness ?? 0.55,
    metalness: o.metalness ?? 0.05,
    emissive: 0x000000,
  });
  const own = {
    uVeinColor: { value: new Color(o.veinColor ?? 0xff2a0c) },
    uVeins: { value: o.veins ?? 1 },
    uScale: { value: o.scale ?? 8 },
    uSeed: { value: new Vector3(Math.random() * 50, Math.random() * 50, Math.random() * 50) },
  };
  m.userData.corruption = own;
  m.customProgramCacheKey = () => 'corruption';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uVeinGlow, uVeinWidth, uRim, uPulse, uChar, uTime, uVeins, uScale;
uniform vec3 uVeinColor, uSeed;
varying vec3 vSkinPos;
${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // veins = iso-lines of warped value noise: thin in noise space, but never thinner than ~1 px
        vec3 sp = vSkinPos * uScale + uSeed;
        sp += (vec3(vnoise(sp * 0.5), vnoise(sp * 0.5 + 19.0), vnoise(sp * 0.5 + 41.0)) - 0.5) * 1.2;
        float n1 = vnoise(sp);
        float n2 = vnoise(sp * 2.7 + 7.0);
        float vr1 = abs(n1 - 0.5);
        float vr2 = abs(n2 - 0.5);
        float aa1 = fwidth(n1) * 1.2;
        float aa2 = fwidth(n2) * 1.2;
        float vein = max(1.0 - smoothstep(uVeinWidth, uVeinWidth + aa1, vr1),
                         (1.0 - smoothstep(uVeinWidth * 0.5, uVeinWidth * 0.5 + aa2, vr2)) * 0.45) * uVeins;
        float charred = (1.0 - smoothstep(0.0, uVeinWidth * 5.0, vr1)) * uVeins;
        diffuseColor.rgb *= mix(1.0, 0.25, charred * uChar);
        diffuseColor.rgb *= 0.8 + 0.4 * vnoise(sp * 4.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float beat = 1.0 + uPulse * sin(uTime * 3.2 + vSkinPos.y * 5.0 + uSeed.x);
        float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 4.0);
        totalEmissiveRadiance += uVeinColor * (vein * uVeinGlow * beat + fres * uRim * 0.3);`,
      );
  };
  return m;
}
