/**
 * Dev-only page: renders every station × mood offline through the real
 * master bus and publishes peak / loudness / NaN results on window.__results.
 * Driven by e2e/run.mjs in headless Chromium.
 */
import { loadSnapshot } from '../src/lib/data/feeds';
import { renderStation } from '../src/lib/engine/render';
import type { DataSnapshot, MoodId } from '../src/lib/engine/types';
import { STATIONS } from '../src/lib/stations';
import { VOICES } from '../src/lib/voices';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? 60);
const out = document.getElementById('out')!;

async function main() {
  const data: Record<string, DataSnapshot> = {};
  for (const v of VOICES) data[v.id] = await loadSnapshot({ ...v, live: false, liveUrl: undefined }, { base: './' });
  const results = [];
  for (const station of STATIONS) {
    for (const mood of ['drift', 'focus', 'sleep'] as MoodId[]) {
      const t0 = performance.now();
      const r = await renderStation(station, VOICES, data, { mood, seconds, sampleRate: 32000 });
      results.push({
        station: station.id,
        mood,
        peakDb: +r.peakDb.toFixed(2),
        rmsDb: +r.rmsDb.toFixed(2),
        nonFinite: r.nonFinite,
        captions: r.captions.length,
        ms: Math.round(performance.now() - t0),
      });
      out.textContent = JSON.stringify(results, null, 1);
    }
  }
  (window as unknown as { __results: unknown }).__results = results;
}

main().catch((e) => {
  (window as unknown as { __results: unknown }).__results = { error: String(e?.stack ?? e) };
});
