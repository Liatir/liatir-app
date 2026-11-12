<!--
  The two local model profiles Quenta offers. Choosing one is the explicit request that starts its
  download; nothing is downloaded by opening Quenta. A model chosen any other way stays selected.
-->
<script lang="ts">
  import { LIATIR_QUENTA_LOCAL_PROFILES } from '@liatir/core';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { quentaStore } from '$lib/stores/quenta.svelte';

  let { onchosen }: { onchosen?: () => void } = $props();

  let choosing = $state<string | null>(null);
  const busy = $derived(choosing !== null || quentaStore.providerRefreshing);

  function installed(model: string): boolean {
    return quentaStore.providerModels.some((item) => item.name === model);
  }

  async function choose(model: string) {
    choosing = model;
    try {
      await quentaStore.updateConfig({ model });
      await quentaStore.bootstrapProvider();
      onchosen?.();
    } finally {
      choosing = null;
    }
  }
</script>

<div class="space-y-2" data-testid="quenta-profile-picker">
  {#each LIATIR_QUENTA_LOCAL_PROFILES as profile (profile.id)}
    {@const active = quentaStore.config.model === profile.model}
    <div class="rounded-xl border p-3 text-left {active ? 'border-brand bg-brand/5' : 'border-border bg-surface'}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-text">{profile.label} · for {profile.memoryGb} GB of memory</p>
          <p class="mt-0.5 text-xs text-text-muted">
            {profile.name} · {installed(profile.model) ? 'downloaded' : `${profile.downloadGb.toFixed(1)} GB download`}
          </p>
        </div>
        {#if active}
          <Badge variant="brand" size="xs">In use</Badge>
        {:else}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            loading={choosing === profile.model}
            testId="quenta-profile-{profile.id}"
            onclick={() => choose(profile.model)}
          >
            {installed(profile.model) ? 'Use' : 'Download and use'}
          </Button>
        {/if}
      </div>
    </div>
  {/each}
  <p class="text-[11px] leading-relaxed text-text-muted">
    The model runs on this computer and works offline once downloaded. Pick the profile that matches
    your computer's memory; other running analyses also use memory.
  </p>
</div>
