<script lang="ts">
  import { onMount } from 'svelte';
  import type { LiatirQuentaPresentation } from '@liatir/core';
  import { mountPresentation } from '$lib/quenta/presentations';
  let { presentation }: { presentation: LiatirQuentaPresentation } = $props();
  let frame: HTMLIFrameElement;
  let error = $state('');
  let ready = $state(false);
  onMount(() => mountPresentation(frame, presentation, () => ready = true, message => error = message));
</script>
<div class="space-y-2">
  <p class="text-xs text-text-muted">
    AI-generated presentation · {presentation.sources.length ? `${presentation.sources.length} selected Results` : 'general topic, no Results used'} · Local and offline
  </p>
  {#if error}<p class="text-sm text-error">{error}</p>{:else if !ready}<p class="text-sm text-text-muted">Opening presentation…</p>{/if}
  <iframe bind:this={frame} sandbox="allow-scripts" title={presentation.title} class="w-full h-[650px] rounded-xl border border-border bg-white"></iframe>
</div>
