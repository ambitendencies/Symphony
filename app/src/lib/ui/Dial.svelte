<script lang="ts">
  /**
   * The tuning dial. A single ARIA slider (arrow keys / Home / End / PageUp/PageDown),
   * draggable with pointer events (touch-first), mouse-wheel tunable, with stations as
   * glowing points on a metal arc and one ring per sounding voice around it.
   */
  import { onDestroy, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { ActiveVoiceState, StationConfig } from '../engine/types';
  import { ROLES } from '../engine/types';
  import Visual from './Visual.svelte';
  import {
    angleDelta,
    clamp,
    DIAL_ARC,
    dragPosition,
    nearestIndex,
    pointerAngle,
    positionAtAngle,
    stationAngle,
    stepAngle,
    staticAmount,
  } from './helpers';

  let {
    stations,
    index,
    voices,
    analyser,
    tuning,
    reduced,
    orchestra,
    preview = $bindable<number | null>(null),
    onTune,
  }: {
    stations: StationConfig[];
    index: number;
    voices: ActiveVoiceState[];
    analyser: AnalyserNode | null;
    tuning: boolean;
    reduced: boolean;
    orchestra: boolean;
    preview?: number | null;
    onTune: (id: string) => void;
  } = $props();

  const n = $derived(stations.length);
  const C = 104; // viewBox centre

  let el: HTMLDivElement;
  let pos = $state(untrack(() => index));
  let dragging = $state(false);
  let interacting = false;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: { startAngle: number; startPos: number; sx: number; sy: number; moved: boolean } | null = null;

  // Follow the engine when the station changes from elsewhere (deep link, saved blend).
  $effect(() => {
    const i = index;
    if (!untrack(() => interacting)) pos = i;
  });
  onDestroy(() => clearTimeout(commitTimer));

  const shown = $derived(nearestIndex(pos, n));
  $effect(() => {
    preview = interacting || dragging || Math.abs(pos - index) > 0.01 ? shown : null;
  });

  function commit() {
    clearTimeout(commitTimer);
    const i = nearestIndex(pos, n);
    pos = i;
    interacting = false;
    dragging = false;
    drag = null;
    if (i !== index && stations[i]) onTune(stations[i].id);
  }
  function scheduleCommit(ms = 450) {
    interacting = true;
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, ms);
  }

  function centre() {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width };
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button > 0) return;
    const c = centre();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    if (Math.hypot(dx, dy) < c.size * 0.1) return;
    el.setPointerCapture(e.pointerId);
    clearTimeout(commitTimer);
    interacting = true;
    dragging = true;
    drag = { startAngle: pointerAngle(dx, dy), startPos: pos, sx: e.clientX, sy: e.clientY, moved: false };
  }
  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const c = centre();
    const a = pointerAngle(e.clientX - c.x, e.clientY - c.y);
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    if (drag.moved) pos = dragPosition(drag.startPos, angleDelta(a, drag.startAngle), n);
  }
  function onpointerup(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved) {
      // A tap on the bezel jumps to the station nearest that spot.
      const c = centre();
      const dx = e.clientX - c.x;
      const dy = e.clientY - c.y;
      if (Math.hypot(dx, dy) > c.size * 0.27) {
        const a = pointerAngle(dx, dy);
        if (Math.abs(a) <= DIAL_ARC / 2 + stepAngle(n) / 2) pos = positionAtAngle(a, n);
      }
    }
    commit();
  }
  function onwheel(e: WheelEvent) {
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    pos = clamp(pos + d / 360, 0, n - 1);
    scheduleCommit(550);
  }
  function onkeydown(e: KeyboardEvent) {
    const cur = nearestIndex(pos, n);
    let next = cur;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'PageUp':
        next = cur + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'PageDown':
        next = cur - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    pos = clamp(next, 0, n - 1);
    scheduleCommit(500);
  }

  // --- geometry ----------------------------------------------------------------
  const ticks = $derived.by(() => {
    const major = new Set<number>();
    for (let i = 0; i < n; i++) major.add(Math.round(stationAngle(i, n)));
    let minor = '';
    for (let a = -DIAL_ARC / 2; a <= DIAL_ARC / 2 + 0.01; a += 4) {
      const rad = (a * Math.PI) / 180;
      const r1 = 63;
      const r2 = a % 20 === 0 ? 68.5 : 66;
      minor += `M${(C + Math.sin(rad) * r1).toFixed(2)} ${(C - Math.cos(rad) * r1).toFixed(2)}L${(C + Math.sin(rad) * r2).toFixed(2)} ${(C - Math.cos(rad) * r2).toFixed(2)}`;
    }
    return minor;
  });
  const arcPath = (() => {
    const r = 65;
    const a0 = (-DIAL_ARC / 2) * (Math.PI / 180);
    const a1 = (DIAL_ARC / 2) * (Math.PI / 180);
    return `M${C + Math.sin(a0) * r} ${C - Math.cos(a0) * r}A${r} ${r} 0 1 1 ${C + Math.sin(a1) * r} ${C - Math.cos(a1) * r}`;
  })();

  const anySolo = $derived(voices.some((v) => v.mix.solo));
  const rings = $derived.by(() => {
    const perRole = new Map<string, number>();
    return voices.map((v, i) => {
      const ri = ROLES.indexOf(v.role);
      const k = perRole.get(v.role) ?? 0;
      perRole.set(v.role, k + 1);
      const audible = !v.mix.muted && (!anySolo || v.mix.solo);
      return {
        id: v.id,
        color: v.color,
        r: 77 + ri * 3.6 + k * 1.7,
        w: 0.45 + Math.min(1.5, v.mix.level) * 0.5,
        audible,
        dur: 70 + i * 23,
        start: (i * 97) % 360,
      };
    });
  });

  const angle = $derived(-DIAL_ARC / 2 + pos * stepAngle(n));
  const grain = $derived(Math.max(staticAmount(pos) * 1.1, tuning ? 0.7 : 0.05));
  const hue = $derived(stations[shown]?.hue ?? 36);
  const colors = $derived(voices.map((v) => v.color));
  const label = $derived(stations[shown] ? `${stations[shown].name}, station ${shown + 1} of ${n}` : 'Tuning');
</script>

<div
  class="dial"
  class:orchestra
  class:dragging
  bind:this={el}
  role="slider"
  tabindex="0"
  aria-label="Tune the radio"
  aria-orientation="horizontal"
  aria-valuemin={0}
  aria-valuemax={Math.max(0, n - 1)}
  aria-valuenow={shown}
  aria-valuetext={label}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onwheel}
  {onkeydown}
>
  <svg viewBox="0 0 208 208" aria-hidden="true">
    <defs>
      {#each stations as s, i (s.id)}
        <radialGradient id="pt-{i}">
          <stop offset="0" stop-color="hsl({s.hue} 58% 68%)" stop-opacity="0.9" />
          <stop offset="1" stop-color="hsl({s.hue} 58% 60%)" stop-opacity="0" />
        </radialGradient>
      {/each}
    </defs>

    <!-- bezel -->
    <circle cx={C} cy={C} r="57" fill="none" stroke="var(--metal-dim)" stroke-width="0.6" opacity="0.7" />
    <circle cx={C} cy={C} r="55.4" fill="none" stroke="var(--accent)" stroke-width="0.5" opacity="0.5" />
    <path d={arcPath} fill="none" stroke="var(--metal)" stroke-width="0.5" opacity="0.6" />
    <path d={ticks} stroke="var(--metal)" stroke-width="0.45" opacity="0.65" />

    <!-- voice rings -->
    {#each rings as ring (ring.id)}
      <g class="ring" class:muted={!ring.audible} style="--c: {ring.color}" transition:fade={{ duration: reduced ? 0 : 1800 }}>
        <circle cx={C} cy={C} r={ring.r} fill="none" stroke={ring.color} stroke-width={ring.w} class="band" stroke-dasharray={ring.audible ? 'none' : '0.8 2.4'} />
        <g class="orbit" style="animation-duration: {ring.dur}s; transform: rotate({ring.start}deg)">
          <circle cx={C} cy={C - ring.r} r="3.4" fill={ring.color} opacity="0.18" />
          <circle cx={C} cy={C - ring.r} r="1.35" fill={ring.color} />
        </g>
      </g>
    {/each}

    <!-- stations -->
    {#each stations as s, i (s.id)}
      {@const a = stationAngle(i, n)}
      <g transform="rotate({a} {C} {C})" class="pt" class:on={i === shown}>
        <circle cx={C} cy={C - 73.5} r={i === shown ? 10 : 6} fill="url(#pt-{i})" class="halo" />
        <circle cx={C} cy={C - 73.5} r={i === shown ? 2.5 : 1.7} fill="hsl({s.hue} 55% 80%)" class="core" />
      </g>
    {/each}

    <!-- needle -->
    <g class="needle" style="transform: rotate({angle}deg); transition-duration: {dragging || reduced ? 0 : 900}ms">
      <path d="M{C} {C - 55}L{C} {C - 70}" stroke="var(--metal)" stroke-width="0.9" stroke-linecap="round" />
      <path d="M{C - 2.6} {C - 55.5}L{C + 2.6} {C - 55.5}L{C} {C - 51}Z" fill="var(--accent)" />
    </g>
  </svg>

  <div class="face">
    <Visual {analyser} {hue} {colors} {grain} {reduced} />
  </div>
</div>

<style>
  .dial {
    --size: min(86vw, calc(100dvh - 380px), 560px);
    flex: none;
    position: relative;
    width: var(--size);
    height: var(--size);
    margin: 0 auto;
    touch-action: none;
    cursor: grab;
    border-radius: 50%;
    user-select: none;
    -webkit-user-select: none;
    outline-offset: 0;
  }
  .dial.dragging { cursor: grabbing; }
  @media (min-width: 900px) { .dial { --size: min(46vw, calc(100dvh - 210px), 620px); } }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .face {
    position: absolute; inset: 26.4%;
    border-radius: 50%; overflow: hidden;
    box-shadow:
      0 0 0 1px hsl(var(--hue) 30% 60% / 0.3),
      0 0 48px var(--accent-glow),
      inset 0 0 28px hsl(222 40% 2% / 0.8);
    transition: box-shadow 3s ease;
  }
  .needle { transform-origin: 104px 104px; transition-property: transform; transition-timing-function: cubic-bezier(0.22, 0.8, 0.3, 1); filter: drop-shadow(0 0 2px var(--accent)); }
  .pt .halo { transition: r 0.8s ease; }
  .band { filter: drop-shadow(0 0 1.6px var(--c)); opacity: 0.55; transition: opacity 1.2s ease, stroke-width 0.6s ease; }
  .ring.muted .band { opacity: 0.22; filter: none; }
  .orbit { transform-origin: 104px 104px; animation: orbit linear infinite; }
  .ring.muted .orbit { opacity: 0.3; }
  .orchestra .band { opacity: 0.9; stroke-width: 1.15; }
  .orchestra .ring.muted .band { opacity: 0.3; }
  @keyframes orbit { to { rotate: 360deg; } }
</style>
