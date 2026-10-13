// Headless smoke test: boots the game with ?test=smoke on each run's map, plays the scripted
// input, and fails on console errors, page errors, stalls or any false `checks` in the game's
// report. Saves screenshots (first-person moments + a fixed overview) for inspection.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const TIMEOUT_MS = 90_000;
const MIN_FRAMES = 20;
const dir = process.env.SMOKE_DIR ?? 'test-results';

/** Each run: map (null = default test course), mid-run screenshots [script time, name], overview name. */
const RUNS = [
  { map: 'test_course', shots: [[2.75, 'smoke-fp'], [3.55, 'smoke-reload']], overview: 'smoke' },
  { map: 'arena_test', shots: [[4.6, 'smoke-arena-fp']], overview: 'smoke-arena' },
  { map: 'stage1', shots: [[3.0, 'smoke-stage1-fp']], overview: 'smoke-stage1' },
  { map: 'station_slice', shots: [[2.2, 'smoke-station-tunnel'], [3.6, 'smoke-station-fp'], [5.4, 'smoke-station-shield'], [6.62, 'smoke-station-knife']], overview: 'smoke-station' },
];
const only = process.env.SMOKE_MAP;

mkdirSync(dir, { recursive: true });
const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];

try {
  for (const run of RUNS) {
    if (only && (run.map ?? 'test_course') !== only) continue;
    const label = run.map ?? 'test_course';
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${server.resolvedUrls.local[0]}?test=smoke${run.map ? `&map=${run.map}` : ''}`);
    for (const [t, name] of run.shots) {
      await page
        .waitForFunction((tt) => (window.__smoke?.t ?? 0) > tt, t, { timeout: TIMEOUT_MS })
        .then(() => page.screenshot({ path: `${dir}/${name}.png` }))
        .catch(() => errors.push(`timeout waiting for screenshot point ${name}`));
    }
    await page
      .waitForFunction(() => window.__smoke?.done === true, null, { timeout: TIMEOUT_MS })
      .catch(() => errors.push(`timeout: scripted run did not finish in ${TIMEOUT_MS}ms`));
    await page.waitForTimeout(150); // let the overview camera take over
    const result = await page.evaluate(() => window.__smoke ?? null);
    await page.screenshot({ path: `${dir}/${run.overview}.png` });
    await page.close();

    if (!result) errors.push('no __smoke report (game never rendered?)');
    else if (result.frames < MIN_FRAMES) errors.push(`only ${result.frames} frames rendered`);
    if (result?.checks)
      for (const [name, ok] of Object.entries(result.checks)) if (!ok) errors.push(`check failed: ${name}`);
    console.log(`smoke[${label}]: ${JSON.stringify(result)}`);
    if (errors.length) failures.push(`[${label}]\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`SMOKE FAILED\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`smoke: ok  (screenshots in ${dir}/)`);
