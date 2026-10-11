<script lang="ts">
  import { engine } from '../engine';
  import Sheet from './Sheet.svelte';
  import { TECHNIQUE_LABELS } from './helpers';
  let { onclose }: { onclose: () => void } = $props();
</script>

<Sheet title="About Cosmic Radio" {onclose}>
  <p class="honest">
    Nothing you hear here is a recording of space. Space has no air to carry sound. Every voice is either an
    <strong>audification</strong> (a real wave of data, such as a gravitational wave, sped up until it is audible) or a
    <strong>sonification</strong> (numbers from real instruments mapped onto notes in one shared key and tempo). Each voice says which it is.
  </p>
  <p>Cosmic Radio is free, makes no account and collects nothing. The music is generated in your browser.</p>
  <h3>Voices and data credits</h3>
  <ul>
    {#each engine.voiceList as v (v.id)}
      <li style="--c: {v.color}">
        <span class="dot" aria-hidden="true"></span>
        <div>
          <strong>{v.name}</strong>
          <span class="tag">{TECHNIQUE_LABELS[v.technique]}</span>
          <p>
            {v.credit.mission} · {v.credit.agency}<br />
            <a href={v.credit.url} target="_blank" rel="noopener noreferrer">{v.credit.dataset}</a>
          </p>
        </div>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .honest { font-family: var(--serif); font-size: 1.05rem; line-height: 1.55; padding: 12px 14px; border-left: 2px solid var(--brass); background: rgba(201, 164, 98, 0.08); border-radius: 0 10px 10px 0; margin-top: 4px; }
  h3 { font-family: var(--mono); font-weight: 500; font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
  li { display: flex; gap: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); margin-top: 7px; flex: none; }
  .tag { font-family: var(--mono); font-size: 0.72rem; margin-left: 8px; color: var(--ink-dim); }
  li p { margin: 2px 0 0; font-size: 0.86rem; color: var(--ink-dim); }
  p { font-size: 0.95rem; }
</style>
