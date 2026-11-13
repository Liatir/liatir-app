<!--
  A saved Stage page, running in its isolated frame. `fill` makes it take the whole height of its
  container, as on the presentations stage; elsewhere (a Result) it has a fixed height.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { LiatirQuentaPresentation } from '@liatir/core';
  import { mountPresentation } from '$lib/quenta/presentations';

  let { presentation, fill = false }: { presentation: LiatirQuentaPresentation; fill?: boolean } = $props();
  let frame: HTMLIFrameElement;
  let error = $state('');
  let ready = $state(false);
  onMount(() => mountPresentation(frame, presentation, () => ready = true, (failure) => error = failure.message));
</script>

<div class={fill ? 'flex h-full flex-col gap-2' : 'space-y-2'} data-testid="quenta-presentation" data-state={error ? 'error' : ready ? 'ready' : 'opening'}>
  <p class="text-xs text-text-muted">
    AI-generated Stage page · {presentation.sources.length ? `${presentation.sources.length} selected Results` : 'general topic, no Results used'} · Local and offline
  </p>
  {#if error}<p class="text-sm text-error">{error}</p>{:else if !ready}<p class="text-sm text-text-muted">Opening the page…</p>{/if}
  <iframe
    bind:this={frame}
    sandbox="allow-scripts"
    title={presentation.title}
    class="w-full rounded-xl border border-border bg-white {fill ? 'min-h-[420px] flex-1' : 'h-[650px]'}"
  ></iframe>
</div>
