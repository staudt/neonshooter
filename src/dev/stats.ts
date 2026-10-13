/** Tiny text overlay: FPS plus arbitrary debug lines set from anywhere via `debug()`. */
const lines = new Map<string, string>();
let el: HTMLDivElement | null = null;
let frames = 0;
let acc = 0;
let fps = 0;
let worstMs = 0;

export function debug(key: string, value: unknown) {
  lines.set(key, typeof value === 'number' ? value.toFixed(2) : String(value));
}

export function mountStats() {
  el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    font: '11px/1.4 ui-monospace, monospace',
    color: '#9fe8ff',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    textShadow: '0 0 4px #000',
    zIndex: '10',
  });
  document.body.appendChild(el);
}

export function getFps() {
  return fps;
}

export function statsFrame(frameDt: number) {
  frames++;
  acc += frameDt;
  worstMs = Math.max(worstMs, frameDt * 1000);
  if (acc >= 0.5) {
    fps = frames / acc;
    if (el) {
      let text = `${fps.toFixed(0)} fps  worst ${worstMs.toFixed(1)}ms`;
      for (const [k, v] of lines) text += `\n${k}: ${v}`;
      el.textContent = text;
    }
    frames = 0;
    acc = 0;
    worstMs = 0;
  }
}
