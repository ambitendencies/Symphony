/**
 * End-to-end checks in headless Chromium:
 *  1. audio safety — every station × mood rendered offline: peak ≤ −1 dBFS,
 *     no NaNs, loudness within a ±3 dB band across stations (PRD gate 1);
 *  2. page smoke — loads with no console errors at desktop and phone widths,
 *     and starts audio on the first tap (gate 3).
 * Usage: npm run e2e [-- --seconds 60 --skip-audio --screens <dir>]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const seconds = Number(opt('seconds', 45));
const skipAudio = args.includes('--skip-audio');
const screens = opt('screens', null);
const PORT = 5199;

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), resolve()));
});

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL', msg);
};

try {
  if (!skipAudio) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => fail(`audio-check page error: ${e.message}`));
    await page.goto(`http://localhost:${PORT}/audio-check.html?seconds=${seconds}`);
    await page.waitForFunction(() => window.__results, null, { timeout: 15 * 60_000 });
    const results = await page.evaluate(() => window.__results);
    if (results.error) fail(results.error);
    else {
      console.table(results);
      for (const r of results) {
        if (r.nonFinite) fail(`${r.station}/${r.mood}: ${r.nonFinite} non-finite samples`);
        if (r.peakDb > -0.99) fail(`${r.station}/${r.mood}: peak ${r.peakDb} dBFS above −1 dBFS ceiling`);
        if (r.rmsDb < -40) fail(`${r.station}/${r.mood}: nearly silent (${r.rmsDb} dB)`);
      }
      const levels = results.map((r) => r.rmsDb).sort((a, b) => a - b);
      const median = levels[Math.floor(levels.length / 2)];
      for (const r of results)
        if (Math.abs(r.rmsDb - median) > 3)
          fail(`${r.station}/${r.mood}: loudness ${r.rmsDb} dB is >3 dB from the median ${median} dB (tuning would jump)`);
    }
    await page.close();
  }

  for (const [w, h, name] of [[1280, 800, 'desktop'], [390, 844, 'mobile']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(800);
    if (screens) await page.screenshot({ path: `${screens}/arrival-${name}.png` });
    const begin = page.getByRole('button', { name: /begin listening/i });
    await begin.click();
    await page.waitForTimeout(4000);
    const audio = await page.evaluate(() => window.__engine?.audioContext?.state ?? 'no engine handle');
    if (audio !== 'running') fail(`${name}: audio context is ${audio} after tapping Begin`);
    if (screens) await page.screenshot({ path: `${screens}/receiver-${name}.png` });
    if (errors.length) fail(`${name}: console errors:\n  ${errors.join('\n  ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'E2E FAILED' : 'E2E PASSED');
process.exit(failed ? 1 : 0);
