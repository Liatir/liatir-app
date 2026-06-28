<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Badge, { type BadgeVariants } from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { fmtBytes } from '$lib/utils';
  import type { LiatirAIModelRecord } from '@liatir/core';

  let loading = $state(true);
  let installing = $state<Record<string, {
    fileIndex: number;
    fileCount: number;
    bytesDownloaded: number;
    bytesTotal: number | null;
  }>>({});

  onMount(async () => {
    await aiModelsStore.init();
    loading = false;
  });

  const models = $derived(aiModelsStore.models);
  const defaultModel = $derived(aiModelsStore.defaultModel);
  const installedCount = $derived(models.filter((model) => model.status === 'installed').length);
  const runnableCount = $derived(aiModelsStore.runnableModels.length);

  function statusVariant(status: LiatirAIModelRecord['status']): BadgeVariants {
    if (status === 'installed') return 'done';
    if (status === 'available') return 'available';
    if (status === 'missing') return 'missing';
    return 'failed';
  }

  function hardwareLabel(model: LiatirAIModelRecord): string {
    const parts: string[] = [];
    if (model.hardware?.recommendedRamGb != null) parts.push(`${model.hardware.recommendedRamGb} GB RAM`);
    if (model.hardware?.recommendedVramGb != null) parts.push(`${model.hardware.recommendedVramGb} GB VRAM`);
    if (model.hardware?.gpu === false) parts.push('CPU');
    if (model.hardware?.gpu === true) parts.push('GPU');
    return parts.join(' / ') || 'Unspecified';
  }

  function runtimeLabel(model: LiatirAIModelRecord): string {
    return `${model.runtime.name}${model.runtime.version ? ` ${model.runtime.version}` : ''}`;
  }

  function installLabel(model: LiatirAIModelRecord): string {
    const progress = installing[model.id];
    if (!progress) return 'Install';
    const file = `File ${progress.fileIndex + 1}/${progress.fileCount}`;
    const bytes = progress.bytesTotal
      ? `${fmtBytes(progress.bytesDownloaded)} / ${fmtBytes(progress.bytesTotal)}`
      : fmtBytes(progress.bytesDownloaded);
    return `${file} · ${bytes}`;
  }

  async function installModel(model: LiatirAIModelRecord) {
    installing = {
      ...installing,
      [model.id]: { fileIndex: 0, fileCount: model.install?.files?.length ?? 1, bytesDownloaded: 0, bytesTotal: null },
    };
    try {
      await aiModelsStore.installManagedModel(model.id, (progress) => {
        installing = { ...installing, [model.id]: progress };
      });
      toast.success('AI Model installed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to install AI Model');
    } finally {
      const { [model.id]: _done, ...rest } = installing;
      installing = rest;
    }
  }

  async function removeModel(model: LiatirAIModelRecord) {
    try {
      await aiModelsStore.removeManagedModel(model.id);
      toast.info('AI Model removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove AI Model');
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PageHeader title="AI Models" description="Local model registry for pipeline AI Tools">
    {#snippet actions()}
      <Button size="sm" variant="secondary" onclick={() => goto('/pipeline')}>
        <Icon icon="lucide:workflow" width="14" height="14" />
        Pipeline
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6 space-y-5">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Default model</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800 truncate">{defaultModel?.name ?? 'None'}</p>
      </div>
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Installed</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">{installedCount} model{installedCount === 1 ? '' : 's'}</p>
      </div>
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Runnable</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">{runnableCount} model{runnableCount === 1 ? '' : 's'}</p>
      </div>
    </div>

    <div class="border border-border bg-white rounded-lg overflow-hidden">
      <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_150px] gap-3 px-4 py-2.5 border-b border-border bg-surface text-[10px] font-semibold uppercase text-zinc-400 max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_150px]">
        <span>Model</span>
        <span class="max-xl:hidden">Runtime</span>
        <span class="max-xl:hidden">Hardware</span>
        <span>License</span>
        <span class="text-right">Default</span>
      </div>

      {#if loading}
        <div class="px-4 py-8 text-center text-sm text-zinc-400">Loading AI Models...</div>
      {:else if models.length === 0}
        <div class="px-4 py-8 text-center text-sm text-zinc-400">No AI Models available.</div>
      {:else}
        {#each models as model (model.id)}
          <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_150px] gap-3 px-4 py-3 border-b border-border/70 last:border-b-0 items-center max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_150px]">
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <p class="text-sm font-semibold text-zinc-800 truncate">{model.name}</p>
                <Badge variant={statusVariant(model.status)} size="xs">{installing[model.id] ? 'installing' : model.status}</Badge>
                {#if model.localOnly}
                  <Badge variant="brand" size="xs" hideDot>local</Badge>
                {/if}
              </div>
              <p class="mt-1 text-xs text-zinc-500 line-clamp-2">{model.description}</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                {#each model.capabilities as capability}
                  <span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">{capability}</span>
                {/each}
              </div>
            </div>

            <div class="text-xs text-zinc-600 min-w-0 max-xl:hidden">
              <p class="truncate">{runtimeLabel(model)}</p>
              <p class="text-[10px] text-zinc-400 truncate">{model.localPath ?? model.runtime.kind}</p>
            </div>

            <div class="text-xs text-zinc-600 min-w-0 max-xl:hidden">
              <p class="truncate">{hardwareLabel(model)}</p>
              {#if model.hardware?.notes}
                <p class="text-[10px] text-zinc-400 truncate">{model.hardware.notes}</p>
              {/if}
            </div>

            <div class="text-xs text-zinc-600 min-w-0">
              <p class="truncate">{model.license?.name ?? 'Unspecified'}</p>
              {#if model.license?.verifiedAt}
                <p class="text-[10px] text-zinc-400">Verified {model.license.verifiedAt}</p>
              {:else}
                <p class="text-[10px] text-zinc-400">Verification required</p>
              {/if}
            </div>

            <div class="flex justify-end gap-1.5">
              {#if installing[model.id]}
                <Button size="sm" variant="secondary" loading>
                  {installLabel(model)}
                </Button>
              {:else if model.status !== 'installed' && model.install?.method === 'managed-download'}
                <Button size="sm" variant="primary" onclick={() => installModel(model)}>
                  Install
                </Button>
              {:else if model.isDefault}
                <Badge variant="done" size="xs">default</Badge>
              {:else}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={model.enabled === false || model.status === 'missing' || model.status === 'error'}
                  onclick={() => aiModelsStore.setDefault(model.id)}
                >
                  Set
                </Button>
              {/if}
              {#if model.source === 'managed-download' && model.status === 'installed' && !installing[model.id]}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => removeModel(model)}
                >
                  Remove
                </Button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="border border-border bg-white rounded-lg px-4 py-3 flex items-start gap-3">
      <div class="h-8 w-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
        <Icon icon="mingcute:ai-line" width="17" height="17" />
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-zinc-800">AI Tools</p>
        <p class="mt-1 text-xs text-zinc-500">
          The pipeline catalog includes a mock AI Tool that uses the selected AI Model and emits response and provenance values.
        </p>
      </div>
    </div>
  </div>
</div>
