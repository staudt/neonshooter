import { describe, expect, it } from 'vitest';
import { ScriptedInput, type ScriptStep } from '../src/core/input';
import { LOADOUT, MELEE, SHIELD } from '../src/weapons/defs';
import { WeaponSystem, type WeaponContext } from '../src/weapons/weapon';

const DT = 1 / 120;
const CTX: WeaponContext = { sprint: 0, grounded: true, mantling: false, moveFactor: 0 };

/** Fresh system, already past the initial swap-in. */
function ready(slot = 0) {
  const ws = new WeaponSystem(LOADOUT, 3);
  ws.current = slot;
  ws.phase = 'ready';
  return ws;
}

/** Step with a script; `each` sees every step after it ran (t = time since start). */
function run(ws: WeaponSystem, script: ScriptStep[], seconds: number, each?: (t: number) => void) {
  const input = new ScriptedInput(script);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    input.advance(DT);
    ws.step(DT, input.sample(), CTX);
    each?.((i + 1) * DT);
  }
}

describe('melee', () => {
  it('rifle bash strikes once at hitAt, then the gun is ready again', () => {
    const ws = ready(0);
    const strikes: number[] = [];
    run(ws, [{ t: 0, down: ['melee'] }, { t: 0.05 }], 1, (t) => {
      if (ws.events.meleeStrike) strikes.push(t);
    });
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toBeCloseTo(MELEE.bashTime * MELEE.bashHitAt, 1);
    expect(ws.phase).toBe('ready');
  });

  it('the pistol knife is faster than the rifle bash', () => {
    const ws = ready(1);
    expect(ws.melee.kind).toBe('knife');
    let strikeAt = -1;
    run(ws, [{ t: 0, down: ['melee'] }, { t: 0.05 }], 0.6, (t) => {
      if (ws.events.meleeStrike && strikeAt < 0) strikeAt = t;
    });
    expect(strikeAt).toBeGreaterThan(0);
    expect(strikeAt).toBeLessThan(MELEE.bashTime * MELEE.bashHitAt);
    expect(MELEE.knifeTime).toBeLessThan(MELEE.bashTime);
  });

  it('cancels a reload that has not added ammo (it must be restarted)', () => {
    const ws = ready(0);
    ws.slot.mag = 5;
    run(
      ws,
      [{ t: 0, down: ['reload'] }, { t: 0.05 }, { t: 0.3, down: ['melee'] }, { t: 0.35 }],
      1.5,
    );
    expect(ws.slot.mag).toBe(5);
    expect(ws.phase).toBe('ready');
  });

  it('no firing during the swing', () => {
    const ws = ready(0);
    let shotsInMelee = 0;
    run(
      ws,
      [
        { t: 0, down: ['melee'] },
        { t: 0.02, down: ['fire'] },
      ],
      MELEE.bashTime * 0.9,
      () => {
        if (ws.phase === 'melee') shotsInMelee += ws.events.shots.length;
      },
    );
    expect(shotsInMelee).toBe(0);
  });
});

describe('shield', () => {
  it('raises over raiseTime and then blocks; firing and ADS are off while up', () => {
    const ws = ready(0);
    let shots = 0;
    run(
      ws,
      [{ t: 0, down: ['shield', 'fire', 'ads'] }],
      0.6,
      () => (shots += ws.events.shots.length),
    );
    expect(ws.shieldRaise).toBe(1);
    expect(ws.shieldBlocking).toBe(true);
    expect(ws.ads).toBe(0);
    expect(shots).toBe(0);
  });

  it('pulling the shield cuts a reload short, and you cannot reload behind it', () => {
    const ws = ready(0);
    ws.slot.mag = 4;
    run(
      ws,
      [
        { t: 0, down: ['reload'] },
        { t: 0.05 },
        { t: 0.3, down: ['shield'] },
        { t: 0.5, down: ['shield', 'reload'] },
        { t: 0.55, down: ['shield'] },
      ],
      2.5,
    );
    expect(ws.slot.mag).toBe(4);
    expect(ws.phase).toBe('ready');
  });

  it('coming down costs a beat before the first shot', () => {
    const ws = ready(0);
    let firstShot = -1;
    run(
      ws,
      [
        { t: 0, down: ['shield'] },
        { t: 0.5, down: ['fire'] },
      ],
      1.5,
      (t) => {
        if (firstShot < 0 && ws.events.shots.length) firstShot = t;
      },
    );
    expect(firstShot - 0.5).toBeGreaterThanOrEqual(SHIELD.lowerTime + SHIELD.recoverTime - 0.02);
  });

  it('absorbs damage, breaks when drained (cooldown), regenerates after a pause', () => {
    const ws = ready(0);
    run(ws, [{ t: 0, down: ['shield'] }], 0.4);
    expect(ws.absorb(40)).toBe(0);
    expect(ws.shieldHp).toBe(SHIELD.hp - 40);
    const through = ws.absorb(SHIELD.hp);
    expect(through).toBeCloseTo(40);
    expect(ws.shieldBrokenT).toBeGreaterThan(0);
    expect(ws.shieldBlocking).toBe(false);
    // can't re-raise while broken
    run(ws, [{ t: 0, down: ['shield'] }], 1);
    expect(ws.shieldRaise).toBe(0);
    // after the cooldown it comes back (half charged) and regenerates
    run(ws, [{ t: 0 }], SHIELD.brokenCooldown + SHIELD.regenDelay + 1);
    expect(ws.shieldBrokenT).toBe(0);
    expect(ws.shieldHp).toBeGreaterThan(SHIELD.hp * 0.5);
  });

  it('a lowered shield does not absorb', () => {
    const ws = ready(0);
    expect(ws.absorb(25)).toBe(25);
  });
});

describe('weapon keys', () => {
  it('changing your mind mid swap-out goes straight to the newly pressed weapon', () => {
    const ws = ready(0);
    run(ws, [{ t: 0, down: ['weapon2'] }, { t: 0.05 }, { t: 0.08, down: ['weapon1'] }, { t: 0.1 }], 1);
    expect(ws.current).toBe(0);
    expect(ws.phase).toBe('ready');
  });
});
