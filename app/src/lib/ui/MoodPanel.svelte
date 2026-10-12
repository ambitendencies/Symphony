<script lang="ts">
  import { engine } from '../engine';
  import { MOODS } from '../engine/theory';
  import type { EngineState, MoodId } from '../engine/types';
  import Sheet from './Sheet.svelte';
  import { formatRemaining } from './helpers';

  let { es, now, onclose }: { es: EngineState; now: number; onclose: () => void } = $props();
  const moods: MoodId[] = ['drift', 'focus', 'sleep'];
  const timers = [15, 30, 60, 90];
  let chosen = $state<number | null>(null);
  const remaining = $derived(es.sleepEndsAt ? es.sleepEndsAt - now : null);
  const active = $derived(es.sleepEndsAt === null ? null : chosen);

  function setTimer(m: number | null) {
    chosen = m;
    engine.setSleepTimer(m);
  }
</script>

<Sheet title="Mood, timer and volume" {onclose}>
  <section aria-labelledby="mood-h">
    <h3 id="mood-h" class="label">Mood</h3>
    <div class="seg" role="group" aria-label="Mood">
      {#each moods as m (m)}
        <button aria-pressed={es.mood === m} onclick={() => engine.setMood(m)}>
          <span class="l">{MOODS[m].label}</span>
        </button>
      {/each}
    </div>
    <p class="desc">{MOODS[es.mood].description}</p>
  </section>

  <section aria-labelledby="sleep-h">
    <h3 id="sleep-h" class="label">Sleep timer</h3>
    <div class="seg" role="group" aria-label="Sleep timer in minutes">
      {#each timers as t (t)}
        <button aria-pressed={active === t} onclick={() => setTimer(t)}>{t}<span class="u"> min</span></button>
      {/each}
    </div>
    {#if remaining !== null}
      <p class="desc" role="status">
        Drifting to silence in <strong class="num">{formatRemaining(remaining)}</strong>. Voices thin out over the last five minutes.
        <button class="link" onclick={() => setTimer(null)}>Cancel timer</button>
      </p>
    {:else}
      <p class="desc">Voices gently drop out over the last five minutes, then the sound fades to nothing.</p>
    {/if}
  </section>

  <section aria-labelledby="vol-h">
    <h3 id="vol-h" class="label">Volume</h3>
    <label class="vol">
      <span class="sr-only">Volume</span>
      <input
        type="range" min="0" max="1" step="0.01" value={es.volume}
        aria-label="Master volume, capped at a safe listening ceiling"
        aria-valuetext="{Math.round(es.volume * 100)} percent"
        oninput={(e) => engine.setVolume(+e.currentTarget.value)}
      />
      <output class="num">{Math.round(es.volume * 100)}%</output>
    </label>
    <p class="desc">Even at the far right this stays under a safe listening ceiling, so it will never surprise you.</p>
  </section>
</Sheet>

<style>
  section { padding: 14px 0 20px; border-top: 1px solid var(--line); }
  section:first-child { border-top: 0; padding-top: 4px; }
  h3 { margin: 0 0 10px; }
  .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--surface); }
  .seg button {
    min-height: 46px; border: 0; border-radius: var(--r-sm); background: none; color: var(--ink-dim);
    font-family: var(--serif); font-size: 1.04rem; font-weight: 500;
    transition: background var(--t-fast) ease, color var(--t-fast) ease, transform var(--t-fast) var(--ease-spring);
  }
  .seg button:hover { color: var(--ink); background: var(--surface-2); }
  .seg button:active { transform: scale(0.97); }
  .seg button[aria-pressed='true'] { background: var(--accent); color: var(--on-accent); box-shadow: 0 4px 16px hsl(var(--hue) 60% 30% / 0.35); }
  .u { margin-left: 0.2em; font-family: var(--sans); font-size: 0.76rem; }
  .desc { margin: 10px 0 0; max-width: 48ch; color: var(--ink-dim); font-size: 0.9rem; }
  .num { color: var(--ink); font-weight: 500; }
  .link { background: none; border: 0; padding: 12px 4px; color: var(--accent-ink); text-decoration: underline; text-underline-offset: 3px; transition: color var(--t-fast) ease; }
  .link:hover { color: var(--ink); }
  .vol { display: flex; align-items: center; gap: 14px; }
  .vol input { -webkit-appearance: none; appearance: none; flex: 1; min-height: 44px; background: transparent; cursor: pointer; }
  .vol input::-webkit-slider-runnable-track { height: 3px; border-radius: 3px; background: linear-gradient(90deg, var(--accent), var(--line-strong)); }
  .vol input::-moz-range-track { height: 3px; border-radius: 3px; background: var(--line-strong); }
  .vol input::-moz-range-progress { height: 3px; background: var(--accent); }
  .vol input::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -8.5px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 4px hsl(222 24% 5% / 0.8), 0 0 14px var(--accent-glow); }
  .vol input::-moz-range-thumb { width: 20px; height: 20px; border: 0; border-radius: 50%; background: var(--ink); }
  .vol output { width: 3.4em; text-align: right; }
</style>
