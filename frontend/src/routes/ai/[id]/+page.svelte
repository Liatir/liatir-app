<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import RunLog from '$lib/components/ui/RunLog.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { fmtDuration } from '$lib/utils';
  import { ensureResultsDir } from '$lib/utils/results';
  import { CELLTYPIST_MODEL_ID, ESM2_8M_ID, MOCK_AI_MODEL_ID, NUCLEOTIDE_TRANSFORMER_50M_ID } from '$lib/ai/model-registry';
  import { celltypistAnnotateDefinition, runCelltypistAnnotateStep } from '$lib/tools/ai/celltypist-annotate';
  import { sequenceEmbeddingDefinition, runSequenceEmbeddingStep } from '$lib/tools/ai/sequence-embedding';
  import { mockAIInferenceDefinition, runMockAIInferenceStep } from '$lib/tools/ai/mock-inference';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/types/pipeline';

  type RunMode = 'celltypist' | 'sequence' | 'mock' | 'unsupported';

  const modelId = $derived(page.params.id ?? '');
  const model = $derived(aiModelsStore.byId(modelId));
  const mode = $derived(runMode(modelId));
  const definition = $derived(
    mode === 'celltypist'
      ? celltypistAnnotateDefinition
      : mode === 'sequence'
        ? sequenceEmbeddingDefinition
        : mode === 'mock'
          ? mockAIInferenceDefinition
          : null
  );

  let running = $state(false);
  let startedAt = $state<number | null>(null);
  let now = $state(Date.now());
  let logLines = $state<string[]>([]);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  let inputFile = $state('');
  let sequence = $state('');
  let moleculeType = $state('dna');
  let maxLength = $state(1024);
  let celltypistModel = $state('Immune_All_Low.pkl');
  let majorityVoting = $state(false);
  let prompt = $state('Summarize the selected model run.');
  let context = $state('');

  const h5adFiles = $derived(dataFiles.byExt('h5ad'));
  const sequenceFiles = $derived(dataFiles.byExt('fasta', 'fa', 'faa', 'fna', 'txt'));
  const modelRuns = $derived(
    definition
      ? analysisRuns.byTool(definition.id).filter((run) => run.params?.modelId === modelId)
      : []
  );
  const moleculeOptions = $derived(
    modelId === ESM2_8M_ID
      ? [{ value: 'protein', label: 'Protein' }]
      : [
          { value: 'dna', label: 'DNA' },
          { value: 'rna', label: 'RNA' },
        ]
  );
  const selectedRun = $derived(modelRuns.find((run) => run.id === selectedRunId) ?? null);
  const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
  );
  const canRun = $derived(
    !!model &&
    model.status === 'installed' &&
    !!definition &&
    !running &&
    (
      mode === 'celltypist'
        ? !!inputFile
        : mode === 'sequence'
          ? !!inputFile || !!sequence.trim()
          : mode === 'mock'
            ? !!prompt.trim()
            : false
    )
  );

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (modelId === ESM2_8M_ID && moleculeType !== 'protein') moleculeType = 'protein';
    if (modelId === NUCLEOTIDE_TRANSFORMER_50M_ID && moleculeType === 'protein') moleculeType = 'dna';
  });

  $effect(() => {
    const id = selectedRunId;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then((output) => {
      loadedOutput = output;
      loadingOutput = false;
    });
  });

  onMount(() => {
    void aiModelsStore.init();
    void dataFiles.init();
    analysisRuns.init().then(() => {
      if (modelRuns.length > 0 && selectedRunId === null) selectedRunId = modelRuns[0].id;
    });
  });

  function runMode(id: string): RunMode {
    if (id === CELLTYPIST_MODEL_ID) return 'celltypist';
    if (id === NUCLEOTIDE_TRANSFORMER_50M_ID || id === ESM2_8M_ID) return 'sequence';
    if (id === MOCK_AI_MODEL_ID) return 'mock';
    return 'unsupported';
  }

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function inputSize(path: string): number | undefined {
    return dataFiles.files.find((file) => file.path === path)?.size;
  }

  async function runModel() {
    if (!model || !definition || !canRun) return;

    running = true;
    selectedRunId = null;
    loadedOutput = null;
    startedAt = Date.now();
    logLines = [];

    const runId = crypto.randomUUID();
    const t0 = startedAt;
    const logs: string[] = [];
    const onLog = (line: string) => {
      if (!line.trim()) return;
      logs.push(line);
      logLines = [...logs];
    };

    let inputs: Record<string, string>;
    let label = model.name;
    const inputPaths: string[] = [];

    if (mode === 'celltypist') {
      inputs = {
        modelId: model.id,
        inputFile,
        celltypistModel,
        majorityVoting: String(majorityVoting),
      };
      label = basename(inputFile);
      inputPaths.push(inputFile);
    } else if (mode === 'sequence') {
      inputs = {
        modelId: model.id,
        moleculeType,
        inputFile,
        sequence,
        maxLength: String(maxLength),
      };
      label = inputFile ? basename(inputFile) : `${moleculeType.toUpperCase()} sequence`;
      if (inputFile) inputPaths.push(inputFile);
    } else {
      inputs = {
        modelId: model.id,
        prompt,
        context,
      };
      label = 'Mock inference';
    }

    const inputSizes = inputPaths.length > 0
      ? inputPaths.map((path) => inputSize(path) ?? 0)
      : undefined;

    try {
      const { absDir } = await ensureResultsDir(definition.label);
      const result = mode === 'celltypist'
        ? await runCelltypistAnnotateStep(inputs, absDir, onLog)
        : mode === 'sequence'
          ? await runSequenceEmbeddingStep(inputs, absDir, onLog)
          : await runMockAIInferenceStep(inputs, absDir, onLog);

      const endedAt = Date.now();
      onLog(`Completed in ${fmtDuration(t0, endedAt)}`);
      await analysisRuns.add({
        id: runId,
        tool: definition.id,
        label,
        inputs: inputPaths,
        inputSizes,
        outputFiles: result.outputFiles as RunOutputFile[],
        params: inputs,
        status: 'done',
        startedAt: t0,
        endedAt,
        durationMs: endedAt - t0,
        output: result.output ?? null,
        error: null,
        log: [...logs],
      });
      toast.success('AI Model run complete');
    } catch (error) {
      const endedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      onLog(`Error: ${message}`);
      await analysisRuns.add({
        id: runId,
        tool: definition.id,
        label,
        inputs: inputPaths,
        inputSizes,
        params: inputs,
        status: 'error',
        startedAt: t0,
        endedAt,
        durationMs: endedAt - t0,
        output: null,
        error: message,
        log: [...logs],
      });
      toast.error(message);
    } finally {
      running = false;
      startedAt = null;
      selectedRunId = runId;
    }
  }

  async function deleteRun(run: AnalysisRunMeta) {
    const ok = await confirm({
      title: 'Delete run',
      message: `Delete the ${definition?.label ?? 'AI Model'} run for "${run.label}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (selectedRunId === run.id) selectedRunId = modelRuns.find((item) => item.id !== run.id)?.id ?? null;
    await analysisRuns.remove(run.id);
  }
</script>

<div class="flex h-full overflow-hidden">
  <div class="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-zinc-600">Run history</span>
      {#if modelRuns.length > 0}
        <span class="text-[10px] text-zinc-400">{modelRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if modelRuns.length === 0}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">
          No runs yet.<br />Results will appear here.
        </p>
      {:else}
        {#each modelRuns as run (run.id)}
          <div class="group relative flex items-start transition-colors {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
            <button onclick={() => selectedRunId = run.id} class="flex-1 text-left px-3 py-2.5 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="h-1.5 w-1.5 rounded-full shrink-0 {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
                <p class="text-xs font-medium truncate {selectedRunId === run.id ? 'text-brand' : 'text-zinc-700'}">{run.label}</p>
              </div>
              <p class="text-[10px] text-zinc-400 pl-3">
                {fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}
              </p>
            </button>
            <button
              onclick={() => deleteRun(run)}
              aria-label="Delete run"
              class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0 text-zinc-400 hover:text-red-500 transition-all rounded"
            >
              <Icon icon="lucide:x" width="11" height="11" />
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title={model?.name ?? 'AI Model'} description={definition?.description ?? 'Run a local AI Model'}>
      {#snippet actions()}
        <Button variant="ghost" size="sm" onclick={() => goto('/ai')}>
          <Icon icon="lucide:arrow-left" width="14" height="14" />
          Back
        </Button>
      {/snippet}
    </PageHeader>

    <div class="flex-1 overflow-y-auto p-6 space-y-5">
      {#if !model}
        <Card class="p-5">
          <p class="text-sm font-semibold text-zinc-800">AI Model not found</p>
          <p class="mt-1 text-xs text-zinc-500">Open AI Models and select an available model.</p>
        </Card>
      {:else if model.status !== 'installed'}
        <Card class="p-5">
          <p class="text-sm font-semibold text-zinc-800">Install required</p>
          <p class="mt-1 text-xs text-zinc-500">Install this AI Model before running it directly.</p>
        </Card>
      {:else if mode === 'unsupported'}
        <Card class="p-5">
          <p class="text-sm font-semibold text-zinc-800">No direct runner available</p>
          <p class="mt-1 text-xs text-zinc-500">This AI Model can be used by compatible AI Tools once a direct runner is implemented.</p>
        </Card>
      {:else}
        <Card class="p-5 space-y-4">
          <div>
            <p class="text-sm font-semibold text-zinc-800">Input</p>
            <p class="mt-1 text-xs text-zinc-500">{model.runtime.name} · {model.modalities.join(', ')}</p>
          </div>

          {#if mode === 'celltypist'}
            <FilePickerPopup
              files={h5adFiles}
              value={inputFile}
              label="AnnData file"
              emptyText="No h5ad files in Data yet."
              onchange={(path) => inputFile = path}
            />
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label for="celltypist-model" class="block text-xs text-zinc-500 mb-1.5">CellTypist model</label>
                <input
                  id="celltypist-model"
                  type="text"
                  bind:value={celltypistModel}
                  class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
                />
              </div>
              <label class="flex items-end gap-2 text-xs text-zinc-600 pb-2">
                <input type="checkbox" bind:checked={majorityVoting} />
                Majority voting
              </label>
            </div>
          {:else if mode === 'sequence'}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label for="molecule-type" class="block text-xs text-zinc-500 mb-1.5">Molecule</label>
                <select
                  id="molecule-type"
                  bind:value={moleculeType}
                  class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
                >
                  {#each moleculeOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label for="max-length" class="block text-xs text-zinc-500 mb-1.5">Max tokens</label>
                <input
                  id="max-length"
                  type="number"
                  min="16"
                  max="4096"
                  step="16"
                  bind:value={maxLength}
                  class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
                />
              </div>
            </div>
            <FilePickerPopup
              files={sequenceFiles}
              value={inputFile}
              label="FASTA file"
              emptyText="No FASTA files in Data yet."
              onchange={(path) => inputFile = path}
            />
            <div>
              <label for="inline-sequence" class="block text-xs text-zinc-500 mb-1.5">Inline sequence</label>
              <textarea
                id="inline-sequence"
                bind:value={sequence}
                rows="5"
                placeholder="Paste a DNA, RNA, or protein sequence..."
                class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-brand transition-colors font-mono"
              ></textarea>
            </div>
          {:else if mode === 'mock'}
            <div>
              <label for="prompt" class="block text-xs text-zinc-500 mb-1.5">Prompt</label>
              <textarea
                id="prompt"
                bind:value={prompt}
                rows="3"
                class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
              ></textarea>
            </div>
            <div>
              <label for="context" class="block text-xs text-zinc-500 mb-1.5">Context</label>
              <textarea
                id="context"
                bind:value={context}
                rows="4"
                class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
              ></textarea>
            </div>
          {/if}

          <div class="flex items-center gap-3 pt-1">
            <Button variant="primary" disabled={!canRun} loading={running} onclick={runModel}>
              Run
            </Button>
            {#if running && startedAt}
              <span class="text-xs text-zinc-400">Elapsed: {fmtDuration(startedAt, now)}</span>
            {/if}
          </div>
        </Card>
      {/if}

      {#if running && logLines.length > 0}
        <Card class="p-4">
          <p class="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Current run log</p>
          <pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-600 font-mono">{logLines.join('\n')}</pre>
        </Card>
      {/if}

      {#if displayError}
        <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>
          {displayError}
        </div>
        <RunLog runId={selectedRunId} />
      {:else if loadingOutput}
        <div class="flex justify-center py-12">
          <Icon icon="svg-spinners:ring-resize" width="22" height="22" class="text-zinc-400" />
        </div>
      {:else if loadedOutput}
        <div>
          <p class="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Last run result</p>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-medium text-zinc-700">{selectedRun?.label ?? 'Results'}</h2>
            {#if selectedRun}
              <span class="text-xs text-zinc-400">
                {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}
              </span>
            {/if}
          </div>
          <ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} />
          <RunLog runId={selectedRunId} />
        </div>
      {/if}
    </div>
  </div>
</div>
