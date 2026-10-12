<script lang="ts">
  import { engine } from '../engine';
  import type { EngineState, MoodId, VoiceMix } from '../engine/types';
  import { ROLES } from '../engine/types';
  import Sheet from './Sheet.svelte';
  import { loadBlends, ROLE_LABELS, storeBlends, type SavedBlend } from './helpers';

  let { es, onclose, onnotice }: { es: EngineState; onclose: () => void; onnotice: (msg: string) => void } = $props();

  const grouped = $derived(
    ROLES.map((role) => ({ role, voices: es.voices.filter((v) => v.role === role) })).filter((g) => g.voices.length),
  );
  let saved = $state<SavedBlend[]>(loadBlends());

  function mix(id: string, patch: Partial<VoiceMix>) {
    engine.setVoiceMix(id, patch);
  }

  function saveBlend() {
    const st = engine.station();
    if (!st) return;
    const blend = { ...engine.blend() };
    // Record the full mix on screen, so the personal station reproduces exactly what you hear.
    for (const v of es.voices) blend[v.id] = { ...v.mix };
    const entry: SavedBlend = {
      id: `my-${Date.now().toString(36)}`,
      name: `${st.name} · my blend ${saved.length + 1}`,
      station: st.id,
      mood: es.mood,
      mix: blend,
    };
    const next = [...saved, entry].slice(-12);
    if (storeBlends(next)) {
      saved = next;
      onnotice('Saved as a personal station');
    } else onnotice('Could not save here (storage unavailable)');
  }
  async function loadBlend(b: SavedBlend) {
    engine.setBlend(b.station, b.mix);
    await engine.tune(b.station, b.mood as MoodId);
    onnotice(`Tuned to ${b.name}`);
  }
  function removeBlend(b: SavedBlend) {
    saved = saved.filter((x) => x.id !== b.id);
    storeBlends(saved);
  }
</script>

<Sheet title="Orchestra" {onclose}>
  <p class="intro">Every voice in the piece is a ring around the dial. Mute, solo or rebalance them; the music adapts.</p>
  {#each grouped as g (g.role)}
    <section class="group" aria-label={ROLE_LABELS[g.role]}>
      <h3 class="label">{ROLE_LABELS[g.role]}</h3>
      {#each g.voices as v (v.id)}
        <div class="row" style="--c-raw: {v.color}">
          <span class="dot" aria-hidden="true"></span>
          <span class="name">{v.name}</span>
          <button class="tog" aria-pressed={v.mix.muted} onclick={() => mix(v.id, { muted: !v.mix.muted })} aria-label="Mute {v.name}">M</button>
          <button class="tog" aria-pressed={v.mix.solo} onclick={() => mix(v.id, { solo: !v.mix.solo })} aria-label="Solo {v.name}">S</button>
          <input
            type="range" min="0" max="1.5" step="0.05" value={v.mix.level}
            aria-label="{v.name} level" aria-valuetext="{Math.round(v.mix.level * 100)} percent"
            oninput={(e) => mix(v.id, { level: +e.currentTarget.value })}
          />
        </div>
      {/each}
    </section>
  {:else}
    <div aria-busy="true" aria-label="Loading voices">
      {#each [0, 1, 2] as i (i)}<div class="row ghost"><span class="skeleton sk-dot"></span><span class="skeleton sk-name"></span></div>{/each}
      <p class="dim">Voices appear here as they join the piece.</p>
    </div>
  {/each}

  <div class="save">
    <button class="action" onclick={saveBlend}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      Save this blend as my station
    </button>
  </div>
  {#if saved.length}
    <section class="group" aria-label="My stations">
      <h3 class="label">My stations</h3>
      {#each saved as b (b.id)}
        <div class="saved">
          <button class="saved-name" onclick={() => loadBlend(b)}>{b.name}</button>
          <button class="tog" onclick={() => removeBlend(b)} aria-label="Delete {b.name}">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </button>
        </div>
      {/each}
    </section>
  {/if}
</Sheet>

<style>
  .intro { margin: 0 0 14px; max-width: 46ch; color: var(--ink-dim); font-size: 0.93rem; }
  .group { padding: 14px 0 6px; border-top: 1px solid var(--line); }
  h3 { margin: 0 0 4px; }
  .row { --c: color-mix(in oklab, var(--c-raw, var(--accent)) 78%, var(--ink-dim)); display: grid; grid-template-columns: 10px minmax(0, 1fr) 44px 44px minmax(80px, 140px); align-items: center; gap: 8px; min-height: 52px; }
  .row.ghost { grid-template-columns: 10px minmax(0, 1fr); }
  .sk-dot { width: 8px; height: 8px; }
  .sk-name { width: 46%; height: 14px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; transform: rotate(45deg); background: var(--c); box-shadow: 0 0 10px var(--c); }
  .name { font-family: var(--serif); font-size: 1.05rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tog {
    width: 44px; height: 44px; display: grid; place-items: center;
    border: 0; border-radius: var(--r-sm); background: var(--surface-2); color: var(--ink-dim);
    font-family: var(--mono); font-size: 0.82rem; font-weight: 500;
    transition: background var(--t-fast) ease, color var(--t-fast) ease, transform var(--t-fast) var(--ease-spring);
  }
  .tog:hover { color: var(--ink); background: hsl(222 16% 22% / 0.7); }
  .tog:active { transform: scale(0.94); }
  .tog[aria-pressed='true'] { background: var(--accent); color: var(--on-accent); }

  input[type='range'] { -webkit-appearance: none; appearance: none; width: 100%; min-height: 44px; background: transparent; cursor: pointer; }
  input[type='range']::-webkit-slider-runnable-track { height: 3px; border-radius: 3px; background: linear-gradient(90deg, var(--c), var(--line-strong)); }
  input[type='range']::-moz-range-track { height: 3px; border-radius: 3px; background: var(--line-strong); }
  input[type='range']::-moz-range-progress { height: 3px; border-radius: 3px; background: var(--c); }
  input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; margin-top: -7.5px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 4px hsl(222 24% 5% / 0.8), 0 0 12px var(--c); transition: transform var(--t-fast) var(--ease-spring); }
  input[type='range']::-moz-range-thumb { width: 18px; height: 18px; border: 0; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 4px hsl(222 24% 5% / 0.8), 0 0 12px var(--c); }
  input[type='range']:active::-webkit-slider-thumb { transform: scale(1.15); }

  .save { margin: 18px 0 10px; }
  .action { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 2px; border: 0; background: none; color: var(--accent-ink); font-weight: 500; transition: color var(--t-fast) ease, transform var(--t-fast) var(--ease-spring); }
  .action:hover { color: var(--ink); }
  .action:active { transform: translateY(1px); }
  .saved { display: flex; gap: 6px; margin: 4px 0; }
  .saved-name { flex: 1; min-height: 44px; padding: 0 14px; text-align: left; border: 0; border-radius: var(--r-sm); background: var(--surface); font-family: var(--serif); font-size: 1rem; transition: background var(--t-fast) ease, transform var(--t-fast) var(--ease-spring); }
  .saved-name:hover { background: var(--surface-2); }
  .saved-name:active { transform: scale(0.99); }
  .dim { color: var(--ink-dim); font-size: 0.9rem; }
  @media (max-width: 400px) { .row { grid-template-columns: 10px minmax(0, 1fr) 44px 44px; } .row input { grid-column: 2 / -1; } }
</style>
