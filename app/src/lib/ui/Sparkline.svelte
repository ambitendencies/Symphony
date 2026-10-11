<script lang="ts">
  import { sparklinePoints } from './helpers';
  let { series, color, label }: { series?: number[]; color: string; label: string } = $props();
  const W = 120;
  const H = 28;
  const pts = $derived(sparklinePoints(series, W, H));
</script>

{#if pts}
  <svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label={label} class="spark">
    <polyline points={pts} fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
  </svg>
{/if}

<style>
  .spark { display: block; max-width: 100%; opacity: 0.95; }
</style>
