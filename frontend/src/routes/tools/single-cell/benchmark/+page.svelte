<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { LIATIR_SINGLE_CELL_STUDY_ID, LIATIR_SINGLE_CELL_STUDY_DATASETS, LIATIR_SINGLE_CELL_STUDY_METHODS,
    type LiatirSingleCellStudyDataset, type LiatirSingleCellStudyMethod,
    type LiatirSingleCellStudyRequest } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { launchSingleCellStudy } from '$lib/showcases/single-cell-study';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { liatir } from '$lib/api';

  let dataset = $state<LiatirSingleCellStudyDataset>('pbmc');
  let methods = $state<LiatirSingleCellStudyMethod[]>(LIATIR_SINGLE_CELL_STUDY_METHODS.map((m) => m.id));
  let launching = $state(false);
  let stabilityCheck = $state(true);
  let error = $state('');
  let importStudyFile = $state('');
  const runs = $derived(executionRuns.records.filter((run) => run.identity.entityId === LIATIR_SINGLE_CELL_STUDY_ID
    && run.identity.workspaceId === workspaceStore.activeId));
  onMount(() => { void executionRuns.init(); void analysisRuns.init(); });
  async function launch(resume?: LiatirSingleCellStudyRequest) {
    launching = true;
    error = '';
    try { await launchSingleCellStudy(resume ?? { dataset, methods: [...methods], stabilityCheck,
      ...(importStudyFile ? { importStudyFile } : {}) }); }
    catch (failure) { error = String(failure); }
    finally { launching = false; }
  }
  async function chooseSavedStudy() {
    const selected = await liatir()?.desktop.files.open({ multi: false, allowed: ['json'] });
    if (selected?.paths[0]) importStudyFile = selected.paths[0];
  }
</script>

<PageHeader title="Single-cell study" description="Compare three pretrained models with three established methods on public data." />
<PageContent>
  <div class="mx-auto max-w-4xl space-y-6 p-6" data-testid="single-cell-study">
    <p class="text-sm text-text-secondary">An embedding is a compact numerical description of each cell. This study measures how well these descriptions preserve cell identity, mix experimental batches, and use your computer's time and memory.</p>
    <div class="space-y-3 rounded-xl border border-border p-5">
      <label class="block text-sm font-medium" for="study-dataset">Dataset</label>
      <select id="study-dataset" data-testid="study-dataset" bind:value={dataset} class="rounded-lg border border-border bg-surface-2 p-2">
        {#each LIATIR_SINGLE_CELL_STUDY_DATASETS as item}<option value={item.id}>{item.label}</option>{/each}
      </select>
      <p class="text-xs text-text-muted">{LIATIR_SINGLE_CELL_STUDY_DATASETS.find((item) => item.id === dataset)?.description}</p>
      <fieldset class="grid gap-3 py-3 sm:grid-cols-2">
        <legend class="text-sm font-medium">Methods</legend>
        {#each LIATIR_SINGLE_CELL_STUDY_METHODS as method}
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`study-method-${method.id}`} bind:group={methods} value={method.id} />{method.label}</label>
        {/each}
      </fieldset>
      <p class="text-xs text-text-muted">PCA compresses variable genes; Harmony adjusts experimental batch differences; scVI learns from this dataset. The other models use their existing training without further fitting. Install them on the <a class="underline" href="/ai">AI Models</a> page before including them.</p>
      <p class="text-xs text-text-muted">Computation uses only the processor, with one cell at a time for the pretrained models. A separate monitor stops a task when memory or disk space runs low. It may take hours. You can leave this page and follow it in Jobs.</p>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="study-stability" bind:checked={stabilityCheck} />Check stability on a small sample first</label>
      <p class="text-xs text-text-muted">A stability check is a diagnostic, not the complete study. First use downloads public data and study software.</p>
      <div class="space-y-2">
        <Button onclick={chooseSavedStudy}>Import saved study</Button>
        <input type="hidden" data-testid="study-import-file" bind:value={importStudyFile} />
        {#if importStudyFile}
          <p class="text-xs text-text-muted">Saved study selected. Its original files and completed measurements are verified before reuse. This creates a new run.</p>
          <Button onclick={() => { importStudyFile = ''; }}>Clear saved study</Button>
        {/if}
      </div>
      <Button variant="primary" loading={launching} disabled={!methods.length || !workspaceStore.activeId} testId="study-launch" onclick={() => launch()}>{stabilityCheck ? 'Check stability' : 'Run complete study'}</Button>
      {#if error}<p role="alert" class="text-sm text-red-400">{sanitizeLocalPathsForDisplay(error, 2)}</p>{/if}
    </div>
    {#each runs as run (run.identity.runId)}
      <div class="rounded-xl border border-border p-4" data-testid="study-run" data-run-id={run.identity.runId} data-status={run.status}>
        <div class="flex items-center justify-between gap-3"><p class="font-medium">{run.label}</p><span class="text-xs">{run.status}</span></div>
        <p class="py-2 text-xs text-text-muted">{sanitizeLocalPathsForDisplay(run.logs.at(-1)?.message ?? 'Preparing study', 2)}</p>
        <Button onclick={() => goto(`/jobs`)}>Jobs</Button>
        {#if run.finalizedAt}<Button testId="study-open-result" onclick={() => goto(`/results?run=${run.identity.runId}`)}>View results and export</Button>
          <Button disabled={launching} onclick={() => launch({ ...(run.params as unknown as LiatirSingleCellStudyRequest), importStudyFile: undefined, resumeFromRunId: run.identity.runId })}>Resume using saved stages</Button>
        {:else}<Button onclick={() => executionRuns.cancel(run.identity.runId)}>Cancel this study</Button>{/if}
      </div>
    {/each}
  </div>
</PageContent>
