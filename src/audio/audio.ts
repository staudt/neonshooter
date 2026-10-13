import { SYNTHS } from './synth';

export type SfxName =
  | 'ar_shot'
  | 'pistol_shot'
  | 'dry_fire'
  | 'reload_out'
  | 'reload_in'
  | 'reload_chamber'
  | 'swap'
  | 'hitmarker'
  | 'headshot'
  | 'kill'
  | 'impact_concrete'
  | 'impact_metal'
  | 'jump'
  | 'land'
  | 'slide'
  | 'footstep'
  | 'mantle'
  | 'melee_swing'
  | 'melee_hit'
  | 'shield_up'
  | 'shield_block'
  | 'shield_break'
  | 'fireball'
  | 'fire_impact'
  | 'demon_growl'
  | 'demon_screech'
  | 'possessed_shriek'
  | 'hound_snarl'
  | 'demon_death'
  | 'gore_splat';

export interface PlayOptions {
  volume?: number;
  /** Playback rate multiplier, default 1. */
  pitch?: number;
  /** -1..1 */
  pan?: number;
}

const MAX_VOICES = 32;
const PITCH_JITTER = 0.04;
const GAIN_JITTER_DB = 1.5;

interface Voice {
  source: AudioBufferSourceNode;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.8;
  private synthBuffers = new Map<SfxName, AudioBuffer>();
  private fileBuffers = new Map<SfxName, AudioBuffer[]>();
  private pendingUrls = new Map<SfxName, string[]>();
  private voices: Voice[] = [];
  private seedCounter = 1;

  /** Create/resume the AudioContext. Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) this.createContext();
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  /** Play a one-shot. Never throws. */
  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const buffer = this.pickBuffer(ctx, name);
      if (!buffer) return;
      const jitter = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
      const gainJitter = 10 ** (((Math.random() * 2 - 1) * GAIN_JITTER_DB) / 20);
      this.startVoice(ctx, master, buffer, {
        rate: (opts.pitch ?? 1) * jitter,
        gain: (opts.volume ?? 1) * gainJitter,
        pan: Math.max(-1, Math.min(1, opts.pan ?? 0)),
      });
    } catch {
      // Audio must never break the game loop.
    }
  }

  /** Replace a synthesized sound with real files (random variant per play). */
  async registerFiles(name: SfxName, urls: string[]): Promise<void> {
    this.pendingUrls.set(name, urls);
    if (!this.ctx) return;
    await this.loadFiles(this.ctx, name, urls);
  }

  /** Render every synth buffer ahead of time, one per idle slice, so the first shot doesn't hitch. */
  prewarm(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const names = (Object.keys(SYNTHS) as SfxName[]).filter((n) => !this.synthBuffers.has(n));
    const idle: (cb: () => void) => void =
      typeof requestIdleCallback === 'function'
        ? (cb) => requestIdleCallback(cb)
        : (cb) => setTimeout(cb, 0);
    const next = () => {
      const name = names.shift();
      if (!name) return;
      this.pickBuffer(ctx, name);
      idle(next);
    };
    idle(next);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  private createContext() {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (!Ctor) return;
    const ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    comp.connect(master).connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.compressor = comp;
    for (const [name, urls] of this.pendingUrls) void this.loadFiles(ctx, name, urls);
  }

  private compressor: DynamicsCompressorNode | null = null;

  /** Synth buffers are rendered lazily on first use, then cached. */
  private pickBuffer(ctx: AudioContext, name: SfxName): AudioBuffer | null {
    const files = this.fileBuffers.get(name);
    if (files && files.length > 0) return files[Math.floor(Math.random() * files.length)];
    let buf = this.synthBuffers.get(name);
    if (!buf) {
      const data = SYNTHS[name](ctx.sampleRate, 1000 + this.seedCounter++);
      buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.synthBuffers.set(name, buf);
    }
    return buf;
  }

  private startVoice(
    ctx: AudioContext,
    _master: GainNode,
    buffer: AudioBuffer,
    p: { rate: number; gain: number; pan: number },
  ) {
    if (this.voices.length >= MAX_VOICES) this.voices.shift()?.source.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = p.rate;
    const gain = ctx.createGain();
    gain.gain.value = p.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = p.pan;
    source
      .connect(gain)
      .connect(panner)
      .connect(this.compressor ?? ctx.destination);
    const voice: Voice = { source };
    source.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    this.voices.push(voice);
    source.start();
  }

  private async loadFiles(ctx: AudioContext, name: SfxName, urls: string[]) {
    const decoded: AudioBuffer[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        decoded.push(await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // Missing file: keep the synth fallback.
      }
    }
    if (decoded.length > 0) this.fileBuffers.set(name, decoded);
  }
}

export const sfx = new Sfx();
