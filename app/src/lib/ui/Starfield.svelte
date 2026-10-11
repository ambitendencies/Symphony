<script lang="ts">
  /** Deep-space backdrop: a once-drawn star canvas that drifts very slowly, under a tinted nebula. */
  import { onMount } from 'svelte';

  let canvas: HTMLCanvasElement;

  function paint() {
    const w = Math.max(window.innerWidth, 320);
    const h = Math.max(window.innerHeight, 480);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * 1.3 * dpr);
    canvas.height = Math.round(h * 1.3 * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const count = Math.round((w * h) / 2600);
    for (let i = 0; i < count; i++) {
      const x = rnd() * w * 1.3;
      const y = rnd() * h * 1.3;
      const big = rnd() > 0.96;
      const r = big ? 1.1 + rnd() * 0.7 : 0.3 + rnd() * 0.6;
      const warm = rnd() > 0.7;
      ctx.fillStyle = `hsla(${warm ? 38 : 220}, ${warm ? 60 : 40}%, ${80 + rnd() * 18}%, ${0.25 + rnd() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  onMount(() => {
    paint();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(paint, 250);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<div class="sky" aria-hidden="true">
  <div class="nebula"></div>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .sky { position: fixed; inset: 0; overflow: hidden; background: radial-gradient(120% 90% at 50% 0%, #15123f 0%, var(--bg) 62%); z-index: 0; }
  .nebula {
    position: absolute; inset: -20%;
    background:
      radial-gradient(40% 35% at 30% 70%, hsl(var(--hue) 70% 40% / 0.2), transparent 70%),
      radial-gradient(45% 40% at 78% 25%, hsl(calc(var(--hue) + 70) 60% 40% / 0.14), transparent 70%);
    animation: breathe 22s ease-in-out infinite alternate;
  }
  canvas { position: absolute; left: 0; top: 0; width: 130vw; height: 130vh; animation: drift 240s linear infinite alternate; opacity: 0.9; }
  @keyframes drift { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-8vw, -6vh, 0); } }
  @keyframes breathe { from { opacity: 0.6; transform: scale(1); } to { opacity: 1; transform: scale(1.06); } }
</style>
