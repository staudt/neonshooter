let el: HTMLDivElement | null = null;
let timer = 0;

/** Brief centered-bottom message (map reloads, errors). Errors stay until replaced. */
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  if (!el) {
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      font: '12px/1.4 ui-monospace, monospace',
      whiteSpace: 'pre-wrap',
      maxWidth: '80vw',
      pointerEvents: 'none',
      zIndex: '20',
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = kind === 'error' ? '#ffd0d0' : '#c9f6ff';
  el.style.background = kind === 'error' ? 'rgba(120,0,20,0.85)' : 'rgba(0,30,40,0.75)';
  clearTimeout(timer);
  if (kind === 'info') timer = window.setTimeout(() => el && (el.style.display = 'none'), 1800);
}
