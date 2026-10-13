// Look stills: boots each vantage with ?shot=x,y,z,yawDeg,pitchDeg (free camera, no HUD) at full
// resolution and saves test-results/look-<name>.png. For judging the look pass; `npm run smoke`
// stays the correctness check. Run: npm run shots   (SHOT=<name> for one; SHOT_MAP=<map> for a map)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const dir = process.env.SMOKE_DIR ?? 'test-results';
// yaw: 0 = facing -Z, +90 = facing -X (turned left), -90 = facing +X. pitch: + = up.
const VANTAGES = [
  { map: 'station_slice', name: 'station-platform', pose: [-1, 1.7, -18, -18, 2] },
  { map: 'station_slice', name: 'station-void', pose: [11.4, 1.7, -36, -90, 6] },
  { map: 'station_slice', name: 'station-up', pose: [7, 0.2, -52, -70, 32] },
  { map: 'station_slice', name: 'station-mezz', pose: [-13, 6.2, -58, -117, -10] },
  { map: 'station_slice', name: 'station-tunnel', pose: [0, 1.7, -2, 0, 0] },
  // player parked in the encounter trigger: wave 0 (flying demons) comes at the camera
  { map: 'station_slice', name: 'station-demons', pose: [0.5, 1.7, -20, -12, 12], enc: [0, 0.01, -19], wait: 34 },
  // portrait: camera tracks the nearest enemy from 3.2 m
  { map: 'station_slice', name: 'demon-portrait', pose: [0, 1.7, -20, 0, 0], enc: [0, 0.01, -19], track: 3.2, wait: 30 },
];
const only = process.env.SHOT;
// TUNE='{"look: post":{"toneMapper":2}}' applies tunable overrides; SUFFIX names the variant.
const tune = process.env.TUNE;
const suffix = process.env.SUFFIX ?? '';
const onlyMap = process.env.SHOT_MAP;

mkdirSync(dir, { recursive: true });
const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = false;
try {
  for (const v of VANTAGES) {
    if ((only && v.name !== only) || (onlyMap && v.map !== onlyMap)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    if (tune) await page.addInitScript((t) => localStorage.setItem('neon.tuning', t), tune);
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const enc = (v.enc ? `&enc=${v.enc.join(',')}` : '') + (v.track ? `&track=${v.track}` : '');
    await page.goto(`${server.resolvedUrls.local[0]}?map=${v.map}&shot=${v.pose.join(',')}${enc}`);
    await page.addStyleTag({ content: 'body > :not(canvas) { display: none !important; }' });
    await page
      .waitForFunction((n) => (window.__shot?.frames ?? 0) > n, v.wait ?? 6, { timeout: 180_000 })
      .catch(() => errors.push('timeout'));
    await page.screenshot({ path: `${dir}/look-${v.name}${suffix}.png`, timeout: 120_000 });
    await page.close();
    console.log(`look-${v.name}${suffix}.png${errors.length ? `  ERRORS: ${errors.join(' | ')}` : ''}`);
    if (errors.length) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
