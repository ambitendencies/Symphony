<script lang="ts">
  import { engine } from '../engine';
  import type { EngineState, StationConfig } from '../engine/types';
  import Sheet from './Sheet.svelte';
  import Sparkline from './Sparkline.svelte';
  import { formatAgo, ROLE_LABELS, TECHNIQUE_LABELS } from './helpers';

  let { es, station, now, onclose }: { es: EngineState; station: StationConfig | undefined; now: number; onclose: () => void } = $props();
</script>

<Sheet title="What am I hearing?" {onclose}>
  {#if station}
    <p class="lesson"><span class="eyebrow">The idea behind {station.name}</span>{station.lesson}</p>
  {/if}
  {#if es.voices.length === 0}
    <p class="dim">The voices are gathering. This list fills in a moment after the music begins.</p>
  {/if}
  <ul class="voices">
    {#each es.voices as v (v.id)}
      {@const def = engine.voice(v.id)}
      <li class="voice" style="--c: {v.color}">
        <div class="head">
          <span class="dot" aria-hidden="true"></span>
          <h3>{v.name}</h3>
          <span class="role">{ROLE_LABELS[v.role]}</span>
        </div>
        <div class="badges">
          <span class="badge tech">{TECHNIQUE_LABELS[v.technique]}</span>
          {#if v.fallback}
            <span class="badge archival">Archival loop</span>
          {:else}
            <span class="badge live">
              Live{v.source ? ` · ${v.source}` : ''}{v.dataTime ? ` · updated ${formatAgo(now - Date.parse(v.dataTime))}` : ''}
            </span>
          {/if}
        </div>
        {#if def}<p class="phen">{def.phenomenon}</p>{/if}
        {#if v.readout}
          <div class="readout">
            <div class="text">
              <p class="headline">{v.readout.headline}</p>
              {#if v.readout.detail}<p class="detail">{v.readout.detail}</p>{/if}
            </div>
            <Sparkline series={v.readout.series} color={v.color} label="Recent {v.name} data" />
          </div>
        {/if}
        {#if def}
          <div class="cards" role="group" aria-label="About {v.name}" tabindex="-1">
            {#each def.cards as card (card.title)}
              <article class="card">
                <h4>{card.title}</h4>
                <p>{card.body}</p>
              </article>
            {/each}
          </div>
          <p class="credit">
            Data: <a href={def.credit.url} target="_blank" rel="noopener noreferrer">{def.credit.dataset}</a>
            — {def.credit.mission}, {def.credit.agency}
          </p>
        {/if}
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .lesson { font-family: var(--serif); font-size: 1.05rem; line-height: 1.5; margin: 4px 0 16px; padding: 12px 14px; border-left: 2px solid var(--accent); background: hsl(var(--hue) 50% 40% / 0.12); border-radius: 0 10px 10px 0; }
  .eyebrow { display: block; font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 4px; }
  .dim { color: var(--ink-dim); }
  .voices { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .voice { min-width: 0; }
  .voice { border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px 14px; background: rgba(255, 255, 255, 0.025); border-left: 3px solid var(--c); }
  .head { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); flex: none; }
  h3 { margin: 0; font-family: var(--serif); font-weight: 500; font-size: 1.15rem; flex: 1; }
  .role { font-family: var(--mono); font-size: 0.75rem; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.08em; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 6px; }
  .badge { font-family: var(--mono); font-size: 0.72rem; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--ink); }
  .badge.archival { border-style: dashed; border-color: #d9a45a; color: #f0c27d; }
  .badge.live { border-color: #5fc7a0; color: #8fe3c2; }
  .phen { margin: 0 0 8px; color: var(--ink-dim); font-size: 0.9rem; }
  .readout { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin: 6px 0 10px; }
  .headline { margin: 0; font-family: var(--mono); font-size: 0.85rem; line-height: 1.4; }
  .detail { margin: 2px 0 0; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-dim); }
  .cards { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; margin: 0 -4px; padding-inline: 4px; scrollbar-width: thin; }
  .card { flex: 0 0 min(86%, 300px); scroll-snap-align: start; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: rgba(7, 6, 26, 0.5); }
  .card h4 { margin: 0 0 4px; font-family: var(--serif); font-weight: 600; font-size: 0.95rem; color: var(--accent-ink); }
  .card p { margin: 0; font-size: 0.88rem; line-height: 1.5; color: var(--ink); }
  .credit { margin: 8px 0 0; font-size: 0.8rem; color: var(--ink-dim); }
</style>
