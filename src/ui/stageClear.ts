/**
 * Stage-clear screen: time + run stats, replay / menu. Releases the mouse so the buttons work.
 */
export interface StageResult {
  title: string;
  seconds: number;
  kills: number;
  deaths: number;
  shots: number;
  hits: number;
  blocked: number;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function showStageClear(r: StageResult) {
  document.exitPointerLock?.();
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    background: 'radial-gradient(ellipse at center, rgba(40,4,2,0.75) 0%, rgba(0,0,0,0.92) 70%)',
    color: '#ffe9e2',
    font: '600 14px/1.6 ui-monospace, monospace',
    letterSpacing: '0.18em',
    zIndex: '40',
    textAlign: 'center',
  });
  const acc = r.shots > 0 ? Math.round((100 * r.hits) / r.shots) : 0;
  const row = (k: string, v: string) =>
    `<div style="display:flex;gap:28px;justify-content:space-between;min-width:280px"><span style="opacity:.6">${k}</span><span>${v}</span></div>`;
  el.innerHTML = `
    <div style="font-size:13px;opacity:.7">${r.title}</div>
    <div style="font-size:44px;letter-spacing:.45em;color:#ff4a26;text-shadow:0 0 22px #ff2a0c">STAGE CLEAR</div>
    <div style="font-size:30px;margin-bottom:8px">${fmtTime(r.seconds)}</div>
    ${row('KILLS', String(r.kills))}
    ${row('ACCURACY', `${acc}%`)}
    ${row('DEATHS', String(r.deaths))}
    ${row('HITS BLOCKED', String(r.blocked))}
    <div style="display:flex;gap:14px;margin-top:18px">
      <a data-act="again" style="cursor:pointer;border:1px solid #ff4a2688;padding:6px 14px">PLAY AGAIN</a>
      <a data-act="menu" style="cursor:pointer;border:1px solid #ffffff44;padding:6px 14px">MENU</a>
    </div>`;
  el.querySelector('[data-act="again"]')!.addEventListener('click', () => location.reload());
  el.querySelector('[data-act="menu"]')!.addEventListener('click', () => {
    location.href = location.pathname;
  });
  document.body.appendChild(el);
}
