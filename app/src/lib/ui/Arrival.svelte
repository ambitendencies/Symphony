<script lang="ts">
  let { stationName, tagline, error, starting, onbegin }: { stationName: string; tagline: string; error: string; starting: boolean; onbegin: () => void } = $props();
</script>

<main class="arrival">
  <div class="inner">
    <p class="eyebrow">A receiver for the sounds of space</p>
    <h1>Cosmic Radio</h1>
    <p class="lede">
      Real measurements from the Sun, pulsars, stars and black holes, turned into calm, layered music.
      Tune between stations as you would an old shortwave set.
    </p>
    <button class="begin" onclick={onbegin} disabled={starting}>
      <span class="glow" aria-hidden="true"></span>
      <span class="label">Begin listening</span>
    </button>
    <p class="meta">Opening on <strong>{stationName}</strong> — {tagline}</p>
    <p class="hint">Headphones or a quiet speaker suit it best. Sound begins softly.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
</main>

<style>
  .arrival { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: calc(24px + var(--safe-t)) calc(20px + var(--safe-r)) calc(24px + var(--safe-b)) calc(20px + var(--safe-l)); text-align: center; background: radial-gradient(60% 50% at 50% 48%, rgba(7, 6, 26, 0.1), rgba(7, 6, 26, 0.55)); }
  .inner { max-width: 520px; animation: arrive 2.4s ease both; }
  .eyebrow { font-family: var(--mono); font-size: 0.74rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--brass); margin: 0 0 14px; }
  h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(2.6rem, 11vw, 4.4rem); line-height: 1.05; margin: 0 0 18px; letter-spacing: 0.01em; text-shadow: 0 0 40px var(--accent-glow); }
  .lede { font-family: var(--serif); font-size: clamp(1.05rem, 3.6vw, 1.25rem); color: var(--ink); opacity: 0.9; margin: 0 auto 34px; max-width: 30em; }
  .begin { position: relative; min-height: 64px; padding: 0 44px; border-radius: 999px; border: 1px solid hsl(var(--hue) 80% 70% / 0.7); background: linear-gradient(180deg, hsl(var(--hue) 60% 30% / 0.55), hsl(var(--hue) 70% 18% / 0.65)); color: #fff7e8; font-family: var(--serif); font-size: 1.25rem; letter-spacing: 0.04em; box-shadow: 0 0 36px var(--accent-glow), inset 0 0 18px hsl(var(--hue) 80% 60% / 0.25); transition: transform 0.6s ease, box-shadow 0.6s ease; }
  .begin:hover:not(:disabled) { transform: scale(1.025); box-shadow: 0 0 56px var(--accent-glow), inset 0 0 22px hsl(var(--hue) 80% 60% / 0.35); }
  .begin:disabled { opacity: 0.7; cursor: progress; }
  .glow { position: absolute; inset: -14px; border-radius: 999px; background: radial-gradient(closest-side, var(--accent-glow), transparent); z-index: -1; animation: pulse 6s ease-in-out infinite; }
  .label { position: relative; }
  .meta { margin: 26px 0 4px; color: var(--ink-dim); font-size: 0.92rem; }
  .meta strong { color: var(--accent-ink); font-family: var(--serif); font-weight: 500; }
  .hint { margin: 0; color: var(--ink-dim); font-size: 0.82rem; opacity: 0.85; }
  .error { margin-top: 16px; color: #ffb4a8; }
  @keyframes arrive { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes pulse { 0%, 100% { opacity: 0.55; transform: scale(0.97); } 50% { opacity: 1; transform: scale(1.04); } }
</style>
