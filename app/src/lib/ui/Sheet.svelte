<script lang="ts">
  /** Bottom sheet. Non-modal dialog: Escape and the close button dismiss it; focus moves in and returns. */
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  let closeBtn: HTMLButtonElement;
  let opener: Element | null = null;

  onMount(() => {
    opener = document.activeElement;
    closeBtn?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<div class="sheet" role="dialog" aria-label={title} tabindex="-1" {onkeydown}>
  <div class="grab" aria-hidden="true"></div>
  <header>
    <h2>{title}</h2>
    <button bind:this={closeBtn} class="close" onclick={onclose} aria-label="Close {title}">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" /></svg>
    </button>
  </header>
  <div class="body">{@render children()}</div>
</div>

<style>
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: var(--z-sheet);
    margin: 0 auto; width: min(100%, 720px);
    max-height: min(64dvh, 660px);
    display: flex; flex-direction: column;
    background: var(--panel);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    /* glass edge: 1px inner border + soft top highlight, tinted shadow */
    box-shadow: var(--shadow-lg), inset 0 1px 0 hsl(222 30% 90% / 0.08), inset 0 0 0 1px var(--line);
    backdrop-filter: blur(18px) saturate(1.1);
    padding-bottom: var(--safe-b);
    animation: rise 0.6s var(--ease-out) both;
  }
  @keyframes rise { from { transform: translateY(36px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (min-width: 900px) {
    .sheet { left: auto; right: 0; top: 0; width: 440px; max-height: none; margin: 0; border-radius: 0; box-shadow: var(--shadow-lg), inset 1px 0 0 var(--line-strong); animation-name: slide; }
    .grab { display: none; }
    header { padding-top: calc(16px + var(--safe-t)); }
  }
  @keyframes slide { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
  .grab { width: 36px; height: 4px; border-radius: 4px; background: var(--line-strong); margin: 10px auto 0; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px 6px 24px; }
  h2 { margin: 0; font-family: var(--serif); font-weight: 560; font-size: 1.45rem; letter-spacing: -0.02em; line-height: 1.15; }
  .close { width: 44px; height: 44px; display: grid; place-items: center; background: none; border: 0; border-radius: var(--r-sm); color: var(--ink-dim); transition: color var(--t-fast) ease, background var(--t-fast) ease, transform var(--t-fast) var(--ease-spring); }
  .close:hover { color: var(--ink); background: var(--surface-2); }
  .close:active { transform: scale(0.94); }
  .body { overflow-y: auto; padding: 6px 24px 28px; overscroll-behavior: contain; scroll-behavior: smooth; }
</style>
