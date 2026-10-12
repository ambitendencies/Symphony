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
  const shownIndex = $derived(preview ?? stationIndex);
  const hue = $derived(shownStation?.hue ?? 36);
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

<a class="skip" href="#controls">Skip to controls</a>
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
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M12 11v5.5M12 7.8v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
    </header>

    <main class="stage reveal" id="main">
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
      <section class="info" aria-label="Now playing">
        <p class="label kicker">
          {tuning ? 'Tuning' : 'Now tuned'}<span class="num count">{String(shownIndex + 1).padStart(2, '0')} / {String(stations.length).padStart(2, '0')}</span>
        </p>
        <h1 class="name" lang="en">{shownStation?.name}</h1>
        <p class="tagline">{shownStation?.tagline}</p>
        <dl class="facts">
          <div><dt class="label">Mood</dt><dd>{MOODS[es.mood].label}</dd></div>
          <div><dt class="label">Made by</dt><dd>{techniques.length ? techniques.join(' + ') : '—'}</dd></div>
          <div><dt class="label">Voices</dt><dd class="num">{es.voices.length || '—'}</dd></div>
          {#if es.sleepEndsAt}<div class="sleep"><dt class="label">Sleep in</dt><dd class="num">{formatRemaining(es.sleepEndsAt - now)}</dd></div>{/if}
        </dl>
      </section>
      <p class="caption" class:on={captionOn} aria-live="polite" aria-atomic="true">{captionText}</p>
    </main>

    <nav class="dock chrome" id="controls" aria-label="Receiver controls">
      <button class:active={panel === 'hearing'} aria-expanded={panel === 'hearing'} onclick={() => toggle('hearing')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c2.5-5 6-5 9 0s6.5 5 9 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
        <span>What am I hearing?</span>
      </button>
      <button class:active={panel === 'orchestra'} aria-expanded={panel === 'orchestra'} onclick={() => toggle('orchestra')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="10" opacity=".6" /></g></svg>
        <span>Orchestra</span>
      </button>
      <button class:active={panel === 'mood'} aria-expanded={panel === 'mood'} onclick={() => toggle('mood')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
        <span>Mood &amp; timer</span>
      </button>
      <button onclick={share}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4l4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
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
    position: fixed; inset: 0; z-index: var(--z-app);
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
    padding: var(--safe-t) var(--safe-r) 0 var(--safe-l);
  }
  .top { display: flex; align-items: center; gap: 16px; width: 100%; max-width: 1320px; margin: 0 auto; padding: 12px 10px 0 24px; min-height: 60px; }
  .brand { font-family: var(--serif); font-weight: 600; font-size: 1.12rem; letter-spacing: -0.01em; flex: none; }
  .pulse { flex: 1; min-width: 0; font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 0.74rem; color: var(--ink-dim); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pulse i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 8px; border: 1px solid var(--ink-faint); vertical-align: 1px; }
  .pulse.live i { border: 0; background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: breathe 5s ease-in-out infinite; }
  .icon { width: 44px; height: 44px; display: grid; place-items: center; background: none; border: 0; border-radius: var(--r-sm); color: var(--ink-dim); flex: none; transition: color var(--t-fast) ease, background var(--t-fast) ease, transform var(--t-fast) var(--ease-spring); }
  .icon:hover { color: var(--ink); background: var(--surface-2); }
  .icon:active { transform: scale(0.94); }

  /* Phone: dial on top, details left-aligned beneath. Desktop: details left, dial right. */
  .stage {
    display: grid; grid-template-rows: auto auto; align-content: center; justify-items: center; gap: 28px;
    width: 100%; max-width: 1320px; margin: 0 auto; min-height: 0;
    padding: 4px 24px 8px; position: relative;
    transform-origin: 50% 0; transition: transform 0.9s var(--ease-out), opacity 0.9s ease;
  }
  .reveal { animation: reveal 2.6s var(--ease-out) both; }
  .info { justify-self: stretch; max-width: 34rem; }
  .kicker { display: flex; align-items: baseline; gap: 10px; margin: 0 0 6px; color: var(--accent-ink); }
  .count { font-size: 0.72rem; font-variant-caps: normal; letter-spacing: 0.02em; color: var(--ink-faint); }
  .name {
    margin: 0; font-family: var(--serif); font-weight: 560; font-variation-settings: 'opsz' 120;
    font-size: clamp(2.3rem, 9.5vw, 4.6rem); line-height: 0.95; letter-spacing: -0.03em;
  }
  .tagline { margin: 10px 0 18px; max-width: 32ch; font-family: var(--serif); font-style: italic; font-weight: 380; color: var(--ink-dim); font-size: clamp(1rem, 3.4vw, 1.2rem); line-height: 1.45; }
  .facts { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0; }
  .facts div { display: grid; gap: 1px; }
  .facts dt { font-size: 0.74rem; }
  .facts dd { margin: 0; font-size: 0.92rem; font-weight: 500; color: var(--ink); }
  .facts .sleep dd { color: var(--accent-ink); }

  .caption { position: absolute; left: 24px; right: 24px; bottom: 4px; margin: 0 auto; max-width: 34rem; text-align: center; font-family: var(--serif); font-style: italic; font-size: 1.05rem; color: var(--ink); text-shadow: 0 0 18px var(--bg); opacity: 0; transform: translateY(6px); transition: opacity 2.4s ease, transform 2.4s var(--ease-out); pointer-events: none; min-height: 1.5em; }
  .caption.on { opacity: 0.95; transform: none; }

  .dock { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; width: 100%; max-width: 640px; margin: 0 auto; padding: 6px 12px calc(10px + var(--safe-b)); }
  .dock button {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    min-height: 58px; padding: 6px 2px; background: none; border: 0; border-radius: var(--r-md);
    color: var(--ink-dim); font-size: 0.74rem; font-weight: 500; line-height: 1.15; text-align: center;
    transition: color var(--t-fast) ease, background var(--t-fast) ease, transform var(--t-fast) var(--ease-spring);
  }
  .dock button svg { width: 22px; height: 22px; }
  .dock button:hover { color: var(--ink); background: var(--surface-2); }
  .dock button:active { transform: scale(0.96); }
  .dock button.active { color: var(--accent-ink); background: var(--accent-wash); box-shadow: inset 0 0 0 1px var(--accent-soft); }

  .chrome { transition: opacity 2.2s ease; }
  .hidden .chrome { opacity: 0; pointer-events: none; }
  .hidden .tagline, .hidden .facts { opacity: 0.3; }
  .tagline, .facts { transition: opacity 2.2s ease; }

  /* Phones: shrink the stage (transform only) so the dial stays visible above an open sheet. */
  .sheet .stage { transform: scale(0.6); }
  .sheet .info { opacity: 0; }
  .info { transition: opacity 0.6s ease; }

  @media (min-width: 900px) {
    .stage { grid-template-columns: minmax(18rem, 0.85fr) minmax(0, 1.15fr); grid-template-rows: none; align-items: center; justify-items: start; gap: 48px; padding: 0 56px 24px; }
    .stage :global(.dial) { grid-column: 2; grid-row: 1; justify-self: center; }
    .info { grid-column: 1; grid-row: 1; padding-bottom: 6vh; }
    .caption { left: 56px; right: auto; bottom: 24px; text-align: left; margin: 0; }
    .dock { margin: 0 0 0 max(44px, calc((100vw - 1320px) / 2 + 44px)); max-width: 560px; }
    /* Drawer open: slide the whole stage left with a transform rather than animating layout. */
    .sheet .stage { transform: translateX(-220px) scale(0.88); }
    .sheet .info { opacity: 0; }
  }

  .toast { position: fixed; left: 50%; bottom: calc(100px + var(--safe-b)); transform: translateX(-50%) translateY(8px); margin: 0; padding: 12px 18px; max-width: min(90vw, 420px); border-radius: var(--r-md); background: var(--panel); box-shadow: var(--shadow-lg), inset 0 0 0 1px var(--line-strong); font-size: 0.9rem; opacity: 0; transition: opacity 0.5s ease, transform 0.5s var(--ease-out); pointer-events: none; z-index: var(--z-toast); text-align: center; overflow-wrap: anywhere; }
  .toast.on { opacity: 1; transform: translateX(-50%); }

  /* `translate`, not `transform`: a held animation would otherwise override the sheet's stage transform. */
  @keyframes reveal { from { opacity: 0; translate: 0 12px; } to { opacity: 1; translate: none; } }
  @keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
</style>
