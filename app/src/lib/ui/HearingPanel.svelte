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
    <figure class="lesson">
      <figcaption class="label">The idea behind {station.name}</figcaption>
      <blockquote>{station.lesson}</blockquote>
    </figure>
  {/if}

  {#if es.voices.length === 0}
    <!-- Skeleton in the shape of a voice entry while the ensemble gathers. -->
    <div class="voices" aria-busy="true" aria-label="Loading voices">
      {#each [0, 1, 2] as i (i)}
        <div class="voice ghost">
          <div class="skeleton sk-title"></div>
          <div class="skeleton sk-line"></div>
          <div class="skeleton sk-line long"></div>
        </div>
      {/each}
      <p class="dim">The voices join a moment after the music begins.</p>
    </div>
  {/if}

  <ul class="voices">
    {#each es.voices as v (v.id)}
      {@const def = engine.voice(v.id)}
      <li class="voice" style="--c-raw: {v.color}">
        <div class="head">
          <span class="dot" aria-hidden="true"></span>
          <h3>{v.name}</h3>
          <span class="label role">{ROLE_LABELS[v.role]}</span>
        </div>
        <p class="tags">
          <span class="tag">{TECHNIQUE_LABELS[v.technique]}</span>
          {#if v.fallback}
            <span class="tag archival">Archival loop</span>
          {:else}
            <span class="tag live">
              Live{v.source ? ` · ${v.source}` : ''}{v.dataTime ? ` · ${formatAgo(now - Date.parse(v.dataTime))}` : ''}
            </span>
          {/if}
        </p>
        {#if def}<p class="phen">{def.phenomenon}</p>{/if}
        {#if v.readout}
          <div class="readout">
            <div>
              <p class="headline num">{v.readout.headline}</p>
              {#if v.readout.detail}<p class="detail num">{v.readout.detail}</p>{/if}
            </div>
            <Sparkline series={v.readout.series} color={v.color} label="Recent {v.name} data" />
          </div>
        {/if}
        {#if def}
          <div class="cards" role="group" aria-label="About {v.name}" tabindex="-1">
            {#each def.cards as card, i (card.title)}
              <article class="card">
                <h4><span class="num idx">{i + 1}</span>{card.title}</h4>
                <p>{card.body}</p>
              </article>
            {/each}
          </div>
          <p class="credit">
            Data from <a href={def.credit.url} target="_blank" rel="noopener noreferrer">{def.credit.dataset}</a>,
            {def.credit.mission} · {def.credit.agency}
          </p>
        {/if}
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .lesson { margin: 4px 0 26px; }
  .lesson figcaption { margin-bottom: 8px; color: var(--accent-ink); }
  .lesson blockquote { margin: 0; max-width: 34ch; font-family: var(--serif); font-weight: 400; font-size: 1.28rem; line-height: 1.38; letter-spacing: -0.01em; }

  .voices { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
  .voice { --c: color-mix(in oklab, var(--c-raw, var(--accent)) 78%, var(--ink-dim)); min-width: 0; padding: 20px 0 22px; border-top: 1px solid var(--line); }
  .voice.ghost { padding: 20px 0; }
  .sk-title { width: 42%; height: 20px; }
  .sk-line { width: 64%; height: 12px; margin-top: 12px; }
  .sk-line.long { width: 88%; margin-top: 8px; }
  .head { display: flex; align-items: center; gap: 10px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; background: var(--c); box-shadow: 0 0 10px var(--c); flex: none; transform: rotate(45deg); }
  h3 { margin: 0; font-family: var(--serif); font-weight: 560; font-size: 1.22rem; letter-spacing: -0.015em; flex: 1; }
  .role { color: var(--ink-faint); }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 8px; }
  .tag { font-size: 0.74rem; font-weight: 500; padding: 3px 7px; border-radius: var(--r-xs); background: var(--surface-2); color: var(--ink-dim); }
  .tag.archival { background: none; box-shadow: inset 0 0 0 1px var(--line-strong); }
  .tag.live { background: var(--accent-wash); color: var(--accent-ink); }
  .phen { margin: 0 0 10px; color: var(--ink-dim); font-size: 0.93rem; }
  .readout { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin: 0 0 14px; padding: 12px 14px; border-radius: var(--r-sm); background: var(--surface); }
  .headline { margin: 0; font-size: 0.86rem; line-height: 1.45; color: var(--ink); }
  .detail { margin: 3px 0 0; font-size: 0.78rem; color: var(--ink-dim); }
  .cards { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; scrollbar-width: thin; }
  .card { flex: 0 0 min(84%, 290px); scroll-snap-align: start; padding: 14px 16px 16px; border-radius: var(--r-md); background: var(--surface-2); }
  .card h4 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 6px; font-family: var(--serif); font-weight: 560; font-size: 1rem; letter-spacing: -0.01em; }
  .idx { font-size: 0.72rem; color: var(--ink-faint); }
  .card p { margin: 0; font-size: 0.88rem; line-height: 1.55; color: var(--ink-dim); }
  .credit { margin: 12px 0 0; font-size: 0.8rem; color: var(--ink-faint); max-width: 60ch; }
  .dim { color: var(--ink-dim); font-size: 0.9rem; margin: 8px 0 0; }
</style>
