<script lang="ts">
  /**
   * The live visual at the centre of the dial: a radial spectrum + waveform ring
   * with drifting motes, driven by the master AnalyserNode. Canvas 2D, paused when
   * the tab is hidden, drops resolution when frames run slow, calm under reduced motion.
   */
  import { onMount } from 'svelte';
  import { easeHue } from './helpers';

  let {
    analyser,
    hue,
    colors,
    grain,
    reduced,
  }: { analyser: AnalyserNode | null; hue: number; colors: string[]; grain: number; reduced: boolean } = $props();

  let canvas: HTMLCanvasElement;
  let raf = 0;
  let size = 0;
  let quality = 1;
  let slow = 0;
  let last = 0;
  let curHue = 36;
  let level = 0;
  let gSm = 0.5;
  let freq: Uint8Array<ArrayBuffer> | null = null;
  let wave: Uint8Array<ArrayBuffer> | null = null;
  let noise: HTMLCanvasElement | null = null;
  let noiseOffset = { x: 0, y: 0, at: 0 };
  let phase = 0;
  const MOTES = Array.from({ length: 46 }, (_, i) => ({
    a: (i * 2.399963) % (Math.PI * 2),
    r: 0.18 + ((i * 0.6180339) % 1) * 0.74,
    s: (0.015 + ((i * 0.37) % 1) * 0.035) * (i % 2 ? 1 : -1),
    z: 0.5 + ((i * 0.77) % 1),
  }));

  function makeNoise(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    const img = g.createImageData(96, 96);
    let s = 99;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 16807) % 2147483647;
      const v = 140 + (s % 115);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 40 + (s % 60);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    size = Math.max(64, rect.width);
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
    canvas.width = canvas.height = Math.round(size * dpr);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    if (reduced && dt < 180) return; // gentle: ~5 fps, no fast motion
    if (!reduced && dt < 30 && quality < 1) return; // ~30 fps cap on lower tiers
    last = now;
    // Automatic quality: sustained slow frames drop the resolution.
    if (dt > 40 && dt < 500) slow++;
    else slow = Math.max(0, slow - 1);
    if (slow > 40 && quality > 0.5) {
      quality = quality > 0.75 ? 0.75 : 0.5;
      slow = 0;
      resize();
    }
    draw(now, Math.min(dt, 100) / 1000);
  }

  function draw(now: number, dt: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const cx = W / 2;
    const R = W / 2;
    curHue = easeHue(curHue, hue, 0.03);
    phase += dt * (reduced ? 0.15 : 0.5);

    // Audio features.
    let bass = 0;
    let bins = 0;
    if (analyser) {
      if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
      if (!wave || wave.length !== analyser.fftSize) wave = new Uint8Array(analyser.fftSize);
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);
      bins = freq.length;
      let sum = 0;
      const n = Math.max(1, Math.floor(bins * 0.12));
      for (let i = 0; i < n; i++) sum += freq[i];
      bass = sum / n / 255;
    }
    level += (bass - level) * 0.06;
    gSm += (grain - gSm) * (reduced ? 0.2 : 0.035);

    // Trails: translucent wash instead of clearing, so motion smears softly.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(7, 6, 26, 0.2)';
    ctx.fillRect(0, 0, W, W);

    // Core glow breathes with the low end (and slowly on its own).
    const breathe = 0.5 + 0.5 * Math.sin(phase * 0.9);
    const glow = ctx.createRadialGradient(cx, cx, 0, cx, cx, R * (0.55 + level * 0.35 + breathe * 0.05));
    glow.addColorStop(0, `hsla(${curHue}, 90%, 62%, ${0.28 + level * 0.5})`);
    glow.addColorStop(0.5, `hsla(${curHue}, 80%, 45%, ${0.1 + level * 0.15})`);
    glow.addColorStop(1, `hsla(${curHue}, 80%, 30%, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, W);

    ctx.globalCompositeOperation = 'lighter';
    // Radial spectrum (mirrored, so it reads as a calm mandala).
    const spokes = quality < 0.6 ? 32 : 56;
    const r0 = R * 0.4;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, W / 220);
    for (let i = 0; i < spokes; i++) {
      const t = i / spokes;
      const idx = bins ? Math.min(bins - 1, Math.floor(Math.pow(t, 0.85) * bins * 0.4)) : 0;
      const v = bins ? Math.min(1, (freq![idx] / 255) * 1.5) : 0.1 + 0.08 * Math.sin(phase + i * 0.5);
      const len = R * (0.05 + v * 0.5);
      for (const sign of [1, -1]) {
        const a = sign * t * Math.PI - Math.PI / 2 + phase * 0.03;
        const x0 = cx + Math.cos(a) * r0;
        const y0 = cx + Math.sin(a) * r0;
        ctx.strokeStyle = `hsla(${curHue + t * 40 - 10}, 85%, ${55 + v * 25}%, ${0.25 + v * 0.55})`;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cx + Math.sin(a) * (r0 + len));
        ctx.stroke();
      }
    }
    // Waveform ring.
    ctx.lineWidth = Math.max(1.2, W / 180);
    ctx.strokeStyle = `hsla(${curHue}, 90%, 78%, 0.8)`;
    ctx.beginPath();
    const pts = quality < 0.6 ? 90 : 160;
    for (let i = 0; i <= pts; i++) {
      const t = i / pts;
      let w = 0;
      if (wave) w = (wave[Math.floor(t * (wave.length - 1))] - 128) / 128;
      else w = 0.05 * Math.sin(t * 12 + phase);
      const rr = r0 * 0.78 + w * R * 0.3;
      const a = t * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * rr;
      const y = cx + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Motes in the voice colours.
    const count = quality < 0.6 ? 20 : MOTES.length;
    for (let i = 0; i < count; i++) {
      const m = MOTES[i];
      const a = m.a + phase * m.s * 6;
      const rr = R * (m.r * 0.95 + 0.04 * Math.sin(phase + i));
      const c = colors.length ? colors[i % colors.length] : `hsl(${curHue} 80% 70%)`;
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.18 + 0.4 * (0.5 + 0.5 * Math.sin(phase * m.z + i)) * (0.5 + level);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, Math.max(0.8, W / 260) * m.z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Film grain / station static: a pre-rendered tile, re-offset at ~8 Hz, low contrast.
    if (gSm > 0.02) {
      noise ??= makeNoise();
      if (!reduced && now - noiseOffset.at > 120) {
        noiseOffset = { x: Math.random() * 96, y: Math.random() * 96, at: now };
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(0.55, gSm * 0.55);
      const pat = ctx.createPattern(noise, 'repeat');
      if (pat) {
        ctx.save();
        ctx.translate(-noiseOffset.x, -noiseOffset.y);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, W + 96, W + 96);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  function start() {
    if (raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  onMount(() => {
    curHue = hue;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  });
</script>

<canvas bind:this={canvas} class="visual" aria-hidden="true"></canvas>

<style>
  .visual { width: 100%; height: 100%; display: block; border-radius: 50%; background: #07061a; }
</style>
