import { N8AOPostPass } from 'n8ao';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import {
  ACESFilmicToneMapping,
  HalfFloatType,
  NoToneMapping,
  Vector2,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { defineTunables } from '../dev/tuning';

/**
 * Frame: backdrop (own camera, far depth) → world (depth cleared, same color buffer) → N8AO →
 * viewmodel (depth cleared again, so it never clips or gets AO) → bloom + grade + tone map (AgX) →
 * chromatic aberration + grain → SMAA.
 */

export const POST = defineTunables(
  'look: post',
  {
    /** 0 = AgX, 1 = ACES filmic, 2 = Khronos neutral. ACES keeps hell reds red; AgX bleaches them pink. */
    toneMapper: 1,
    exposure: 1.2,
    aoIntensity: 3.2,
    aoRadius: 2.2,
    bloom: 0.8,
    bloomThreshold: 1.0,
    bloomRadius: 0.6,
    saturation: -0.12,
    contrast: 0.16,
    vignette: 0.55,
    grain: 0.09,
    damageAberration: 0.006,
  },
  {
    toneMapper: [0, 2, 1],
    exposure: [0.2, 3, 0.01],
    aoIntensity: [0, 8, 0.05],
    aoRadius: [0.2, 6, 0.05],
    bloom: [0, 4, 0.01],
    bloomThreshold: [0, 2, 0.01],
    bloomRadius: [0, 1, 0.01],
    saturation: [-1, 1, 0.01],
    contrast: [-0.5, 0.5, 0.01],
    vignette: [0, 1.5, 0.01],
    grain: [0, 0.5, 0.005],
    damageAberration: [0, 0.03, 0.0005],
  },
);

export interface PipelineScenes {
  backdrop: { scene: Scene; camera: PerspectiveCamera };
  world: { scene: Scene; camera: PerspectiveCamera };
  viewmodel: { scene: Scene; camera: PerspectiveCamera };
}

export class RenderPipeline {
  readonly composer: EffectComposer;
  private readonly backdropPass: RenderPass;
  private readonly worldPass: RenderPass;
  private readonly vmPass: RenderPass;
  private readonly ao: N8AOPostPass;
  private readonly bloom: BloomEffect;
  private readonly hueSat: HueSaturationEffect;
  private readonly contrast: BrightnessContrastEffect;
  private readonly vignette: VignetteEffect;
  private readonly noise: NoiseEffect;
  private readonly aberration: ChromaticAberrationEffect;
  private readonly tone: ToneMappingEffect;
  /** 0..1, set by the game: low health → aberration + desaturation. */
  damage = 0;
  /** Viewmodel pass on/off (noclip, death cam). */
  showViewmodel = true;

  constructor(
    private readonly renderer: WebGLRenderer,
    scenes: PipelineScenes,
    opts: { lowQuality?: boolean } = {},
  ) {
    renderer.toneMapping = NoToneMapping; // the ToneMappingEffect does it
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.scenes = { ...scenes };
    const { world, backdrop, viewmodel } = scenes;
    const camera = world.camera;

    this.backdropPass = new RenderPass(backdrop.scene, backdrop.camera);
    this.worldPass = new RenderPass(world.scene, camera);
    this.worldPass.clearPass.setClearFlags(false, true, false);
    this.worldPass.ignoreBackground = true;

    const size = renderer.getDrawingBufferSize(new Vector2());
    this.ao = new N8AOPostPass(world.scene, camera, size.x, size.y);
    const aoCfg = this.ao.configuration;
    aoCfg.halfRes = opts.lowQuality || renderer.getPixelRatio() > 1.25;
    aoCfg.depthAwareUpsampling = true;
    aoCfg.screenSpaceRadius = false;
    if (opts.lowQuality) {
      aoCfg.aoSamples = 8;
      aoCfg.denoiseSamples = 4;
    }
    this.ao.setQualityMode(opts.lowQuality ? 'Performance' : 'Medium');

    this.vmPass = new RenderPass(viewmodel.scene, viewmodel.camera);
    this.vmPass.clearPass.setClearFlags(false, true, false);
    this.vmPass.ignoreBackground = true;

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: POST.bloom,
      luminanceThreshold: POST.bloomThreshold,
      luminanceSmoothing: 0.25,
      radius: POST.bloomRadius,
    });
    this.hueSat = new HueSaturationEffect({ saturation: POST.saturation });
    this.contrast = new BrightnessContrastEffect({ contrast: POST.contrast });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: POST.vignette });
    const tone = (this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    this.aberration = new ChromaticAberrationEffect({
      offset: new Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.25,
    });
    this.noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    this.noise.blendMode.opacity.value = POST.grain;

    this.composer.addPass(this.backdropPass);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.vmPass);
    this.composer.addPass(
      new EffectPass(camera, this.bloom, this.hueSat, this.contrast, this.vignette, tone),
    );
    this.composer.addPass(new EffectPass(camera, this.aberration, this.noise));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  }

  /** 3 = full post, 2 = no AO, 1 = no post (direct render; for machines without a usable GPU). */
  tier: 1 | 2 | 3 = 3;
  private readonly scenes: PipelineScenes;

  setBackdrop(scene: Scene, camera: PerspectiveCamera) {
    this.scenes.backdrop = { scene, camera };
    this.backdropPass.mainScene = scene;
    this.backdropPass.mainCamera = camera;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    const ao = this.ao.configuration;
    ao.intensity = POST.aoIntensity;
    ao.aoRadius = POST.aoRadius;
    ao.distanceFalloff = POST.aoRadius * 0.5;
    this.renderer.toneMappingExposure = POST.exposure;
    this.bloom.intensity = POST.bloom;
    this.bloom.luminanceMaterial.threshold = POST.bloomThreshold;
    this.bloom.mipmapBlurPass.radius = POST.bloomRadius;
    this.hueSat.saturation = POST.saturation - this.damage * 0.45;
    this.contrast.contrast = POST.contrast;
    this.vignette.darkness = POST.vignette + this.damage * 0.25;
    this.noise.blendMode.opacity.value = POST.grain;
    const ca = POST.damageAberration * this.damage;
    this.aberration.offset.set(ca, ca * 0.6);
    const mode = [ToneMappingMode.AGX, ToneMappingMode.ACES_FILMIC, ToneMappingMode.NEUTRAL][POST.toneMapper] ?? ToneMappingMode.ACES_FILMIC;
    if (this.tone.mode !== mode) this.tone.mode = mode;
    if (this.tier === 1) {
      this.renderDirect();
      return;
    }
    this.renderer.toneMapping = NoToneMapping;
    this.ao.enabled = this.tier === 3;
    this.vmPass.enabled = this.showViewmodel;
    this.composer.render(dt);
  }

  /** Low tier: no composer — backdrop, world, viewmodel straight to the canvas, renderer tone mapping. */
  private renderDirect() {
    const r = this.renderer;
    const { backdrop, world, viewmodel } = this.scenes;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = POST.exposure;
    r.setRenderTarget(null);
    r.autoClear = false;
    r.clear();
    r.render(backdrop.scene, backdrop.camera);
    r.clearDepth();
    r.render(world.scene, world.camera);
    if (this.showViewmodel) {
      r.clearDepth();
      r.render(viewmodel.scene, viewmodel.camera);
    }
  }
}
