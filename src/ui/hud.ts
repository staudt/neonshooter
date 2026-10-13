export type HitKind = 'hit' | 'head' | 'kill';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SHADOW = 'drop-shadow(0 0 1px rgba(0,0,0,0.9)) drop-shadow(0 0 2px rgba(0,0,0,0.6))';

/** Per-kind hitmarker look: colour, size (px, half-extent of the X), lifetime (ms). */
const HIT_STYLE: Record<HitKind, { color: string; size: number; ms: number }> = {
  hit: { color: '#ffffff', size: 10, ms: 150 },
  head: { color: '#ffd84a', size: 13, ms: 170 },
  kill: { color: '#ff3b3b', size: 17, ms: 300 },
};

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.neon-hud-fade{transition:opacity 80ms linear}
.neon-hud-di{opacity:0;will-change:opacity}
.neon-hud-di.on{animation:neon-hud-di 1s linear forwards}
.neon-hud-pulse{animation:neon-hud-pulse 0.9s ease-in-out infinite}
@keyframes neon-hud-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.neon-hud-key{display:inline-block;min-width:1.5em;padding:0.05em 0.35em;margin-right:0.6em;border:1.5px solid currentColor;
  border-radius:3px;text-align:center;letter-spacing:0;background:rgba(0,0,0,.45)}
@keyframes neon-hud-di{0%{opacity:.95}100%{opacity:0}}
`;
  document.head.appendChild(s);
}

function div(parent: HTMLElement, css: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const d = document.createElement('div');
  Object.assign(d.style, css);
  parent.appendChild(d);
  return d;
}

export class Hud {
  private root: HTMLDivElement;
  private cross: HTMLDivElement;
  private lines: HTMLDivElement[] = [];
  private hitLines: HTMLDivElement[] = [];
  private hitWrap: HTMLDivElement;
  private reloadWrap: HTMLDivElement;
  private reloadFill: HTMLDivElement;
  private shieldWrap: HTMLDivElement;
  private shieldFill: HTMLDivElement;
  private lastShield: string = '';
  private hint: HTMLDivElement;
  private ammoName: HTMLDivElement;
  private ammoMag: HTMLSpanElement;
  private ammoRes: HTMLSpanElement;
  private vignette: HTMLDivElement;
  private dmg: HTMLDivElement;
  private dmgArc: HTMLDivElement;

  // Cached last values so per-frame calls only touch the DOM on change.
  private lastGap = NaN;
  private lastVisible: boolean | null = null;
  private lastMag = NaN;
  private lastMagSize = NaN;
  private lastReserve = NaN;
  private lastName = '';
  private lastReload: number | null = -2;
  private lastHint: string | null = '\0';
  private lastVig = NaN;
  private hitAnims: Animation[] = [];

  constructor(parent: HTMLElement = document.body) {
    injectStyle();
    this.root = div(parent, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '5',
      font: `13px/1.2 ${FONT}`,
      userSelect: 'none',
    });

    this.vignette = div(this.root, {
      position: 'absolute',
      inset: '0',
      opacity: '0',
      background:
        'radial-gradient(ellipse at center, rgba(255,0,0,0) 45%, rgba(255,20,20,0.75) 100%)',
    });

    // Crosshair: 4 lines (top, bottom, left, right) positioned from screen center.
    this.cross = div(this.root, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0',
      height: '0',
    });
    this.cross.className = 'neon-hud-fade';
    for (let i = 0; i < 4; i++) {
      const horiz = i >= 2;
      this.lines.push(
        div(this.cross, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: horiz ? '8px' : '2px',
          height: horiz ? '2px' : '8px',
          background: '#fff',
          filter: SHADOW,
          willChange: 'transform',
        }),
      );
    }

    // Hitmarker: 4 diagonal strokes; a wrapper is animated for scale/opacity.
    this.hitWrap = div(this.root, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0',
      height: '0',
      opacity: '0',
    });
    for (let i = 0; i < 4; i++) {
      const l = div(this.hitWrap, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '7px',
        height: '2px',
        filter: SHADOW,
      });
      this.hitLines.push(l);
    }

    // Shield charge: small cyan bar above the ammo counter's line, under the crosshair.
    this.shieldWrap = div(this.root, {
      position: 'absolute',
      left: '50%',
      top: 'calc(50% + 44px)',
      width: '90px',
      height: '3px',
      marginLeft: '-45px',
      background: 'rgba(120,220,255,0.18)',
      display: 'none',
      filter: SHADOW,
    });
    this.shieldFill = div(this.shieldWrap, {
      width: '100%',
      height: '100%',
      background: '#6fe6ff',
      transformOrigin: 'left center',
    });

    // Reload bar under crosshair.
    this.reloadWrap = div(this.root, {
      position: 'absolute',
      left: '50%',
      top: 'calc(50% + 34px)',
      width: '60px',
      height: '2px',
      marginLeft: '-30px',
      background: 'rgba(255,255,255,0.25)',
      display: 'none',
    });
    this.reloadFill = div(this.reloadWrap, {
      width: '100%',
      height: '100%',
      background: '#c9f6ff',
      transformOrigin: '0 50%',
      transform: 'scaleX(0)',
      boxShadow: '0 0 6px #c9f6ff',
    });

    this.hint = div(this.root, {
      position: 'absolute',
      left: '50%',
      top: 'calc(50% + 56px)',
      transform: 'translateX(-50%)',
      color: '#ff9f1a',
      fontFamily: FONT,
      fontSize: '16px',
      letterSpacing: '0.22em',
      fontWeight: 'bold',
      textShadow: '0 0 8px rgba(255,159,26,0.7), 0 1px 2px #000, 0 0 3px #000',
      display: 'none',
      whiteSpace: 'nowrap',
    });
    this.hint.className = 'neon-hud-pulse';

    // Ammo readout, bottom-right.
    const ammo = div(this.root, {
      position: 'absolute',
      right: '32px',
      bottom: '28px',
      textAlign: 'right',
      color: '#c9f6ff',
      textShadow: '0 0 8px rgba(120,230,255,0.55), 0 1px 2px #000',
    });
    this.ammoName = div(ammo, {
      fontSize: '11px',
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      opacity: '0.75',
    });
    const row = div(ammo, { lineHeight: '1' });
    this.ammoMag = document.createElement('span');
    Object.assign(this.ammoMag.style, { fontSize: '44px', fontWeight: 'bold' });
    this.ammoRes = document.createElement('span');
    Object.assign(this.ammoRes.style, { fontSize: '18px', opacity: '0.8', marginLeft: '6px' });
    row.append(this.ammoMag, this.ammoRes);

    // Damage direction indicator: a rotating wrapper holding an arc segment.
    this.dmg = div(this.root, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0',
      height: '0',
    });
    this.dmgArc = div(this.dmg, {
      position: 'absolute',
      left: '-60px',
      top: '-150px',
      width: '120px',
      height: '28px',
      borderTop: '5px solid #ff3b3b',
      borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
      filter: 'drop-shadow(0 0 6px rgba(255,59,59,0.9))',
    });
    this.dmgArc.className = 'neon-hud-di';

    this.setCrosshair(10, true);
    this.setAmmo(0, 1, 0, '');
  }

  /** Crosshair: 4 short lines around center, `gapPx` = distance from center to each line's inner end. */
  setCrosshair(gapPx: number, visible: boolean): void {
    if (visible !== this.lastVisible) {
      this.lastVisible = visible;
      this.cross.style.opacity = visible ? '1' : '0';
    }
    const gap = Math.round(gapPx * 2) / 2; // half-pixel granularity is plenty
    if (gap === this.lastGap) return;
    this.lastGap = gap;
    const l = this.lines;
    l[0].style.transform = `translate(-1px, ${-gap - 8}px)`;
    l[1].style.transform = `translate(-1px, ${gap}px)`;
    l[2].style.transform = `translate(${-gap - 8}px, -1px)`;
    l[3].style.transform = `translate(${gap}px, -1px)`;
  }

  /** MW-style hitmarker; repeated calls restart the animation. */
  hitmarker(kind: HitKind): void {
    const st = HIT_STYLE[kind];
    const d = st.size;
    // Diagonal strokes: centered at (±d/2, ±d/2) of the X, rotated ±45deg.
    const mid = d * 0.75;
    const dirs: [number, number, number][] = [
      [-1, -1, 45],
      [1, -1, -45],
      [-1, 1, -45],
      [1, 1, 45],
    ];
    for (let i = 0; i < 4; i++) {
      const [sx, sy, rot] = dirs[i];
      const s = this.hitLines[i].style;
      s.background = st.color;
      s.width = `${Math.round(d * 0.7)}px`;
      s.transform = `translate(${sx * mid - d * 0.35}px, ${sy * mid - 1}px) rotate(${rot}deg)`;
    }
    for (const a of this.hitAnims) a.cancel();
    this.hitAnims = [];
    if (typeof this.hitWrap.animate !== 'function') return;
    this.hitAnims.push(
      this.hitWrap.animate(
        [
          { opacity: 1, transform: 'scale(0.6)', offset: 0 },
          { opacity: 1, transform: 'scale(1.25)', offset: 0.25 },
          { opacity: 0, transform: 'scale(1)', offset: 1 },
        ],
        { duration: st.ms, easing: 'ease-out', fill: 'none' },
      ),
    );
  }

  /** Bottom-right ammo readout. */
  setAmmo(mag: number, magSize: number, reserve: number, weaponName: string): void {
    if (mag !== this.lastMag || magSize !== this.lastMagSize) {
      this.lastMag = mag;
      this.lastMagSize = magSize;
      this.ammoMag.textContent = String(mag);
      this.ammoMag.style.color =
        mag <= 0 ? '#ff3b3b' : mag <= magSize * 0.3 ? '#ff9f1a' : '#c9f6ff';
    }
    if (reserve !== this.lastReserve) {
      this.lastReserve = reserve;
      this.ammoRes.textContent = `/ ${reserve}`;
    }
    if (weaponName !== this.lastName) {
      this.lastName = weaponName;
      this.ammoName.textContent = weaponName;
    }
  }

  /** Shield charge 0..1 (null hides); broken = red, pulsing. */
  setShield(fraction: number | null, broken: boolean): void {
    const id = fraction === null ? '' : `${fraction.toFixed(2)}|${broken}`;
    if (id === this.lastShield) return;
    this.lastShield = id;
    this.shieldWrap.style.display = fraction === null ? 'none' : 'block';
    if (fraction === null) return;
    this.shieldFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
    this.shieldFill.style.background = broken ? '#ff3b3b' : fraction < 0.35 ? '#ff9f1a' : '#6fe6ff';
    this.shieldWrap.className = broken ? 'neon-hud-pulse' : '';
  }

  /** Reload progress bar; null hides it. */
  setReload(progress: number | null): void {
    const p = progress === null ? null : Math.min(1, Math.max(0, progress));
    if (p === this.lastReload) return;
    if ((p === null) !== (this.lastReload === null)) {
      this.reloadWrap.style.display = p === null ? 'none' : 'block';
    }
    this.lastReload = p;
    if (p !== null) this.reloadFill.style.transform = `scaleX(${p})`;
  }

  /**
   * Center-low prompt under the crosshair (pulses); null hides it. `key` renders a keycap chip
   * before the text (MW-style "[R] RELOAD"). `danger` = red instead of orange.
   */
  setHint(text: string | null, key?: string, danger = false): void {
    const id = text === null ? null : `${key ?? ''}|${text}|${danger}`;
    if (id === this.lastHint) return;
    this.lastHint = id;
    if (text === null) {
      this.hint.style.display = 'none';
      return;
    }
    this.hint.replaceChildren();
    if (key) {
      const chip = document.createElement('span');
      chip.className = 'neon-hud-key';
      chip.textContent = key;
      this.hint.appendChild(chip);
    }
    this.hint.appendChild(document.createTextNode(text));
    const c = danger ? '#ff3b3b' : '#ff9f1a';
    this.hint.style.color = c;
    this.hint.style.textShadow = `0 0 8px ${c}b3, 0 1px 2px #000, 0 0 3px #000`;
    this.hint.style.display = 'block';
  }

  /** Red arc toward `angleRad` (0 = front, positive = clockwise); fades over 1 s. */
  damageIndicator(angleRad: number): void {
    this.dmg.style.transform = `rotate(${angleRad}rad)`;
    // Restart the CSS animation (remove class, force style flush once, re-add).
    this.dmgArc.classList.remove('on');
    void this.dmgArc.offsetWidth;
    this.dmgArc.classList.add('on');
  }

  /** Full-screen red vignette strength 0..1. */
  setDamageVignette(strength: number): void {
    const v = Math.round(Math.min(1, Math.max(0, strength)) * 100) / 100;
    if (v === this.lastVig) return;
    this.lastVig = v;
    this.vignette.style.opacity = String(v);
  }
}
