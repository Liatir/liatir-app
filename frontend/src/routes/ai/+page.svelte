<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Badge, { type BadgeVariants } from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
  import { modelInstallBlock, type AIModelInstallBlock } from '$lib/ai/model-compatibility';
  import { aiModelLiatirDocsUrl, aiModelOfficialUrl } from '$lib/ai/model-docs';
  import { aiModelInfo } from '$lib/ai/model-help';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { fmtBytes, getLastSegmentsStringFromPath, openLinkInBrowser, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import type { LiatirAIModelRecord, LiatirAIModelRuntimePackage } from '@liatir/core';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';

  type ModelCategoryGroup = {
    name: string;
    models: LiatirAIModelRecord[];
    installedCount: number;
    runnableCount: number;
  };

  let loading = $state(!aiModelsStore.initialized);
  let expandedCategories = $state<Record<string, boolean>>({});
  let expandedModelDetails = $state<Record<string, boolean>>({});
  let searchQuery = $state('');

  onMount(() => {
    let cancelled = false;
    const firstLoad = !aiModelsStore.initialized;
    loading = firstLoad;

    (async () => {
      await aiModelsStore.init();
      const runtimeRefresh = aiModelsStore.ensureManagedRuntimeStatuses();
      void aiModelsStore.ensureHardwareInfo();
      if (!cancelled) {
        loading = false;
      }
      void runtimeRefresh;
    })();

    return () => {
      cancelled = true;
    };
  });

  const models = $derived(aiModelsStore.models);
  const runtimeChecks = $derived(aiModelsStore.runtimeChecks);
  const installing = $derived(aiModelsStore.installing);
  const installLogs = $derived(aiModelsStore.installLogs);
  const hardware = $derived(aiModelsStore.hardwareInfo);
  const hardwareInfoChecked = $derived(aiModelsStore.hardwareInfoChecked);
  const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
  const filteredModels = $derived(
    normalizedSearch
      ? models.filter((model) => modelSearchText(model).includes(normalizedSearch))
      : models
  );
  const installedCount = $derived(models.filter((model) => model.status === 'installed' && !runtimeChecks[model.id]).length);
  const runnableCount = $derived(aiModelsStore.runnableModels.length);
  const groupedModels = $derived(groupModelsByCategory(filteredModels));

  function statusVariant(status: LiatirAIModelRecord['status']): BadgeVariants {
    if (status === 'error') return 'failed';
    if (status === 'installed') return 'done';
    if (status === 'available') return 'brand';
    if (status === 'missing') return 'neutral';
    return 'failed';
  }

  function statusLabel(status: LiatirAIModelRecord['status']): string {
    if (status === 'installed') return 'installed';
    if (status === 'available' || status === 'missing') return 'not installed';
    if (status === 'error') return 'needs attention';
    return status;
  }

  function isCheckingModel(model: LiatirAIModelRecord): boolean {
    return runtimeChecks[model.id] === true
      || (Boolean(model.install?.hostRequirements) && !hardwareInfoChecked);
  }

  function modelStatusLabel(model: LiatirAIModelRecord): string {
    if (installing[model.id]) return 'installing';
    if (isCheckingModel(model)) return 'checking';
    return statusLabel(model.status);
  }

  function modelStatusVariant(model: LiatirAIModelRecord): BadgeVariants {
    if (installing[model.id] || isCheckingModel(model)) return 'running';
    return statusVariant(model.status);
  }

  function modelActionsLocked(model: LiatirAIModelRecord): boolean {
    return Boolean(installing[model.id]) || isCheckingModel(model);
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
      model.category,
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

  function modelCategory(model: LiatirAIModelRecord): string {
    return model.category?.trim() || 'Other';
  }

  function groupModelsByCategory(items: LiatirAIModelRecord[]): ModelCategoryGroup[] {
    const categoryOrder = [
      'Single-cell',
      'Genomics',
      'Predictive Genomics',
      'Protein Language Models',
      'Protein Structure',
      'Development Fixtures',
      'Other',
    ];
    const rank = new Map(categoryOrder.map((category, index) => [category, index]));
    const groups = new Map<string, LiatirAIModelRecord[]>();

    for (const model of items) {
      const category = modelCategory(model);
      groups.set(category, [...(groups.get(category) ?? []), model]);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || a.localeCompare(b))
      .map(([name, groupModels]) => ({
        name,
        models: groupModels,
        installedCount: groupModels.filter((model) => model.status === 'installed' && !runtimeChecks[model.id]).length,
        runnableCount: groupModels.filter((model) => model.enabled !== false && model.status === 'installed' && !runtimeChecks[model.id]).length,
      }));
  }

  function categoryDescription(category: string): string {
    if (category === 'Single-cell') return 'Cell annotation and AnnData workflows.';
    if (category === 'Genomics') return 'DNA/RNA embeddings, regulatory prediction, and variant scoring.';
    if (category === 'Predictive Genomics') return 'Long-context sequence models for regulatory signal and variant impact.';
    if (category === 'Protein Language Models') return 'Protein sequence embeddings and representation models.';
    if (category === 'Protein Structure') return 'Structure prediction and binding-oriented local runtimes.';
    if (category === 'Development Fixtures') return 'Internal models used to validate AI Tool contracts.';
    return 'Additional local AI Models.';
  }

  function isCategoryExpanded(category: string): boolean {
    if (normalizedSearch) return true;
    return expandedCategories[category] ?? false;
  }

  function toggleCategory(category: string) {
    expandedCategories = {
      ...expandedCategories,
      [category]: !isCategoryExpanded(category),
    };
  }

  function isModelDetailsExpanded(modelId: string): boolean {
    return expandedModelDetails[modelId] ?? false;
  }

  function toggleModelDetails(modelId: string) {
    expandedModelDetails = {
      ...expandedModelDetails,
      [modelId]: !isModelDetailsExpanded(modelId),
    };
  }

  function installBlock(model: LiatirAIModelRecord): AIModelInstallBlock | null {
    return modelInstallBlock(model, hardware);
  }

  function runtimePackages(model: LiatirAIModelRecord): LiatirAIModelRuntimePackage[] {
    return model.install?.runtimePackages ?? [];
  }

  function runtimePackageLabel(pkg: LiatirAIModelRuntimePackage): string {
    if (pkg.specifier && pkg.specifier !== pkg.package) return `${pkg.package}: ${pkg.specifier}`;
    if (pkg.version) return `${pkg.package} ${pkg.version}`;
    return pkg.package;
  }

  function runtimePackagesPreview(model: LiatirAIModelRecord): string {
    const packages = runtimePackages(model).map((pkg) => pkg.package);
    if (packages.length === 0) return 'No runtime packages';
    if (packages.length <= 3) return packages.join(', ');
    return `${packages.slice(0, 3).join(', ')} +${packages.length - 3}`;
  }

  function modelFilesLabel(model: LiatirAIModelRecord): string {
    const files = model.install?.files ?? [];
    if (files.length === 0) return 'No managed model files';
    return `${files.length} managed file${files.length === 1 ? '' : 's'}`;
  }

  function resolveInstallBlock(blocked: AIModelInstallBlock) {
    if (blocked.dependencyBinary) {
      goto(`/deps?focus=${encodeURIComponent(blocked.dependencyBinary)}`);
      return;
    }
    goto('/deps');
  }

  function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    return fallback;
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

  function toggleInstallLog(modelId: string) {
    aiModelsStore.toggleInstallLog(modelId);
  }

  function installLogState(modelId: string): { showLog: boolean; logLines: string[] } | null {
    const current = installing[modelId];
    if (current?.logLines.length) {
      return {
        showLog: current.showLog,
        logLines: current.logLines,
      };
    }
    const saved = installLogs[modelId];
    if (saved?.logLines.length) return saved;
    return null;
  }

  function logLineClass(line: string): string {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('failed')) return 'text-red-400';
    if (lower.includes('warning')) return 'text-red-400';
    return 'text-zinc-300';
  }

  async function installModel(model: LiatirAIModelRecord) {
    if (modelActionsLocked(model)) return;
    const blocked = installBlock(model);
    if (blocked) {
      toast.error(blocked.reason);
      return;
    }
    try {
      await aiModelsStore.installManagedModel(model.id);
      toast.success('AI Model installed');
    } catch (error) {
      const message = errorMessage(error, 'Failed to install AI Model');
      toast.error(message);
    }
  }

  async function removeModel(model: LiatirAIModelRecord) {
    if (modelActionsLocked(model)) return;
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
      toast.error(errorMessage(error, 'Failed to remove AI Model'));
    }
  }

  async function openModelDocs(model: LiatirAIModelRecord) {
    if (modelActionsLocked(model)) return;
    const url = aiModelLiatirDocsUrl(model);
    if (url) await openLinkInBrowser(url);
  }

  async function openOfficialModelPage(model: LiatirAIModelRecord) {
    if (modelActionsLocked(model)) return;
    const url = aiModelOfficialUrl(model);
    if (url) await openLinkInBrowser(url);
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

  <PageContent>

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
          {hardware ? `${hardware.cpuCores} CPU cores${hardware.totalMemoryBytes ? ` · ${fmtBytes(hardware.totalMemoryBytes)} RAM` : ''}${hardware.appleMetal ? ' · Apple Metal' : ''}${hardware.cudaAvailable ? ' · CUDA' : ''}${hardware.pythonVersion ? ` · ${hardware.pythonVersion}` : ''}` : 'Hardware detection unavailable'}
        </p>
      </div>
    </div>

    <div class="flex justify-center gap-2 items-center w-full cursor-default group">
      <div class="w-full h-px bg-zinc-200 group-hover:bg-zinc-300"></div>
      <div class="min-w-fit text-[11px] text-zinc-400 text-center group-hover:text-zinc-600">
        AI models are installed globally, therefore available to all workspaces
      </div>
      <div class="w-full h-px bg-zinc-200 group-hover:bg-zinc-300"></div>
    </div>

    <div class="space-y-3">
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <div class="relative max-w-md">
          <Icon icon="lucide:search" width="15" height="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            placeholder="Search AI Models..."
            data-testid="ai-models-search"
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

      {#if loading}
        <div class="border border-border bg-white rounded-lg flex flex-col gap-2 items-center justify-center px-4 py-8 text-center text-sm text-zinc-400"><Spinner class="text-zinc-300"/> <p>Loading AI Models...</p></div>
      {:else if models.length === 0}
        <div class="border border-border bg-white rounded-lg px-4 py-8 text-center text-sm text-zinc-400">No AI Models available.</div>
      {:else if filteredModels.length === 0}
        <div class="border border-border bg-white rounded-lg px-4 py-8 text-center text-sm text-zinc-400">No AI Models match your search.</div>
      {:else}
        {#each groupedModels as group (group.name)}
          {@const expanded = isCategoryExpanded(group.name)}
          <section class="border border-border bg-white rounded-lg overflow-hidden" data-testid="ai-model-category" data-category={group.name}>
            <button
              type="button"
              data-testid="ai-model-category-toggle"
              data-category={group.name}
              class="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
              aria-expanded={expanded}
              onclick={() => toggleCategory(group.name)}
            >
              <div class="flex min-w-0 items-start gap-3">
                <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500">
                  <Icon icon={expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'} width="15" height="15" />
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-sm font-semibold text-zinc-800">{group.name}</h2>
                    <Badge variant="neutral" size="xs" hideDot>{group.models.length} model{group.models.length === 1 ? '' : 's'}</Badge>
                    {#if group.installedCount > 0}
                      <Badge variant="done" size="xs">{group.installedCount} installed</Badge>
                    {/if}
                  </div>
                  <p class="mt-1 text-xs text-zinc-500">{categoryDescription(group.name)}</p>
                </div>
              </div>
              <div class="hidden shrink-0 items-center gap-2 text-xs text-zinc-500 sm:flex">
                <span>{group.runnableCount} runnable</span>
              </div>
            </button>

            {#if expanded}
              <div class="border-t border-border bg-surface/60 p-3">
                <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_250px] gap-3 px-3 py-2 text-[10px] font-semibold uppercase text-zinc-400 max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_250px]">
                  <span>Model</span>
                  <span class="max-xl:hidden">Runtime</span>
                  <span class="max-xl:hidden">Hardware</span>
                  <span>License</span>
                  <span class="text-right">Actions</span>
                </div>

                <div class="space-y-2">
                  {#each group.models as model (model.id)}
                    {@const blocked = installBlock(model)}
                    {@const installLog = installLogState(model.id)}
                    {@const checking = isCheckingModel(model)}
                    {@const actionsLocked = modelActionsLocked(model)}
                    <div class="rounded-lg border border-border bg-white">
                      <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_250px] gap-3 px-4 py-3 items-center max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_250px]">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2 min-w-0">
                            <p class="text-sm font-semibold text-zinc-800 truncate">{model.name}</p>
                            <span class="shrink-0">
                              <InfoPopup text={aiModelInfo(model)} />
                            </span>
                            <Badge variant={modelStatusVariant(model)} hideDot={!installing[model.id] && !checking} pulse={Boolean(installing[model.id]) || checking} size="xs">{modelStatusLabel(model)}</Badge>
                            {#if model.localOnly}
                              <Badge variant="neutral" size="xs" hideDot>local</Badge>
                            {/if}
                          </div>
                          <p class="mt-1 text-xs text-zinc-500 line-clamp-2">{model.description}</p>
                          {#if model.error && model.status === 'error'}
                            <p class="mt-1 text-[11px] text-red-500 line-clamp-2">{sanitizeLocalPathsForDisplay(model.error, 2)}</p>
                          {/if}
                          <div class="mt-2 flex flex-wrap gap-1.5">
                            {#each model.capabilities as capability}
                              <span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">{capability}</span>
                            {/each}
                          </div>
                          {#if blocked}
                            <div class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 xl:hidden">
                              <p class="font-semibold">{blocked.summary}</p>
                              <p class="mt-0.5">{blocked.reason}</p>
                              <div class="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  class="text-[11px] font-semibold text-amber-900 underline decoration-amber-300 underline-offset-2 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={actionsLocked}
                                  onclick={() => resolveInstallBlock(blocked)}
                                >
                                  {blocked.actionLabel ?? 'Open Dependencies'}
                                </button>
                                <details class="text-[10px] text-amber-700">
                                  <summary class="cursor-pointer">Technical details</summary>
                                  <div class="mt-1 space-y-0.5">
                                    {#each blocked.details as detail}
                                      <p>{sanitizeLocalPathsForDisplay(detail, 2)}</p>
                                    {/each}
                                  </div>
                                </details>
                              </div>
                            </div>
                          {/if}
                        </div>

                        <div class="text-xs text-zinc-600 min-w-0 max-xl:hidden">
                          <p class="truncate">{runtimeLabel(model)}</p>
                          <p class="text-[10px] text-zinc-400 truncate" title={model.localPath ? getLastSegmentsStringFromPath(model.localPath, 2) : undefined}>
                            {model.localPath ? getLastSegmentsStringFromPath(model.localPath, 2) : model.runtime.kind}
                          </p>
                          {#if runtimePackages(model).length > 0}
                            <p class="mt-1 text-[10px] text-zinc-400 truncate" title={runtimePackages(model).map(runtimePackageLabel).join(', ')}>
                              {runtimePackagesPreview(model)}
                            </p>
                          {/if}
                        </div>

                        <div class="text-xs text-zinc-600 min-w-0 max-xl:hidden">
                          <p class="truncate">{hardwareLabel(model)}</p>
                          {#if model.hardware?.notes}
                            <p class="text-[10px] text-zinc-400 truncate">{model.hardware.notes}</p>
                          {/if}
                          {#if blocked}
                            <div class="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
                              <p class="font-semibold">{blocked.summary}</p>
                              <p class="mt-0.5">{blocked.reason}</p>
                              <div class="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  class="font-semibold text-amber-900 underline decoration-amber-300 underline-offset-2 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={actionsLocked}
                                  onclick={() => resolveInstallBlock(blocked)}
                                >
                                  {blocked.actionLabel ?? 'Open Dependencies'}
                                </button>
                                <details class="text-[10px] text-amber-700">
                                  <summary class="cursor-pointer">Technical details</summary>
                                  <div class="mt-1 space-y-0.5">
                                    {#each blocked.details as detail}
                                      <p>{sanitizeLocalPathsForDisplay(detail, 2)}</p>
                                    {/each}
                                  </div>
                                </details>
                              </div>
                            </div>
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
                          <button
                            type="button"
                            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-surface-3)] text-zinc-500 transition-colors hover:bg-[var(--color-border-2)] hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--color-surface-3)] disabled:hover:text-zinc-500"
                            title={isModelDetailsExpanded(model.id) ? 'Hide model details' : 'Show model details'}
                            aria-label={isModelDetailsExpanded(model.id) ? 'Hide model details' : 'Show model details'}
                            aria-expanded={isModelDetailsExpanded(model.id)}
                            disabled={actionsLocked}
                            onclick={() => toggleModelDetails(model.id)}
                          >
                            <Icon icon={isModelDetailsExpanded(model.id) ? 'lucide:chevron-up' : 'lucide:list-tree'} width="14" height="14" />
                          </button>

                          {#if aiModelLiatirDocsUrl(model)}
                            <button
                              type="button"
                              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-surface-3)] text-zinc-500 transition-colors hover:bg-[var(--color-border-2)] hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--color-surface-3)] disabled:hover:text-zinc-500"
                              title="Open Liatir documentation"
                              aria-label="Open Liatir documentation"
                              disabled={actionsLocked}
                              onclick={() => openModelDocs(model)}
                            >
                              <Icon icon="lucide:book-open" width="14" height="14" />
                            </button>
                          {/if}

                          {#if aiModelOfficialUrl(model)}
                            <button
                              type="button"
                              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-surface-3)] text-zinc-500 transition-colors hover:bg-[var(--color-border-2)] hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--color-surface-3)] disabled:hover:text-zinc-500"
                              title="Open official model page"
                              aria-label="Open official model page"
                              disabled={actionsLocked}
                              onclick={() => openOfficialModelPage(model)}
                            >
                              <Icon icon="lucide:external-link" width="14" height="14" />
                            </button>
                          {/if}

                          {#if (model.source === 'managed-download' || model.source === 'managed-runtime') && model.status === 'installed' && !installing[model.id]}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={actionsLocked}
                              onclick={() => removeModel(model)}
                            >
                              Remove
                            </Button>
                          {:else}
                            <span></span>
                          {/if}

                          {#if !installing[model.id] && installLog}
                            <button
                              type="button"
                              onclick={() => toggleInstallLog(model.id)}
                              class="font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-600"
                            >
                              {installLog.showLog ? 'hide' : 'log'}
                            </button>
                          {/if}

                          {#if installing[model.id]}
                            {@const percent = installPercent(model)}
                            <div class="ml-auto min-w-0 w-full max-w-40">
                              <div class="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                                <span class="truncate">{installLabel(model)}</span>
                                {#if percent !== null}
                                  <span class="shrink-0 font-mono">{Math.round(percent)}%</span>
                                {/if}
                                {#if installing[model.id].logLines.length > 0}
                                  <button
                                    type="button"
                                    onclick={() => toggleInstallLog(model.id)}
                                    class="shrink-0 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-600"
                                  >
                                    {installing[model.id].showLog ? 'hide' : 'log'}
                                  </button>
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
                          {:else if checking}
                            <Button size="sm" variant="secondary" disabled>
                              Checking
                            </Button>
                          {:else if model.status === 'installed'}
                            <Button size="sm" variant="secondary" disabled={actionsLocked} onclick={() => goto(`/ai/${encodeURIComponent(model.id)}`)}>
                              Run
                            </Button>
                          {:else if model.install?.method === 'managed-download' || model.install?.method === 'managed-runtime'}
                            {#if blocked}
                              <Button size="sm" variant="secondary" disabled={actionsLocked} onclick={() => resolveInstallBlock(blocked)}>
                                Fix dependency
                              </Button>
                            {:else}
                              <Button size="sm" variant="primary" disabled={actionsLocked} onclick={() => installModel(model)}>
                                Install
                              </Button>
                            {/if}
                          {/if}
                        </div>
                      </div>

                      {#if installLog?.showLog && installLog.logLines.length > 0}
                        <div class="mx-4 mb-3 rounded-lg border border-border bg-zinc-950 px-3 py-2 max-h-40 overflow-y-auto">
                          {#each installLog.logLines as line}
                            <p class="text-[11px] font-mono leading-relaxed {logLineClass(line)}">{sanitizeLocalPathsForDisplay(line, 2)}</p>
                          {/each}
                        </div>
                      {/if}

                      {#if isModelDetailsExpanded(model.id)}
                        <div class="mx-4 mb-3 rounded-lg border border-border bg-zinc-50 px-3 py-3">
                          <div class="grid grid-cols-1 gap-3 text-xs text-zinc-600 md:grid-cols-3">
                            <div>
                              <p class="text-[10px] font-semibold uppercase text-zinc-400">Runtime box</p>
                              <p class="mt-1 font-medium text-zinc-800">{runtimeLabel(model)}</p>
                              <p class="mt-1 text-[11px] text-zinc-500">
                                Runtime packages are installed inside this AI Model environment, not as global Dependencies.
                              </p>
                            </div>

                            <div>
                              <p class="text-[10px] font-semibold uppercase text-zinc-400">Model files</p>
                              <p class="mt-1 font-medium text-zinc-800">{modelFilesLabel(model)}</p>
                              {#if model.diskSizeBytes}
                                <p class="mt-1 text-[11px] text-zinc-500">Approx. {fmtBytes(model.diskSizeBytes)} on disk.</p>
                              {/if}
                              {#if model.contextWindow}
                                <p class="mt-1 text-[11px] text-zinc-500">Context window: {model.contextWindow.toLocaleString()} tokens/bases.</p>
                              {/if}
                            </div>

                            <div>
                              <p class="text-[10px] font-semibold uppercase text-zinc-400">Host requirement</p>
                              {#if model.install?.hostRequirements?.python}
                                <p class="mt-1 font-medium text-zinc-800">{model.install.hostRequirements.python.label ?? 'Python runtime'}</p>
                              {:else if model.install?.hostRequirements?.requiresCuda}
                                <p class="mt-1 font-medium text-zinc-800">NVIDIA CUDA</p>
                              {:else}
                                <p class="mt-1 font-medium text-zinc-800">No special host runtime</p>
                              {/if}
                              {#if model.install?.hostRequirements?.python?.reason}
                                <p class="mt-1 text-[11px] text-zinc-500">{model.install.hostRequirements.python.reason}</p>
                              {/if}
                            </div>
                          </div>

                          {#if runtimePackages(model).length > 0}
                            <div class="mt-3 border-t border-border pt-3">
                              <p class="text-[10px] font-semibold uppercase text-zinc-400">Runtime packages</p>
                              <div class="mt-2 flex flex-wrap gap-1.5">
                                {#each runtimePackages(model) as pkg}
                                  <span class="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500" title={runtimePackageLabel(pkg)}>
                                    {pkg.package}
                                  </span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </section>
        {/each}
      {/if}
    </div>

    {#if workspaceStore.isSandboxMode}
      <div class="border border-border bg-white rounded-lg px-4 py-3 flex items-start gap-3">
        <div class="h-8 w-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
          <Icon icon="mingcute:ai-line" width="17" height="17" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-zinc-800">AI Tools</p>
          <p class="mt-1 text-xs text-zinc-500">
            The sandbox workplace includes a mock AI Tool that emits a response and provenance values.
          </p>
        </div>
      </div>
    {/if}
  </div>
  </PageContent>
</div>
