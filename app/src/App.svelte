<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { engine } from './lib/engine';
  import { decodeLink, encodeLink } from './lib/engine/deeplink';
  import type { EngineState, MoodId } from './lib/engine/types';
  import { MOODS } from './lib/engine/theory';
  import About from './lib/ui/About.svelte';
  import Arrival from './lib/ui/Arrival.svelte';
  import Dial from './lib/ui/Dial.svelte';
  import HearingPanel from './lib/ui/HearingPanel.svelte';
  import MoodPanel from './lib/ui/MoodPanel.svelte';
  import Orchestra from './lib/ui/Orchestra.svelte';
  import Starfield from './lib/ui/Starfield.svelte';
  import { formatAgo, formatRemaining, TECHNIQUE_LABELS } from './lib/ui/helpers';

  const AMBIENT_MS = 20_000;
  type Panel = 'hearing' | 'orchestra' | 'mood' | 'about' | null;

  const stations = engine.stationList;

  // --- engine state (one subscription) ---------------------------------------
  let es = $state<EngineState>(engine.state);
  onMount(() => engine.subscribe((s) => (es = s)));

  // --- deep link on load -----------------------------------------------------
  const link = decodeLink(location.search);
  const initialStation = link.station && engine.station(link.station) ? link.station : engine.state.stationId;
  const initialMood: MoodId = link.mood ?? engine.station(initialStation)?.mood ?? 'drift';
  if (link.mix) engine.setBlend(initialStation, link.mix);
  void engine.tune(initialStation, initialMood); // before start(): just selects

  let phase = $state<'arrival' | 'receiver'>('arrival');
  let starting = $state(false);
  let startError = $state('');
  let panel = $state<Panel>(null);
  let preview = $state<number | null>(null);
  let idle = $state(false);
  let now = $state(Date.now());
  let notice = $state('');
  let reduced = $state(false);

  const station = $derived(engine.station(es.stationId));
  const stationIndex = $derived(Math.max(0, stations.findIndex((s) => s.id === es.stationId)));
  const shownStation = $derived(preview !== null ? stations[preview] : station);
  const hue = $derived(shownStation?.hue ?? 220);
  const techniques = $derived([...new Set(es.voices.map((v) => v.technique))].map((t) => TECHNIQUE_LABELS[t]));
  const tuning = $derived(es.status === 'tuning' || preview !== null);
  const hidden = $derived(phase === 'receiver' && idle && panel === null);

  // --- begin (inside the click handler for iOS) --------------------------------
  function begin() {
    if (starting) return;
    starting = true;
    startError = '';
    const p = engine.start(es.stationId, es.mood);
    phase = 'receiver';
    p.catch((e) => {
      console.warn('Could not start audio', e);
      phase = 'arrival';
      starting = false;
      startError = 'Your browser would not start audio. Please try again, or check that sound is not blocked for this page.';
    });
    p.then(() => (starting = false));
  }

  function tune(id: string) {
    void engine.tune(id);
  }

  // --- theme colour (slow CSS transition) ---------------------------------------
  $effect(() => {
    document.documentElement.style.setProperty('--hue', String(hue));
  });

  // --- URL sync + title + media session --------------------------------------------
  const mixKey = $derived(es.voices.map((v) => `${v.id}:${v.mix.level.toFixed(2)}${v.mix.muted ? 'm' : ''}${v.mix.solo ? 's' : ''}`).join('|'));
  $effect(() => {
    if (phase !== 'receiver') return;
    void mixKey;
    const sid = es.stationId;
    const mood = es.mood;
    const mix = untrack(() => engine.blend(sid));
    try {
      history.replaceState(null, '', location.pathname + encodeLink({ station: sid, mood, mix }));
    } catch {
      /* sandboxed frames may forbid it */
    }
  });
  $effect(() => {
    const name = station?.name ?? 'Cosmic Radio';
    document.title = phase === 'receiver' ? `${name} · Cosmic Radio` : 'Cosmic Radio';
    if (phase !== 'receiver' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: name,
        artist: 'Cosmic Radio',
        album: station?.tagline ?? '',
        artwork: [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }],
      });
    } catch {
      /* unsupported */
    }
  });
  onMount(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => void engine.resume());
      ms.setActionHandler('pause', () => void engine.suspend());
    } catch {
      /* unsupported action */
    }
  });

  // --- clock for "updated N min ago" and the sleep countdown -------------------------
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  // --- ambient mode ---------------------------------------------------------------------
  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      idle = false;
      clearTimeout(timer);
      timer = setTimeout(() => (idle = true), AMBIENT_MS);
    };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, wake, { passive: true });
    wake();
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const onMq = () => (reduced = mq.matches);
    mq.addEventListener('change', onMq);
    return () => {
      clearTimeout(timer);
      for (const e of evs) window.removeEventListener(e, wake);
      mq.removeEventListener('change', onMq);
    };
  });

  // --- live pulse ------------------------------------------------------------------------------
  const pulse = $derived.by(() => {
    const liveVoices = es.voices.filter((v) => !v.fallback && v.dataTime);
    if (!liveVoices.length) return es.voices.length ? { live: false, text: 'Archival data' } : null;
    const newest = liveVoices.reduce((a, b) => (Date.parse(b.dataTime!) > Date.parse(a.dataTime!) ? b : a));
    return { live: true, text: `${newest.source ?? 'Live'} · ${formatAgo(now - Date.parse(newest.dataTime!))}` };
  });

  // --- captions -----------------------------------------------------------------------------------
  let captionText = $state('');
  let captionOn = $state(false);
  $effect(() => {
    const c = es.caption;
    if (c) {
      captionText = c.text;
      captionOn = true;
    } else captionOn = false;
  });

  // --- share ----------------------------------------------------------------------------------------
  let noticeTimer: ReturnType<typeof setTimeout>;
  function say(msg: string) {
    notice = msg;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 3800);
  }
  async function share() {
    const url = location.origin + location.pathname + encodeLink({ station: es.stationId, mood: es.mood, mix: engine.blend() });
    const data = { title: `${station?.name ?? 'Cosmic Radio'} · Cosmic Radio`, text: station?.tagline ?? 'Listen to the sounds of space.', url };
    try {
      if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      say('Link copied. Share this moment.');
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        say('Link copied. Share this moment.');
      } catch {
        say(url);
      }
    }
  }

  function toggle(p: Exclude<Panel, null>) {
    panel = panel === p ? null : p;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && panel) panel = null;
  }
</script>

<svelte:window {onkeydown} />

<Starfield />

{#if phase === 'arrival'}
  <Arrival stationName={station?.name ?? ''} tagline={station?.tagline ?? ''} error={startError} {starting} onbegin={begin} />
{:else}
  <div class="app" class:hidden class:sheet={panel !== null}>
    <header class="top chrome">
      <span class="brand">Cosmic Radio</span>
      {#if pulse}
        <span class="pulse" class:live={pulse.live} title={pulse.live ? 'Live data' : 'Playing an archival loop'}>
          <i aria-hidden="true"></i>{pulse.live ? 'Live' : ''} {pulse.text}
        </span>
      {/if}
      <button class="icon" onclick={() => toggle('about')} aria-label="About and credits" aria-expanded={panel === 'about'}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M12 11v5.5M12 7.8v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
    </header>

    <div class="stage reveal">
      <Dial
        {stations}
        index={stationIndex}
        voices={es.voices}
        analyser={engine.analyser}
        {tuning}
        {reduced}
        orchestra={panel === 'orchestra'}
        bind:preview
        onTune={tune}
      />
      <div class="info">
        <h1 class="name" lang="en">{shownStation?.name}</h1>
        <p class="tagline">{shownStation?.tagline}</p>
        <p class="chips">
          <span>{MOODS[es.mood].label}</span>
          {#each techniques as t (t)}<span>{t}</span>{/each}
          {#if es.sleepEndsAt}<span class="sleep">Sleep · {formatRemaining(es.sleepEndsAt - now)}</span>{/if}
        </p>
      </div>
      <p class="caption" class:on={captionOn} aria-live="polite" aria-atomic="true">{captionText}</p>
    </div>

    <nav class="dock chrome" aria-label="Receiver controls">
      <button class:active={panel === 'hearing'} aria-expanded={panel === 'hearing'} onclick={() => toggle('hearing')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c2.5-5 6-5 9 0s6.500 5 9 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <span>What am I hearing?</span>
      </button>
      <button class:active={panel === 'orchestra'} aria-expanded={panel === 'orchestra'} onclick={() => toggle('orchestra')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="10" opacity=".6" /></g></svg>
        <span>Orchestra</span>
      </button>
      <button class:active={panel === 'mood'} aria-expanded={panel === 'mood'} onclick={() => toggle('mood')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.500A8 8 0 0 1 9.500 4 8 8 0 1 0 20 14.500z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
        <span>Mood &amp; timer</span>
      </button>
      <button onclick={share}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4l4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>Share</span>
      </button>
    </nav>
  </div>

  {#if panel === 'hearing'}
    <HearingPanel {es} {station} {now} onclose={() => (panel = null)} />
  {:else if panel === 'orchestra'}
    <Orchestra {es} onclose={() => (panel = null)} onnotice={say} />
  {:else if panel === 'mood'}
    <MoodPanel {es} {now} onclose={() => (panel = null)} />
  {:else if panel === 'about'}
    <About onclose={() => (panel = null)} />
  {/if}

  <p class="toast" class:on={notice !== ''} role="status">{notice}</p>
{/if}

<style>
  .app {
    position: fixed; inset: 0; z-index: 5;
    display: grid; grid-template-rows: auto 1fr auto;
    padding: var(--safe-t) var(--safe-r) 0 var(--safe-l);
    transition: padding 0.8s ease;
  }
  .top { display: flex; align-items: center; gap: 12px; padding: 10px 8px 0 20px; min-height: 56px; }
  .brand { font-family: var(--serif); font-size: 1.1rem; letter-spacing: 0.06em; color: var(--brass); flex: none; }
  .pulse { flex: 1; min-width: 0; font-family: var(--mono); font-size: 0.72rem; color: var(--ink-dim); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pulse i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: #d9a45a; vertical-align: 0; }
  .pulse.live i { background: #6fe0b4; box-shadow: 0 0 8px #6fe0b4; animation: breathe 5s ease-in-out infinite; }
  .icon { width: 44px; height: 44px; display: grid; place-items: center; background: none; border: 0; border-radius: 50%; color: var(--ink-dim); flex: none; }
  .icon:hover { color: var(--ink); }

  .stage {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    min-height: 0; padding: 4px 16px; position: relative;
    transform-origin: 50% 0; transition: transform 0.9s cubic-bezier(0.22, 0.8, 0.3, 1);
  }
  .reveal { animation: reveal 3.2s ease both; }
  .info { text-align: center; max-width: 560px; }
  .name { margin: 0; font-family: var(--serif); font-weight: 400; font-size: clamp(1.9rem, 7vw, 3rem); line-height: 1.1; text-shadow: 0 0 30px var(--accent-glow); }
  .tagline { margin: 6px 0 12px; font-family: var(--serif); font-style: italic; color: var(--ink-dim); font-size: clamp(0.95rem, 3.2vw, 1.1rem); }
  .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 0; }
  .chips span { font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--ink-dim); }
  .chips span:first-child { color: var(--accent-ink); border-color: var(--accent-soft); }
  .chips .sleep { color: var(--brass); border-color: var(--brass-dim); }

  .caption { position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%); width: min(92%, 520px); margin: 0; text-align: center; font-family: var(--serif); font-style: italic; font-size: 1.02rem; color: var(--ink); text-shadow: 0 0 14px #000; opacity: 0; transition: opacity 2.4s ease; pointer-events: none; min-height: 1.5em; }
  .caption.on { opacity: 0.95; }

  .dock { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 4px 8px calc(8px + var(--safe-b)); max-width: 640px; width: 100%; margin: 0 auto; }
  .dock button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 56px; padding: 6px 2px; background: none; border: 0; border-radius: 14px; color: var(--ink-dim); font-size: 0.7rem; line-height: 1.15; text-align: center; transition: color 0.4s, background 0.4s; }
  .dock button svg { width: 22px; height: 22px; }
  .dock button:hover, .dock button.active { color: var(--ink); }
  .dock button.active { background: hsl(var(--hue) 60% 50% / 0.16); color: var(--accent-ink); }

  .chrome { transition: opacity 2.2s ease; }
  .hidden .chrome { opacity: 0; pointer-events: none; }
  .hidden .tagline, .hidden .chips { opacity: 0.35; }
  .tagline, .chips { transition: opacity 2.2s ease; }

  /* Phones: lift and shrink the stage so the dial stays visible above an open sheet. */
  .sheet .stage { transform: scale(0.6); }
  @media (min-width: 900px) {
    .sheet { padding-right: 440px; }
    .sheet .stage { transform: none; }
  }

  .toast { position: fixed; left: 50%; bottom: calc(96px + var(--safe-b)); transform: translateX(-50%); margin: 0; padding: 10px 18px; max-width: min(90vw, 420px); border-radius: 999px; background: rgba(13, 11, 43, 0.92); border: 1px solid var(--accent-soft); font-size: 0.9rem; opacity: 0; transition: opacity 1.2s ease; pointer-events: none; z-index: 40; text-align: center; word-break: break-all; }
  .toast.on { opacity: 1; }

  @keyframes reveal { from { opacity: 0; filter: blur(8px); } to { opacity: 1; filter: none; } }
  @keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
</style>
