<script lang="ts">
  // Placeholder shell — replaced by the full receiver UI (Phase C).
  import { engine } from './lib/engine';
  import type { EngineState } from './lib/engine/types';

  let state = $state<EngineState>(engine.state);
  engine.subscribe((s) => (state = s));
</script>

<main>
  {#if state.status === 'idle'}
    <button onclick={() => engine.start()}>Begin listening</button>
  {:else}
    <p>{engine.station()?.name} — {state.mood} — bar {state.bar}</p>
    {#each state.voices as v (v.id)}
      <p>{v.name} ({v.role}): {v.readout?.headline}</p>
    {/each}
  {/if}
</main>
