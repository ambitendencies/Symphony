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
      <h3>{ROLE_LABELS[g.role]}</h3>
      {#each g.voices as v (v.id)}
        <div class="row" style="--c: {v.color}">
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
    <p class="dim">Voices will appear here as they join the piece.</p>
  {/each}

  <div class="save">
    <button class="pill" onclick={saveBlend}>Save this blend as my station</button>
  </div>
  {#if saved.length}
    <section class="group" aria-label="My stations">
      <h3>My stations</h3>
      {#each saved as b (b.id)}
        <div class="saved">
          <button class="pill grow" onclick={() => loadBlend(b)}>{b.name}</button>
          <button class="tog" onclick={() => removeBlend(b)} aria-label="Delete {b.name}">×</button>
        </div>
      {/each}
    </section>
  {/if}
</Sheet>

<style>
  .intro { margin: 0 0 8px; color: var(--ink-dim); font-size: 0.92rem; }
  .group { margin: 10px 0; }
  h3 { margin: 0 0 4px; font-family: var(--mono); font-weight: 500; font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); }
  .row { display: grid; grid-template-columns: 12px minmax(0, 1fr) 44px 44px minmax(70px, 130px); align-items: center; gap: 6px; min-height: 48px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
  .name { font-family: var(--serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tog { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.04); font-family: var(--mono); font-size: 0.85rem; color: var(--ink); }
  .tog[aria-pressed='true'] { background: var(--accent); color: #0a0820; border-color: var(--accent); }
  input[type='range'] { width: 100%; min-height: 44px; accent-color: var(--accent); background: transparent; }
  .save { margin: 14px 0 6px; }
  .pill { min-height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--brass-dim); background: rgba(201, 164, 98, 0.08); color: var(--ink); font-size: 0.9rem; }
  .pill:hover { background: rgba(201, 164, 98, 0.16); }
  .saved { display: flex; gap: 6px; margin: 4px 0; }
  .grow { flex: 1; text-align: left; }
  .dim { color: var(--ink-dim); }
  @media (max-width: 400px) { .row { grid-template-columns: 12px minmax(0, 1fr) 44px 44px; } .row input { grid-column: 2 / -1; } }
</style>
