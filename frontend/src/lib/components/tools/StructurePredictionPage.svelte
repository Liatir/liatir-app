<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    BOLTZ_2_MODEL_ID,
    PROTEIN_LIGAND_AFFINITY_TOOL_ID,
    createLiatirStructureToolDraft,
    isLiatirStructureModelId,
    type LiatirHardwareHostMemory,
    type LiatirStructureToolDraft,
    type LiatirStructureToolId,
  } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import StructurePredictionDraft from './StructurePredictionDraft.svelte';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { structureDrafts } from '$lib/stores/structureDrafts.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';

  let { toolId }: { toolId: LiatirStructureToolId } = $props();
  let selected = $state<LiatirStructureToolDraft | null>(null);
  let loaded = $state(false);
  let error = $state('');
  let saveStatus = $state('');
  let host = $state<LiatirHardwareHostMemory>({ totalMemoryBytes: null });
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let saveRevision = 0;
  const affinity = $derived(toolId === PROTEIN_LIGAND_AFFINITY_TOOL_ID);
  const models = $derived(aiModelsStore.models.filter((model) =>
    isLiatirStructureModelId(model.id) && (!affinity || model.id === BOLTZ_2_MODEL_ID)));
  const drafts = $derived(structureDrafts.drafts.filter((draft) =>
    draft.workspaceId === workspaceStore.activeId && draft.toolId === toolId));
  // The saved draft, not the copy the editor was mounted with, is what records a run once it starts.
  const resultRunId = $derived(drafts.find((draft) => draft.id === selected?.id)?.executionRunId ?? null);
  const resultRun = $derived(resultRunId ? analysisRuns.runs.find((run) => run.id === resultRunId) ?? null : null);

  $effect(() => {
    let current = true;
    const workspaceId = workspaceStore.activeId;
    loaded = false;
    selected = null;
    error = '';
    if (!workspaceId) return;
    (async () => {
      await Promise.all([aiModelsStore.init(), dataFiles.init(), analysisRuns.init(), structureDrafts.load(workspaceId)]);
      void jobsStore.refresh();
      void aiModelsStore.ensureHardwareInfo().then((info) => {
        if (current) host = { totalMemoryBytes: info?.totalMemoryBytes ?? null };
      });
      if (!current || workspaceStore.activeId !== workspaceId) return;
      loaded = true;
      const saved = drafts.at(-1);
      if (saved) selectDraft(saved);
      else if (models.length) newDraft();
    })().catch((cause) => { if (current) error = String(cause); });
    return () => { current = false; };
  });

  $effect(() => {
    const id = resultRunId;
    const status = resultRun?.status;
    loadedOutput = null;
    if (!id || status !== 'done') return;
    loadingOutput = true;
    analysisRuns.loadOutput(id).then((output) => {
      if (resultRunId === id) loadedOutput = output;
    }).finally(() => { loadingOutput = false; });
  });

  function selectDraft(draft: LiatirStructureToolDraft) {
    selected = structuredClone($state.snapshot(draft));
  }

  function newDraft() {
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) return;
    const draft = createLiatirStructureToolDraft({ id: crypto.randomUUID(), workspaceId, toolId });
    const first = models[0];
    if (first && isLiatirStructureModelId(first.id)) draft.modelId = first.id;
    selected = draft;
  }

  function saveDraft(draft: LiatirStructureToolDraft) {
    const revision = ++saveRevision;
    saveStatus = 'Saving…';
    void structureDrafts.save(draft).then(() => {
      if (revision === saveRevision) saveStatus = 'Saved on this computer';
    }).catch((cause) => {
      if (revision === saveRevision) { saveStatus = 'Changes could not be saved'; error = String(cause); }
    });
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader title={affinity ? 'Protein–Ligand Affinity' : 'Biomolecular Structure Prediction'}
    description={affinity ? 'Estimate how a protein and a small molecule may bind.' : 'Predict how proteins and other molecules fit together.'}>
    {#snippet actions()}<Button variant="ghost" size="sm" onclick={() => goto('/tools')}>Back</Button>{/snippet}
  </PageHeader>
  <PageContent>
    <div class="flex-1 overflow-y-auto p-6">
      {#if error}<p role="alert" class="mb-4 text-sm text-red-600">{error}</p>{/if}
      {#if !loaded && !error}<p>Loading saved predictions…</p>
      {:else if loaded && !models.length}
        <Card class="p-5"><p class="font-semibold">Runtime not published</p><p class="mt-1 text-sm text-text-muted">Structure prediction becomes available after the model passes scientific, hardware and app validation.</p></Card>
      {:else if loaded}
        <div class="mx-auto max-w-4xl space-y-5">
          <div class="flex flex-wrap items-center gap-3">
            <Button variant="secondary" testId="structure-new-draft" onclick={newDraft}>New prediction</Button>
            <span role="status" data-testid="structure-save-status" class="text-xs text-text-muted">{saveStatus}</span>
          </div>
          {#if drafts.length}
            <nav aria-label="Saved predictions" class="flex flex-wrap gap-2">
              {#each drafts as draft (draft.id)}
                <button data-testid="structure-saved-draft" data-draft-id={draft.id} aria-current={selected?.id === draft.id ? 'true' : undefined}
                  class="rounded border border-border px-3 py-2 text-sm hover:bg-surface-2 aria-[current=true]:border-brand"
                  onclick={() => selectDraft(draft)}>{draft.label || 'Untitled prediction'}</button>
              {/each}
            </nav>
          {/if}
          {#if selected}
            {#key selected.id}
              <Card class="p-5"><StructurePredictionDraft initial={selected} {models} files={dataFiles.files} {host} onchange={saveDraft} /></Card>
            {/key}
          {/if}
          {#if resultRunId && !resultRun}
            <Card class="p-4 text-sm" testId="structure-running">
              This prediction is running. It continues if you leave this page, and you can follow it in
              <button class="underline" onclick={() => goto('/jobs')}>Jobs</button>.
            </Card>
          {:else if resultRun?.status === 'error' || resultRun?.status === 'cancelled'}
            <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{resultRun.error}</div>
            <RunRecord runId={resultRunId} />
          {:else if loadingOutput}
            <div class="flex justify-center py-12"><Icon icon="svg-spinners:ring-resize" width="22" /></div>
          {:else if loadedOutput}
            <ToolResultView output={loadedOutput} outputFiles={resultRun?.outputFiles ?? []} />
            <RunRecord runId={resultRunId} />
          {/if}
        </div>
      {/if}
    </div>
  </PageContent>
</div>
