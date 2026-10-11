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
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
    </button>
  </header>
  <div class="body">{@render children()}</div>
</div>

<style>
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
    margin: 0 auto; width: min(100%, 720px);
    max-height: min(62vh, 640px);
    display: flex; flex-direction: column;
    background: linear-gradient(180deg, rgba(20, 17, 58, 0.94), var(--panel));
    border: 1px solid var(--line); border-bottom: 0;
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.55), 0 -1px 0 hsl(var(--hue) 70% 60% / 0.3);
    backdrop-filter: blur(14px);
    padding-bottom: var(--safe-b);
    animation: rise 0.7s cubic-bezier(0.22, 0.8, 0.3, 1) both;
  }
  @keyframes rise { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (min-width: 900px) {
    .sheet { left: auto; right: 0; top: 0; width: 440px; max-height: none; margin: 0; border-radius: 0; border: 0; border-left: 1px solid var(--line); animation-name: slide; }
    .grab { display: none; }
    header { padding-top: calc(12px + var(--safe-t)); }
  }
  @keyframes slide { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
  .grab { width: 40px; height: 4px; border-radius: 4px; background: var(--line); margin: 8px auto 0; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 4px 20px; }
  h2 { margin: 0; font-family: var(--serif); font-weight: 500; font-size: 1.25rem; letter-spacing: 0.01em; }
  .close { width: 44px; height: 44px; display: grid; place-items: center; background: none; border: 0; border-radius: 50%; color: var(--ink-dim); }
  .close:hover { color: var(--ink); background: rgba(255, 255, 255, 0.06); }
  .body { overflow-y: auto; padding: 4px 20px 20px; overscroll-behavior: contain; }
</style>
