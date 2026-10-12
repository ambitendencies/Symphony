<script lang="ts">
  let { stationName, tagline, error, starting, onbegin }: { stationName: string; tagline: string; error: string; starting: boolean; onbegin: () => void } = $props();
</script>

<main class="arrival" id="main">
  <!-- A dial ornament that bleeds off the edge, so the first screen already looks like the instrument. -->
  <svg class="ornament" viewBox="0 0 400 400" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-linecap="round">
      <circle cx="200" cy="200" r="190" stroke-width="0.6" opacity="0.35" />
      <circle cx="200" cy="200" r="150" stroke-width="0.6" opacity="0.5" />
      <circle cx="200" cy="200" r="96" stroke-width="1" opacity="0.4" />
      <path d="M200 30 A170 170 0 1 1 79.8 79.8" stroke-width="0.8" stroke-dasharray="1 7" opacity="0.7" />
    </g>
    <circle class="spark" cx="320.2" cy="79.8" r="3" />
  </svg>

  <div class="inner">
    <p class="label kicker">A receiver for the sounds of space</p>
    <h1>Cosmic<br />Radio</h1>
    <p class="lede">
      Real measurements from the Sun, pulsars, stars and black holes, turned into calm, layered music.
      Tune between stations as you would an old shortwave set.
    </p>
    <div class="actions">
      <button class="begin" onclick={onbegin} disabled={starting} aria-busy={starting}>
        <span class="label-text">{starting ? 'Tuning in…' : 'Begin listening'}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
      </button>
      <p class="meta">Opens on <em>{stationName}</em><span class="sep" aria-hidden="true">·</span>{tagline}</p>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="hint">Sound begins softly. Headphones or a quiet speaker suit it best.</p>
  </div>
</main>

<style>
  .arrival {
    position: fixed; inset: 0; z-index: var(--z-arrival);
    display: grid; align-items: end;
    min-height: 100dvh; overflow: hidden;
    padding: calc(32px + var(--safe-t)) calc(24px + var(--safe-r)) calc(40px + var(--safe-b)) calc(24px + var(--safe-l));
  }
  .ornament {
    position: absolute; width: min(150vw, 1100px); aspect-ratio: 1;
    right: -38%; top: -18%;
    color: var(--metal);
    animation: turn 180s linear infinite;
  }
  .spark { fill: var(--accent); filter: drop-shadow(0 0 6px var(--accent)); }
  .inner { position: relative; width: 100%; max-width: 1240px; margin: 0 auto; }
  .inner > * { animation: rise 1.4s var(--ease-out) both; }
  .inner > :nth-child(2) { animation-delay: 0.12s; }
  .inner > :nth-child(3) { animation-delay: 0.3s; }
  .inner > :nth-child(4) { animation-delay: 0.48s; }
  .inner > :nth-child(5), .inner > :nth-child(6) { animation-delay: 0.66s; }

  .kicker { margin: 0 0 12px; color: var(--accent-ink); }
  h1 {
    margin: 0 0 22px;
    font-family: var(--serif); font-weight: 560; font-variation-settings: 'opsz' 144;
    font-size: clamp(3.4rem, 15vw, 8.5rem); line-height: 0.88; letter-spacing: -0.035em;
  }
  .lede { max-width: 34ch; margin: 0 0 32px; font-size: clamp(1.02rem, 3.4vw, 1.2rem); line-height: 1.6; color: var(--ink-dim); }

  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 22px; }
  .begin {
    display: inline-flex; align-items: center; gap: 12px;
    min-height: 56px; padding: 0 22px 0 26px;
    border: 0; border-radius: var(--r-md);
    background: var(--accent); color: var(--on-accent);
    font-family: var(--sans); font-size: 1.05rem; font-weight: 600; letter-spacing: -0.005em;
    box-shadow: var(--shadow-accent), inset 0 1px 0 hsl(var(--hue) 70% 85% / 0.5);
    transition: transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast) ease, background var(--t-fast) ease;
  }
  .begin svg { margin-top: 1px; } /* optical centring of the play glyph */
  .begin:hover:not(:disabled) { transform: translateY(-2px); background: var(--accent-ink); box-shadow: 0 16px 44px hsl(var(--hue) 60% 30% / 0.45), inset 0 1px 0 hsl(var(--hue) 70% 85% / 0.5); }
  .begin:active:not(:disabled) { transform: translateY(0) scale(0.98); }
  .begin:disabled { cursor: progress; opacity: 0.85; }
  .meta { margin: 0; max-width: 40ch; color: var(--ink-dim); font-size: 0.92rem; }
  .meta em { font-family: var(--serif); font-size: 1.05em; color: var(--ink); }
  .sep { margin: 0 0.5em; color: var(--ink-faint); }
  .hint { margin: 28px 0 0; color: var(--ink-faint); font-size: 0.84rem; }
  .error { margin: 18px 0 0; max-width: 46ch; color: var(--danger); }

  @media (min-width: 900px) {
    .arrival { align-items: center; padding-inline: 64px; }
    .ornament { right: -14%; top: 50%; translate: 0 -50%; width: min(80vw, 980px); }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes turn { to { rotate: 360deg; } }
</style>
