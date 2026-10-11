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
    <h3 id="mood-h">Mood</h3>
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
    <h3 id="sleep-h">Sleep timer</h3>
    <div class="seg" role="group" aria-label="Sleep timer in minutes">
      {#each timers as t (t)}
        <button aria-pressed={active === t} onclick={() => setTimer(t)}>{t}<span class="u"> min</span></button>
      {/each}
    </div>
    {#if remaining !== null}
      <p class="desc" role="status">
        Drifting to silence in <strong class="mono">{formatRemaining(remaining)}</strong>. Voices thin out over the last five minutes.
        <button class="link" onclick={() => setTimer(null)}>Cancel timer</button>
      </p>
    {:else}
      <p class="desc">Voices gently drop out over the last five minutes, then the sound fades to nothing.</p>
    {/if}
  </section>

  <section aria-labelledby="vol-h">
    <h3 id="vol-h">Volume</h3>
    <label class="vol">
      <span class="sr-only">Volume</span>
      <input
        type="range" min="0" max="1" step="0.01" value={es.volume}
        aria-label="Master volume, capped at a safe listening ceiling"
        aria-valuetext="{Math.round(es.volume * 100)} percent"
        oninput={(e) => engine.setVolume(+e.currentTarget.value)}
      />
      <output class="mono">{Math.round(es.volume * 100)}%</output>
    </label>
    <p class="desc">Even at the far right this stays under a safe listening ceiling, so it will never surprise you.</p>
  </section>
</Sheet>

<style>
  section { margin: 6px 0 18px; }
  h3 { margin: 0 0 8px; font-family: var(--mono); font-weight: 500; font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); }
  .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
  .seg button { min-height: 48px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.04); font-family: var(--serif); font-size: 1.02rem; }
  .seg button[aria-pressed='true'] { background: hsl(var(--hue) 70% 58% / 0.9); color: #0a0820; border-color: var(--accent); font-weight: 600; }
  .u { font-family: var(--sans); font-size: 0.75rem; }
  .desc { margin: 8px 0 0; color: var(--ink-dim); font-size: 0.9rem; }
  .mono { font-family: var(--mono); color: var(--ink); }
  .link { background: none; border: 0; padding: 12px 4px; color: var(--accent-ink); text-decoration: underline; }
  .vol { display: flex; align-items: center; gap: 12px; }
  .vol input { flex: 1; min-height: 44px; accent-color: var(--accent); }
  .vol output { width: 3.2em; text-align: right; }
</style>
