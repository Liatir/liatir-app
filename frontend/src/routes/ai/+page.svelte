<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Badge, { type BadgeVariants } from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { getAIHardwareInfo, type AIHardwareInfo } from '$lib/ai/runtime';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { fmtBytes } from '$lib/utils';
  import type { LiatirAIModelRecord } from '@liatir/core';
  import Spinner from '$lib/components/ui/Spinner.svelte';

  let loading = $state(true);
  let installing = $state<Record<string, {
    phase?: 'preparing-runtime' | 'installing-packages' | 'downloading-model' | 'downloading-files';
    fileIndex: number;
    fileCount: number;
    bytesDownloaded: number;
    bytesTotal: number | null;
    message?: string;
  }>>({});
  let hardware = $state<AIHardwareInfo | null>(null);
  let searchQuery = $state('');

  onMount(async () => {
    await aiModelsStore.init();
    await aiModelsStore.refreshManagedRuntimeStatuses();
    hardware = await getAIHardwareInfo().catch(() => null);
    loading = false;
  });

  const models = $derived(aiModelsStore.models);
  const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
  const filteredModels = $derived(
    normalizedSearch
      ? models.filter((model) => modelSearchText(model).includes(normalizedSearch))
      : models
  );
  const installedCount = $derived(models.filter((model) => model.status === 'installed').length);
  const runnableCount = $derived(aiModelsStore.runnableModels.length);

  function statusVariant(status: LiatirAIModelRecord['status']): BadgeVariants {
    if (status === 'error') return 'failed';
    if (status === 'installed') return 'done';
    if (status === 'available') return 'brand';
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

  function modelSearchText(model: LiatirAIModelRecord): string {
    return [
      model.name,
      model.id,
      model.description,
      model.version,
      model.runtime.name,
      model.runtime.kind,
      model.runtime.version,
      model.source,
      model.status,
      model.license?.name,
      model.license?.spdxId,
      ...(model.capabilities ?? []),
      ...(model.modalities ?? []),
      ...(model.tags ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function installLabel(model: LiatirAIModelRecord): string {
    const progress = installing[model.id];
    if (!progress) return 'Install';
    if (progress.message) return progress.message;
    const file = `File ${progress.fileIndex + 1}/${progress.fileCount}`;
    const bytes = progress.bytesTotal
      ? `${fmtBytes(progress.bytesDownloaded)} / ${fmtBytes(progress.bytesTotal)}`
      : fmtBytes(progress.bytesDownloaded);
    return `${file} · ${bytes}`;
  }

  function installPercent(model: LiatirAIModelRecord): number | null {
    const progress = installing[model.id];
    if (!progress?.bytesTotal || progress.bytesTotal <= 0) return null;
    return Math.max(0, Math.min(100, (progress.bytesDownloaded / progress.bytesTotal) * 100));
  }

  async function installModel(model: LiatirAIModelRecord) {
    installing = {
      ...installing,
      [model.id]: {
        phase: model.install?.method === 'managed-runtime' ? 'preparing-runtime' : 'downloading-files',
        fileIndex: 0,
        fileCount: model.install?.files?.length ?? 1,
        bytesDownloaded: 0,
        bytesTotal: null,
        message: model.install?.method === 'managed-runtime' ? 'Preparing runtime' : undefined,
      },
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
    const ok = await confirm({
      title: 'Remove AI Model',
      message: `Remove "${model.name}" from this device? The model can be installed again later.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;

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
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Installed</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">{installedCount} model{installedCount === 1 ? '' : 's'}</p>
      </div>
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Runnable</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">{runnableCount} model{runnableCount === 1 ? '' : 's'}</p>
      </div>
      <div class="border border-border bg-white rounded-lg px-4 py-3 md:col-span-2">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Host runtime</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">
          {hardware ? `${hardware.cpuCores} CPU cores${hardware.totalMemoryBytes ? ` · ${fmtBytes(hardware.totalMemoryBytes)} RAM` : ''}${hardware.appleMetal ? ' · Apple Metal' : ''}${hardware.cudaAvailable ? ' · CUDA' : ''}` : 'Hardware detection unavailable'}
        </p>
      </div>
    </div>

    <div class="flex justify-center gap-2 items-center w-full cursor-default group">
      <div class="w-full h-px bg-zinc-200 group-hover:bg-zinc-300"></div>
      <div class="min-w-fit text-[11px] text-zinc-400 text-center group-hover:text-zinc-600">
        AI models are installed globally for all workspaces
      </div>
      <div class="w-full h-px bg-zinc-200 group-hover:bg-zinc-300"></div>
    </div>


    <div class="border border-border bg-white rounded-lg overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-white">
        <div class="relative max-w-md">
          <Icon icon="lucide:search" width="15" height="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            placeholder="Search AI Models..."
            class="h-9 w-full rounded-md border border-border bg-white pl-9 pr-9 text-sm text-zinc-700 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand focus:ring-2 focus:ring-brand/10"
            oninput={(event) => searchQuery = (event.target as HTMLInputElement).value}
          />
          {#if searchQuery}
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              aria-label="Clear AI Models search"
              onclick={() => searchQuery = ''}
            >
              <Icon icon="lucide:x" width="14" height="14" />
            </button>
          {/if}
        </div>
      </div>

      <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_210px] gap-3 px-4 py-2.5 border-b border-border bg-surface text-[10px] font-semibold uppercase text-zinc-400 max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_210px]">
        <span>Model</span>
        <span class="max-xl:hidden">Runtime</span>
        <span class="max-xl:hidden">Hardware</span>
        <span>License</span>
        <span class="text-right">Actions</span>
      </div>

      {#if loading}
        <div class="flex flex-col gap-2 items-center justify-center px-4 py-8 text-center text-sm text-zinc-400"><Spinner class="text-zinc-300"/> <p>Loading AI Models...</p></div>
      {:else if models.length === 0}
        <div class="px-4 py-8 text-center text-sm text-zinc-400">No AI Models available.</div>
      {:else if filteredModels.length === 0}
        <div class="px-4 py-8 text-center text-sm text-zinc-400">No AI Models match your search.</div>
      {:else}
        {#each filteredModels as model (model.id)}
          <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_210px] gap-3 px-4 py-3 border-b border-border/70 last:border-b-0 items-center max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_210px]">
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <p class="text-sm font-semibold text-zinc-800 truncate">{model.name}</p>
                <Badge variant={installing[model.id]?'running':statusVariant(model.status)} hideDot={!installing[model.id]} pulse={installing[model.id]?true:false} size="xs">{installing[model.id] ? 'installing' : model.status}</Badge>
                {#if model.localOnly}
                  <Badge variant="neutral" size="xs" hideDot>local</Badge>
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

            <div class="flex items-center justify-end gap-2 min-w-0">
              {#if (model.source === 'managed-download' || model.source === 'managed-runtime') && model.status === 'installed' && !installing[model.id]}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => removeModel(model)}
                >
                  Remove
                </Button>
              {:else}
                <span></span>
              {/if}

              {#if installing[model.id]}
                {@const percent = installPercent(model)}
                <div class="ml-auto min-w-0 w-full max-w-40">
                  <div class="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                    <span class="truncate">{installLabel(model)}</span>
                    {#if percent !== null}
                      <span class="shrink-0 font-mono">{Math.round(percent)}%</span>
                    {/if}
                  </div>
                  <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                    {#if percent !== null}
                      <div class="h-full rounded-full bg-brand transition-[width]" style={`width: ${percent}%`}></div>
                    {:else}
                      <div class="h-full w-1/2 rounded-full bg-brand/70 animate-pulse"></div>
                    {/if}
                  </div>
                </div>
              {:else if model.status === 'installed'}
                <Button size="sm" variant="secondary" onclick={() => goto(`/ai/${encodeURIComponent(model.id)}`)}>
                  Run
                </Button>
              {:else if model.install?.method === 'managed-download' || model.install?.method === 'managed-runtime'}
                <Button size="sm" variant="primary" onclick={() => installModel(model)}>
                  Install
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
