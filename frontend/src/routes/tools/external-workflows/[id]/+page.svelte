<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import { liatir } from '$lib/api';
  import { externalWorkflowsStore } from '$lib/stores/externalWorkflows.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { finalizeExecutionResult } from '$lib/execution/finalization';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import {
    LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
    assertLiatirExternalWorkflowDefinition,
    createLiatirExternalWorkflowRunIdentity,
    type JsonValue,
    type LiatirExternalWorkflowDefinition,
    type LiatirExternalWorkflowInput,
    type LiatirExternalWorkflowOutput,
    type LiatirExternalWorkflowParameter,
  } from '@liatir/core';
  import {
    ExternalWorkflowRunError,
    externalWorkflowProvenanceFromParams,
    externalWorkflowSideEffects,
    runExternalWorkflowDefinition,
    type ExternalWorkflowResumeSource,
  } from '$lib/external-workflows/nextflow';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { ExternalWorkflowRuntimeInfo } from '../../../../../../src-ts/modules/rs/externalWorkflows/_types';

  type ParameterDraft = Omit<LiatirExternalWorkflowParameter, 'default'> & { defaultText: string };
  type InputDraft = Omit<LiatirExternalWorkflowInput, 'accept'> & { acceptText: string };
  type OutputDraft = LiatirExternalWorkflowOutput;

  const inputClass = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-violet-200';
  const compactInputClass = 'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:ring-2 focus:ring-violet-200';
  const routeId = $derived(page.params.id ?? 'new');

  let savedId = $state<string | null>(null);
  let name = $state('Untitled External Workflow');
  let description = $state('');
  let sourceKind = $state<'local' | 'repository'>('local');
  let localMainScript = $state('');
  let repository = $state('');
  let revision = $state('');
  let repositoryMainScript = $state('');
  let outputDirectoryParameter = $state('outdir');
  let profile = $state('');
  let entryWorkflow = $state('');
  let configFile = $state('');
  let parameters = $state<ParameterDraft[]>([]);
  let inputs = $state<InputDraft[]>([]);
  let outputs = $state<OutputDraft[]>([
    { key: 'result', label: 'Result', relativePath: 'result.txt', ext: 'txt' },
  ]);

  let dependencyState = $state<'checking' | 'ready' | 'missing'>('checking');
  let runtime = $state<ExternalWorkflowRuntimeInfo | null>(null);
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let logLines = $state<string[]>([]);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let runValues = $state<Record<string, string>>({});
  let resumeEnabled = $state(false);
  let resumeRunId = $state('');

  const toolId = $derived(savedId ? `external-workflow:${savedId}` : '');
  const workflowRuns = $derived(toolId ? analysisRuns.byTool(toolId) : []);
  const selectedRun = $derived(workflowRuns.find((run) => run.id === selectedRunId) ?? null);
  const resumeCandidates = $derived.by(() => {
    if (!savedId) return [];
    const current = currentSavedDefinition();
    if (!current) return [];
    return workflowRuns.flatMap((run) => {
      const provenance = externalWorkflowProvenanceFromParams(run.params);
      if (
        !provenance?.sessionId ||
        provenance.definitionId !== savedId ||
        provenance.definitionUpdatedAt !== current.updatedAt ||
        JSON.stringify(provenance.source) !== JSON.stringify(current.source)
      ) return [];
      return [{
        run,
        resume: {
          runId: run.id,
          sessionId: provenance.sessionId,
          workDirectory: provenance.locations.workDirectory,
        } satisfies ExternalWorkflowResumeSource,
      }];
    });
  });

  $effect(() => {
    const id = selectedRunId;
    if (!id) {
      loadedOutput = null;
      return;
    }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then((output) => {
      if (selectedRunId === id) loadedOutput = output;
      loadingOutput = false;
    });
  });

  onMount(async () => {
    await Promise.all([
      externalWorkflowsStore.init(),
      dataFiles.init(),
      analysisRuns.init(),
      executionRuns.init(),
    ]);
    if (routeId !== 'new') {
      const definition = externalWorkflowsStore.byId(routeId);
      if (!definition) {
        toast.error('External Workflow not found.');
        await goto('/tools/external-workflows');
        return;
      }
      loadDefinition(definition);
      selectedRunId = analysisRuns.byTool(`external-workflow:${definition.id}`)[0]?.id ?? null;
    }
    const api = liatir();
    if (!api) return;
    try {
      runtime = await api.externalWorkflows.runtimeInfo();
      dependencyState = runtime.available ? 'ready' : 'missing';
    } catch {
      dependencyState = 'missing';
    }
  });

  function currentSavedDefinition(): LiatirExternalWorkflowDefinition | null {
    return savedId ? externalWorkflowsStore.byId(savedId) : null;
  }

  function loadDefinition(definition: LiatirExternalWorkflowDefinition) {
    savedId = definition.id;
    name = definition.name;
    description = definition.description;
    sourceKind = definition.source.kind;
    localMainScript = definition.source.kind === 'local' ? definition.source.mainScriptPath : '';
    repository = definition.source.kind === 'repository' ? definition.source.repository : '';
    revision = definition.source.kind === 'repository' ? definition.source.revision : '';
    repositoryMainScript = definition.source.kind === 'repository' ? definition.source.mainScript ?? '' : '';
    outputDirectoryParameter = definition.outputDirectoryParameter;
    profile = definition.nextflow?.profile ?? '';
    entryWorkflow = definition.nextflow?.entryWorkflow ?? '';
    configFile = definition.nextflow?.configFilePath ?? '';
    parameters = definition.parameters.map((parameter) => ({
      ...parameter,
      defaultText: parameter.default === undefined ? '' : String(parameter.default),
    }));
    inputs = definition.inputs.map((input) => ({
      ...input,
      acceptText: input.accept?.join(', ') ?? '',
    }));
    outputs = definition.outputs.map((output) => ({ ...output }));
    resetRunValues(definition);
  }

  function resetRunValues(definition: LiatirExternalWorkflowDefinition) {
    const values: Record<string, string> = {};
    for (const parameter of definition.parameters) {
      if (parameter.default !== undefined) values[parameter.key] = String(parameter.default);
    }
    runValues = values;
  }

  function parameterDefault(parameter: ParameterDraft): JsonValue | undefined {
    if (!parameter.defaultText.trim()) return undefined;
    if (parameter.type === 'number') {
      const value = Number(parameter.defaultText);
      if (!Number.isFinite(value)) throw new Error(`Default for ${parameter.label || parameter.key} must be a number.`);
      return value;
    }
    if (parameter.type === 'boolean') return parameter.defaultText === 'true';
    return parameter.defaultText;
  }

  function candidateDefinition(): LiatirExternalWorkflowDefinition {
    const existing = currentSavedDefinition();
    const now = Date.now();
    const nextflow = {
      ...(profile.trim() ? { profile: profile.trim() } : {}),
      ...(configFile.trim() ? { configFilePath: configFile.trim() } : {}),
      ...(entryWorkflow.trim() ? { entryWorkflow: entryWorkflow.trim() } : {}),
    };
    const definition: LiatirExternalWorkflowDefinition = {
      schemaVersion: LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
      id: existing?.id ?? savedId ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      engine: 'nextflow',
      source: sourceKind === 'local'
        ? { kind: 'local', mainScriptPath: localMainScript.trim() }
        : {
            kind: 'repository',
            repository: repository.trim(),
            revision: revision.trim(),
            ...(repositoryMainScript.trim() ? { mainScript: repositoryMainScript.trim() } : {}),
          },
      parameters: parameters.map((parameter) => {
        const defaultValue = parameterDefault(parameter);
        return {
          key: parameter.key.trim(),
          label: parameter.label.trim(),
          type: parameter.type,
          required: parameter.required,
          ...(parameter.description?.trim() ? { description: parameter.description.trim() } : {}),
          ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        };
      }),
      inputs: inputs.map((input) => ({
        key: input.key.trim(),
        label: input.label.trim(),
        required: input.required,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(input.acceptText.trim()
          ? { accept: input.acceptText.split(',').map((value) => value.trim().replace(/^\./, '')).filter(Boolean) }
          : {}),
      })),
      outputs: outputs.map((output) => ({
        key: output.key.trim(),
        label: output.label.trim(),
        relativePath: output.relativePath.trim(),
        ext: output.ext.trim().replace(/^\./, ''),
        ...(output.mediaType?.trim() ? { mediaType: output.mediaType.trim() } : {}),
      })),
      outputDirectoryParameter: outputDirectoryParameter.trim(),
      ...(Object.keys(nextflow).length > 0 ? { nextflow } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
    };
    assertLiatirExternalWorkflowDefinition(definition);
    return definition;
  }

  function comparable(definition: LiatirExternalWorkflowDefinition): string {
    const { updatedAt: _updatedAt, ...rest } = definition;
    return JSON.stringify(rest);
  }

  async function persistDefinition(navigate = true): Promise<LiatirExternalWorkflowDefinition | null> {
    try {
      let definition = candidateDefinition();
      const existing = currentSavedDefinition();
      if (!existing || comparable(existing) !== comparable(definition)) {
        definition = { ...definition, updatedAt: Date.now() };
        await externalWorkflowsStore.save(definition);
      } else {
        definition = existing;
      }
      const wasNew = !savedId;
      savedId = definition.id;
      if (wasNew) resetRunValues(definition);
      toast.success('External Workflow saved.');
      if (navigate && routeId === 'new') {
        await goto(`/tools/external-workflows/${definition.id}`, { replaceState: true });
      }
      return definition;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function pickMainScript() {
    const api = liatir();
    if (!api) return;
    const result = await api.desktop.files.open({ multi: false, allowed: ['nf'] });
    if (result.paths[0]) localMainScript = result.paths[0];
  }

  async function pickConfig() {
    const api = liatir();
    if (!api) return;
    const result = await api.desktop.files.open({ multi: false, allowed: ['config'] });
    if (result.paths[0]) configFile = result.paths[0];
  }

  function addInput() {
    inputs = [...inputs, { key: `input_${inputs.length + 1}`, label: 'Input file', required: true, acceptText: '' }];
  }

  function addParameter() {
    parameters = [...parameters, {
      key: `parameter_${parameters.length + 1}`,
      label: 'Parameter',
      type: 'string',
      required: false,
      defaultText: '',
    }];
  }

  function addOutput() {
    outputs = [...outputs, {
      key: `output_${outputs.length + 1}`,
      label: 'Output file',
      relativePath: `output-${outputs.length + 1}.txt`,
      ext: 'txt',
    }];
  }

  function matchingFiles(input: InputDraft) {
    const accepted = input.acceptText.split(',').map((value) => value.trim().replace(/^\./, '')).filter(Boolean);
    return accepted.length > 0 ? dataFiles.byExt(...accepted) : dataFiles.files;
  }

  async function runWorkflow() {
    if (running || dependencyState !== 'ready') return;
    const definition = await persistDefinition(false);
    const workspaceId = workspaceStore.activeId;
    if (!definition || !workspaceId) return;

    const resume = resumeEnabled
      ? resumeCandidates.find((candidate) => candidate.run.id === resumeRunId)?.resume
      : undefined;
    if (resumeEnabled && !resume) {
      toast.error('Choose a compatible prior run to resume.');
      return;
    }

    running = true;
    logLines = [];
    selectedRunId = null;
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    activeExecutionRunId = runId;
    const execution = createLiatirExternalWorkflowRunIdentity({
      runId,
      workspaceId,
      entityId: definition.id,
    });
    const originalInputs = definition.inputs.flatMap((input) => runValues[input.key] ? [runValues[input.key]] : []);
    const appendLog = (line: string) => {
      if (!line.trim()) return;
      logLines = [...logLines, line];
      void executionRuns.appendLog(runId, line, { stream: 'system' }).catch(() => {});
    };

    try {
      await executionRuns.begin({
        identity: execution,
        label: definition.name,
        resultPolicy: 'own',
        resultId: runId,
        inputs: originalInputs,
        params: runValues,
        startedAt,
      });
      const result = await runExternalWorkflowDefinition(definition, runValues, appendLog, {
        execution,
        label: definition.name,
        startedAt,
        signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
        resume,
      });
      const endedAt = result.provenance.endedAt;
      await finalizeExecutionResult(runId, 'done', {
        id: runId,
        tool: `external-workflow:${definition.id}`,
        label: definition.name,
        inputs: originalInputs,
        params: {
          values: runValues,
          externalWorkflow: result.provenance as unknown as JsonValue,
        },
        outputFiles: result.outputFiles,
        sideEffects: externalWorkflowSideEffects(result.provenance),
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        output: result.output,
        error: null,
        log: [...logLines],
      });
      toast.success('External Workflow complete.');
    } catch (error) {
      const endedAt = Date.now();
      const adapterError = error instanceof ExternalWorkflowRunError ? error : null;
      const status = adapterError?.result.provenance.finalStatus === 'cancelled' ? 'cancelled' : 'error';
      const message = error instanceof Error ? error.message : String(error);
      if (executionRuns.byId(runId)) {
        await finalizeExecutionResult(runId, status, {
          id: runId,
          tool: `external-workflow:${definition.id}`,
          label: definition.name,
          inputs: originalInputs,
          params: {
            values: runValues,
            ...(adapterError
              ? { externalWorkflow: adapterError.result.provenance as unknown as JsonValue }
              : {}),
          },
          outputFiles: adapterError?.result.outputFiles ?? [],
          // A failed run leaves the engine's own reports behind too, and those are the ones worth
          // reading. Without provenance the engine never started, so there is nothing to point at.
          sideEffects: adapterError
            ? externalWorkflowSideEffects(adapterError.result.provenance)
            : [],
          startedAt,
          endedAt: adapterError?.result.provenance.endedAt ?? endedAt,
          durationMs: (adapterError?.result.provenance.endedAt ?? endedAt) - startedAt,
          output: adapterError?.result.output ?? null,
          error: message,
          log: [...logLines],
        }).catch(() => {});
      }
      toast.error(message);
    } finally {
      running = false;
      activeExecutionRunId = null;
      selectedRunId = runId;
    }
  }

  async function cancelRun() {
    if (activeExecutionRunId) await executionRuns.cancel(activeExecutionRunId);
  }

  async function deleteRun(run: AnalysisRunMeta) {
    const accepted = await confirm({
      title: 'Delete run',
      message: `Delete this run of “${run.label}”? Output files on disk are kept.`,
      confirmLabel: 'Delete',
    });
    if (!accepted) return;
    if (selectedRunId === run.id) selectedRunId = workflowRuns.find((item) => item.id !== run.id)?.id ?? null;
    await analysisRuns.remove(run.id);
  }

  function fmtDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title={savedId ? name : 'New External Workflow'}
    description="One saved definition for standalone runs and Liatir pipelines"
  >
    {#snippet actions()}
      <Button variant="ghost" size="sm" onclick={() => goto('/tools/external-workflows')}>
        <Icon icon="lucide:arrow-left" width="14" height="14" /> All workflows
      </Button>
      <Button variant="primary" size="sm" testId="save-external-workflow" onclick={() => persistDefinition()}>
        Save definition
      </Button>
    {/snippet}
  </PageHeader>

  <PageContent>
    <div class="flex-1 overflow-y-auto p-6 space-y-5">
      <Card class="p-5">
        <div class="flex items-start justify-between gap-4 mb-5">
          <div>
            <p class="text-sm font-semibold text-text">Saved definition</p>
            <p class="mt-1 text-xs text-text-muted">Describe the workflow once. Liatir uses these same inputs and outputs everywhere.</p>
          </div>
          <Badge variant={dependencyState === 'ready' ? 'available' : dependencyState === 'missing' ? 'failed' : 'neutral'}>
            {dependencyState === 'ready' ? `Nextflow + Java ready${runtime?.backend === 'wsl2' ? ` in WSL2 (${runtime.distribution ?? 'default'})` : ''}` : dependencyState === 'missing' ? 'Dependency missing' : 'Checking dependencies'}
          </Badge>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label class="space-y-1.5">
            <span class="text-xs font-medium text-text-muted">Name</span>
            <input bind:value={name} class={inputClass} data-testid="external-workflow-name" />
          </label>
          <label class="space-y-1.5">
            <span class="text-xs font-medium text-text-muted">Source</span>
            <select bind:value={sourceKind} class={inputClass}>
              <option value="local">Local Nextflow script</option>
              <option value="repository">Version-pinned repository</option>
            </select>
          </label>
          <label class="space-y-1.5 lg:col-span-2">
            <span class="text-xs font-medium text-text-muted">Description</span>
            <textarea bind:value={description} rows="2" class={inputClass}></textarea>
          </label>
        </div>

        {#if sourceKind === 'local'}
          <div class="mt-4 rounded-xl border border-border bg-surface-2 p-4">
            <p class="text-xs font-medium text-text-secondary">Local source</p>
            <p class="mt-1 text-[11px] text-text-subtle">Choose the main <code>.nf</code> script. Its containing folder is copied into every run; `.git`, `.nextflow`, and `work` caches are excluded.</p>
            <div class="mt-3 flex gap-2">
              <input value={localMainScript} readonly class={`${inputClass} font-mono`} placeholder="Choose main.nf…" />
              <Button variant="secondary" size="sm" testId="pick-nextflow-main" onclick={pickMainScript}>Choose script</Button>
            </div>
          </div>
        {:else}
          <div class="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3 rounded-xl border border-border bg-surface-2 p-4">
            <label class="space-y-1.5 lg:col-span-2">
              <span class="text-xs font-medium text-text-muted">Repository name or URL</span>
              <input bind:value={repository} class={compactInputClass} placeholder="nf-core/rnaseq" />
            </label>
            <label class="space-y-1.5">
              <span class="text-xs font-medium text-text-muted">Tag or commit</span>
              <input bind:value={revision} class={compactInputClass} placeholder="3.21.0" />
            </label>
            <label class="space-y-1.5 lg:col-span-3">
              <span class="text-xs font-medium text-text-muted">Main script inside repository (optional)</span>
              <input bind:value={repositoryMainScript} class={compactInputClass} placeholder="main.nf" />
            </label>
          </div>
        {/if}

        <div class="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <label class="space-y-1.5">
            <span class="text-xs font-medium text-text-muted">Output directory parameter</span>
            <input bind:value={outputDirectoryParameter} class={compactInputClass} placeholder="outdir" />
          </label>
          <label class="space-y-1.5">
            <span class="text-xs font-medium text-text-muted">Nextflow profile (optional)</span>
            <input bind:value={profile} class={compactInputClass} placeholder="standard,docker" />
          </label>
          <label class="space-y-1.5">
            <span class="text-xs font-medium text-text-muted">Named workflow entry (optional)</span>
            <input bind:value={entryWorkflow} class={compactInputClass} placeholder="ANALYZE" />
          </label>
        </div>
        <div class="mt-3 flex gap-2">
          <input value={configFile} readonly class={`${compactInputClass} font-mono`} placeholder="Optional local nextflow.config…" />
          <Button variant="secondary" size="sm" onclick={pickConfig}>Choose config</Button>
          {#if configFile}<Button variant="ghost" size="sm" onclick={() => configFile = ''}>Clear</Button>{/if}
        </div>

        <div class="mt-6 space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold text-text-secondary">File inputs</p>
              <p class="text-[11px] text-text-subtle">Each file is copied into the isolated run and passed as a Nextflow parameter with the same key.</p>
            </div>
            <Button variant="secondary" size="sm" onclick={addInput}>Add input</Button>
          </div>
          {#each inputs as input, index}
            <div class="grid grid-cols-12 gap-2 items-end rounded-lg border border-border bg-surface-2 p-3">
              <label class="col-span-3 space-y-1"><span class="text-[10px] text-text-subtle">Key</span><input bind:value={input.key} class={compactInputClass} /></label>
              <label class="col-span-4 space-y-1"><span class="text-[10px] text-text-subtle">Label</span><input bind:value={input.label} class={compactInputClass} /></label>
              <label class="col-span-3 space-y-1"><span class="text-[10px] text-text-subtle">Extensions</span><input bind:value={input.acceptText} class={compactInputClass} placeholder="h5ad, csv" /></label>
              <label class="col-span-1 flex items-center justify-center gap-1 pb-2 text-[10px] text-text-muted"><input type="checkbox" bind:checked={input.required} /> Required</label>
              <button class="col-span-1 pb-2 text-text-subtle hover:text-red-500" aria-label="Remove input" onclick={() => inputs = inputs.filter((_, itemIndex) => itemIndex !== index)}><Icon icon="lucide:x" width="14" /></button>
            </div>
          {/each}
        </div>

        <div class="mt-6 space-y-3">
          <div class="flex items-center justify-between">
            <div><p class="text-xs font-semibold text-text-secondary">Parameters</p><p class="text-[11px] text-text-subtle">Simple fields become a no-code form in direct runs and pipelines.</p></div>
            <Button variant="secondary" size="sm" onclick={addParameter}>Add parameter</Button>
          </div>
          {#each parameters as parameter, index}
            <div class="grid grid-cols-12 gap-2 items-end rounded-lg border border-border bg-surface-2 p-3">
              <label class="col-span-3 space-y-1"><span class="text-[10px] text-text-subtle">Key</span><input bind:value={parameter.key} class={compactInputClass} /></label>
              <label class="col-span-3 space-y-1"><span class="text-[10px] text-text-subtle">Label</span><input bind:value={parameter.label} class={compactInputClass} /></label>
              <label class="col-span-2 space-y-1"><span class="text-[10px] text-text-subtle">Type</span><select bind:value={parameter.type} class={compactInputClass}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes / No</option></select></label>
              <label class="col-span-2 space-y-1"><span class="text-[10px] text-text-subtle">Default</span>{#if parameter.type === 'boolean'}<select bind:value={parameter.defaultText} class={compactInputClass}><option value="">None</option><option value="true">Yes</option><option value="false">No</option></select>{:else}<input bind:value={parameter.defaultText} class={compactInputClass} />{/if}</label>
              <label class="col-span-1 flex items-center justify-center gap-1 pb-2 text-[10px] text-text-muted"><input type="checkbox" bind:checked={parameter.required} /> Required</label>
              <button class="col-span-1 pb-2 text-text-subtle hover:text-red-500" aria-label="Remove parameter" onclick={() => parameters = parameters.filter((_, itemIndex) => itemIndex !== index)}><Icon icon="lucide:x" width="14" /></button>
            </div>
          {/each}
        </div>

        <div class="mt-6 space-y-3">
          <div class="flex items-center justify-between">
            <div><p class="text-xs font-semibold text-text-secondary">Declared outputs</p><p class="text-[11px] text-text-subtle">Only exact files listed here become reusable Liatir artifacts. Wildcards are intentionally rejected.</p></div>
            <Button variant="secondary" size="sm" onclick={addOutput}>Add output</Button>
          </div>
          {#each outputs as output, index}
            <div class="grid grid-cols-12 gap-2 items-end rounded-lg border border-border bg-surface-2 p-3">
              <label class="col-span-3 space-y-1"><span class="text-[10px] text-text-subtle">Key</span><input bind:value={output.key} class={compactInputClass} /></label>
              <label class="col-span-3 space-y-1"><span class="text-[10px] text-text-subtle">Label</span><input bind:value={output.label} class={compactInputClass} /></label>
              <label class="col-span-4 space-y-1"><span class="text-[10px] text-text-subtle">Exact path below output directory</span><input bind:value={output.relativePath} class={compactInputClass} /></label>
              <label class="col-span-1 space-y-1"><span class="text-[10px] text-text-subtle">Ext</span><input bind:value={output.ext} class={compactInputClass} /></label>
              <button class="col-span-1 pb-2 text-text-subtle hover:text-red-500" aria-label="Remove output" onclick={() => outputs = outputs.filter((_, itemIndex) => itemIndex !== index)}><Icon icon="lucide:x" width="14" /></button>
            </div>
          {/each}
        </div>
      </Card>

      {#if savedId}
        {@const definition = currentSavedDefinition()}
        {#if definition}
          <Card class="p-5" testId="external-workflow-run-panel">
            <div class="flex items-start justify-between gap-4">
              <div><p class="text-sm font-semibold text-text">Run {definition.name}</p><p class="mt-1 text-xs text-text-muted">This is the same adapter and I/O mapping used by its pipeline node.</p></div>
              <div class="flex gap-2">
                {#if running}<Button variant="danger" size="sm" testId="cancel-external-workflow" onclick={cancelRun}>Cancel</Button>{/if}
                <Button variant="primary" size="sm" testId="run-external-workflow" loading={running} disabled={dependencyState !== 'ready'} onclick={runWorkflow}>Run workflow</Button>
              </div>
            </div>

            <div class="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {#each definition.inputs as input}
                <FilePickerPopup files={matchingFiles({ ...input, acceptText: input.accept?.join(', ') ?? '' })} value={runValues[input.key] ?? ''} label={`${input.label}${input.required ? '' : ' (optional)'}`} disabled={running} testId={`external-workflow-input-${input.key}`} onchange={(value) => runValues = { ...runValues, [input.key]: value }} />
              {/each}
              {#each definition.parameters as parameter}
                {#if parameter.type === 'boolean'}
                  <label class="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <input data-testid={`external-workflow-parameter-${parameter.key}`} type="checkbox" checked={(runValues[parameter.key] ?? String(parameter.default ?? false)) === 'true'} disabled={running} onchange={(event) => runValues = { ...runValues, [parameter.key]: String(event.currentTarget.checked) }} />
                    <span class="text-xs text-text-secondary">{parameter.label}</span>
                  </label>
                {:else}
                  <label class="space-y-1.5"><span class="text-xs font-medium text-text-muted">{parameter.label}{parameter.required ? '' : ' (optional)'}</span><input data-testid={`external-workflow-parameter-${parameter.key}`} type={parameter.type === 'number' ? 'number' : 'text'} value={runValues[parameter.key] ?? String(parameter.default ?? '')} disabled={running} class={inputClass} onchange={(event) => runValues = { ...runValues, [parameter.key]: event.currentTarget.value }} /></label>
                {/if}
              {/each}
            </div>

            <div class="mt-5 rounded-xl border border-border bg-surface-2 p-4">
              <label class="flex items-start gap-2">
                <input type="checkbox" bind:checked={resumeEnabled} disabled={running || resumeCandidates.length === 0} class="mt-0.5" />
                <span><span class="block text-xs font-medium text-text-secondary">Expert: resume a prior Nextflow session</span><span class="block mt-0.5 text-[11px] text-text-subtle">Never automatic. Only runs from this exact saved definition and source revision are offered.</span></span>
              </label>
              {#if resumeEnabled}
                <div class="mt-3">
                  <Select value={resumeRunId} options={resumeCandidates.map((candidate) => ({ value: candidate.run.id, label: `${fmtDate(candidate.run.startedAt)} · ${candidate.run.status}`, description: candidate.run.id }))} onchange={(value) => resumeRunId = value} placeholder="Choose a prior session…" />
                </div>
              {:else if resumeCandidates.length === 0}
                <p class="mt-2 text-[10px] text-text-subtle">No compatible session with reusable cache is available yet.</p>
              {/if}
            </div>

            {#if logLines.length > 0}
              <pre class="mt-4 max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">{sanitizeLocalPathsForDisplay(logLines.slice(-120).join('\n'), 2)}</pre>
            {/if}
          </Card>

          <div class="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] gap-4">
            <Card class="overflow-hidden">
              <div class="border-b border-border px-3 py-3 text-xs font-medium text-text-secondary">Run history</div>
              <div class="max-h-[36rem] overflow-y-auto">
                {#if workflowRuns.length === 0}
                  <p class="px-4 py-8 text-center text-xs text-text-subtle">No runs yet.</p>
                {:else}
                  {#each workflowRuns as run (run.id)}
                    <div class="group flex items-start border-b border-border/60 {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
                      <button class="flex-1 min-w-0 px-3 py-2.5 text-left" onclick={() => selectedRunId = run.id}>
                        <div class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full {run.status === 'done' ? 'bg-emerald-500' : run.status === 'cancelled' ? 'bg-amber-500' : 'bg-red-500'}"></span><span class="truncate text-xs font-medium text-text-secondary">{fmtDate(run.startedAt)}</span></div>
                        <p class="mt-0.5 pl-3 text-[10px] text-text-subtle">{run.status} · {fmtDuration(run.startedAt, run.endedAt)}</p>
                      </button>
                      <button aria-label="Delete run" class="m-2 p-1 text-text-subtle opacity-0 group-hover:opacity-100 hover:text-red-500" onclick={() => deleteRun(run)}><Icon icon="lucide:trash-2" width="12" /></button>
                    </div>
                  {/each}
                {/if}
              </div>
            </Card>

            <div class="min-w-0">
              {#if !selectedRun}
                <div class="rounded-xl border border-dashed border-border py-16 text-center text-xs text-text-subtle">Select a run to inspect its outputs and provenance.</div>
              {:else if loadingOutput}
                <div class="py-16 text-center text-xs text-text-subtle">Loading Result…</div>
              {:else}
                <div class="mb-3 flex items-center justify-between"><div><p class="text-sm font-semibold text-text">{selectedRun.label}</p><p class="text-xs text-text-subtle">{selectedRun.status} · {fmtDate(selectedRun.startedAt)}</p></div><Button variant="ghost" size="sm" onclick={() => goto(`/results?run=${selectedRun.id}`)}>Open in Results</Button></div>
                {#if selectedRun.error}<div class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{selectedRun.error}</div>{/if}
                {#if loadedOutput}<ToolResultView output={loadedOutput} outputFiles={selectedRun.outputFiles ?? []} resultFolder="External Workflows" />{/if}
                <RunRecord runId={selectedRun.id} />
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </PageContent>
</div>
