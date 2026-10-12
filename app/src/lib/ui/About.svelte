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
  <h3 class="label">Voices and data credits</h3>
  <ul>
    {#each engine.voiceList as v (v.id)}
      <li style="--c-raw: {v.color}">
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
  <p class="legal" id="privacy">
    Privacy: no accounts, no cookies, no tracking. Your saved blends stay in this browser.
    Data is public open data from NASA, NOAA, ESA, LIGO–Virgo–KAGRA and the ATNF, credited above.
    <a href="https://github.com/ambitendencies/Symphony" target="_blank" rel="noopener noreferrer">Source code</a>
  </p>
</Sheet>

<style>
  .honest { margin: 4px 0 18px; max-width: 36ch; font-family: var(--serif); font-size: 1.2rem; line-height: 1.42; letter-spacing: -0.01em; }
  .honest strong { font-weight: 600; color: var(--accent-ink); }
  p { font-size: 0.94rem; color: var(--ink-dim); max-width: 52ch; }
  h3 { margin: 26px 0 6px; padding-top: 18px; border-top: 1px solid var(--line); }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 16px; }
  li { --c: color-mix(in oklab, var(--c-raw, var(--accent)) 78%, var(--ink-dim)); display: flex; gap: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; transform: rotate(45deg); background: var(--c); box-shadow: 0 0 10px var(--c); margin-top: 8px; flex: none; }
  li strong { font-family: var(--serif); font-weight: 560; font-size: 1.05rem; color: var(--ink); }
  .tag { margin-left: 8px; font-size: 0.72rem; font-weight: 500; padding: 2px 6px; border-radius: var(--r-xs); background: var(--surface-2); color: var(--ink-dim); }
  li p { margin: 3px 0 0; font-size: 0.86rem; }
  .legal { margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 0.82rem; color: var(--ink-faint); }
</style>
