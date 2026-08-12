<script lang="ts">
	import NodeWrapper from './layout/NodeContentWrapper.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { ToolNodeData, OutputFieldSchema } from '$lib/types/pipeline';
  import { resolveStepEntry } from '$lib/tools/pipeline-registry';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import OptionPicker from '$lib/components/ui/OptionPicker.svelte';
  import type { PickerGroup } from '$lib/components/ui/OptionPicker.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { fmtBytes, getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { upstreamOptions } from '$lib/tools/pipeline-io';
  import ValueRefInput from './actions/ValueRefInput.svelte';
  import NodeDeleteButton from './actions/NodeDeleteButton.svelte';
  import EditableNodeLabel from './actions/EditableNodeLabel.svelte';
  import { statusDotClass, statusLabel } from './scripts/node-status';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './scripts/node-data-commit';

  let { id, data }: NodeProps<Node<ToolNodeData>> = $props();

  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();

  const entry = $derived(resolveStepEntry(data.stepId));
  const def = $derived(entry?.definition);
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  const inputKeys = $derived(def ? Object.entries(def.inputSchema) : []);
  const aiModelOptions = $derived(
    aiModelsStore.runnableModels
      .filter((model) => {
        const supportedModelIds = def?.type === 'ai-tool'
          ? ((def as typeof def & { supportedModelIds?: string[] })?.supportedModelIds ?? [])
          : [];
        if (supportedModelIds.length > 0) return supportedModelIds.includes(model.id);
        const capabilities = def?.type === 'ai-tool'
          ? ((def as typeof def & { supportedCapabilities?: string[] })?.supportedCapabilities ?? [])
          : [];
        return capabilities.length === 0 || capabilities.some((capability) => model.capabilities.includes(capability as any));
      })
      .map((model) => ({
        value: model.id,
        label: model.name,
        sublabel: `${model.runtime.name} · ${model.modalities.join(', ')}`,
        badge: model.capabilities[0] ?? 'AI',
      }))
  );

  const aiModelGroups = $derived(
    aiModelOptions.length > 0
      ? [{ title: 'Installed AI Models', items: aiModelOptions }]
      : []
  );

  // Non-file outputs exposed as connectable value handles for downstream nodes.
  const valueOutputs = $derived(
    def ? Object.entries(def.outputSchema).filter(([, s]) => s.type !== 'file' && s.type !== 'stats') : []
  );

  function fmtValue(key: string, schema: OutputFieldSchema): string {
    const raw = state?.outputValues?.[key];
    if (raw === undefined) return '–';
    const n = Number(raw);
    if (schema.type !== 'number' || Number.isNaN(n)) {
      const visible = sanitizeLocalPathsForDisplay(raw, 2);
      return visible.length > 36 ? `${visible.slice(0, 33)}...` : visible;
    }
    if (schema.format === 'percent') return `${n.toFixed(1)}%`;
    if (schema.format === 'integer') return n.toLocaleString();
    return n.toFixed(3);
  }

  const inputsDisabled = $derived(pipelineStore.running);

  // Required inputs still empty (mirrors the canvas' canRun check) → surfaced as a
  // subtle warning so the user knows why the pipeline can't run yet.
  function resolvedInput(key: string, schema: { default?: unknown }): string {
    const v = data.inputs?.[key];
    if (v !== undefined && v !== null && v !== '') return String(v);
    return schema.default !== undefined && schema.default !== null ? String(schema.default) : '';
  }
  const missingRequired = $derived(
    def ? Object.entries(def.inputSchema).filter(([k, s]) => s.required && resolvedInput(k, s) === '') : []
  );
  const incomplete = $derived(status === 'pending' && missingRequired.length > 0);

  const runId = $derived(pipelineStore.currentRunId);

  onMount(() => {
    void aiModelsStore.init();
  });

  // File-input picker: compatible file outputs of connected upstream steps + data files.
  function buildGroups(accept: string[] | undefined): PickerGroup[] {
    const groups: PickerGroup[] = [];

    const stepItems = upstreamOptions(id, getNodes(), getEdges() as Edge[], 'file', { accept });
    if (stepItems.length > 0) groups.push({ title: 'Connected steps', items: stepItems });

    const files = accept?.length ? dataFiles.byExt(...accept) : dataFiles.files;
    if (files.length > 0) {
      groups.push({
        title: 'Data files',
        items: files.map(f => ({
          value: f.path,
          label: f.name,
          sublabel: getLastSegmentsStringFromPath(f.path, 2),
          badge: f.ext || '?',
          meta: f.size != null ? fmtBytes(f.size) : undefined,
        })),
      });
    }

    return groups;
  }

  // String / number inputs may instead reference a connected upstream value output.
  function valueOptions(inputType: string) {
    return upstreamOptions(id, getNodes(), getEdges() as Edge[], 'value',
      inputType === 'number' ? { valueType: 'number' } : {});
  }

  function selectOptions(key: string, schema: { options?: { value: string; label: string }[] }) {
    if (def?.type === 'ai-tool' && key === 'modelId') return aiModelOptions;
    return schema.options ?? [];
  }

  async function setInput(key: string, value: string) {
    updateNodeData(id, { inputs: { ...data.inputs, [key]: value } });
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }

  function openResults() {
    if (runId) goto(`/results?run=${runId}`);
  }
</script>

<NodeWrapper>

<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-70 max-w-80 rounded-xl border border-border bg-surface shadow-md overflow-visible">

  <div class="flex items-center gap-2 px-3 py-2.5 rounded-t-xl border-b border-border bg-surface cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusDotClass(status)}" title={statusLabel(status)}></span>
    <EditableNodeLabel {id} label={data.label} typeName={def?.label ?? data.stepId} />
    {#if incomplete}
      <span class="shrink-0 text-amber-500" title="Missing required input: {missingRequired.map(([, s]) => s.label ?? '').filter(Boolean).join(', ')}">
        <Icon icon="lucide:triangle-alert" width="12" height="12" />
      </span>
    {/if}
    <span class="text-[10px] text-text-subtle font-medium">
      {statusLabel(status)}
    </span>
    <NodeDeleteButton {id} />
  </div>

  {#if def}
    <div class="px-3 py-2.5 space-y-2.5 nodrag nopan">
      {#each inputKeys as [key, schema]}
        {#if schema.type === 'file'}
          <div>
            <OptionPicker
              value={data.inputs[key] ?? ''}
              groups={buildGroups(schema.accept)}
              label="{schema.label ?? key}{schema.required ? '' : ' (optional)'}"
              placeholder="Select or connect a step…"
              searchPlaceholder="Search…"
              emptyText="No matching options."
              emptyHref="/data"
              disabled={inputsDisabled}
              onchange={(v) => setInput(key, v)}
            />
            {#if schema.description}
              <p class="mt-1 text-[10px] leading-snug text-text-subtle">{schema.description}</p>
            {/if}
          </div>
        {:else if def.type === 'ai-tool' && key === 'modelId'}
          <OptionPicker
            value={data.inputs[key] ?? ''}
            groups={aiModelGroups}
            label="{schema.label ?? key}{schema.required ? '' : ' (optional)'}"
            placeholder="Select an AI Model..."
            searchPlaceholder="Search AI Models..."
            emptyText="No compatible installed AI Models."
            emptyHref="/ai"
            disabled={inputsDisabled}
            onchange={(v) => setInput(key, v)}
          />
        {:else if selectOptions(key, schema).length > 0}
          <div>
            <span class="block text-[11px] text-text-muted mb-1">
              {schema.label ?? key}{schema.required ? '' : ' (optional)'}
            </span>
            <Select
              value={data.inputs[key] ?? String(schema.default ?? '')}
              options={selectOptions(key, schema)}
              disabled={inputsDisabled}
              class="w-full"
              onchange={(v) => setInput(key, v)}
            />
            {#if schema.description}
              <p class="mt-1 text-[10px] leading-snug text-text-subtle">{schema.description}</p>
            {/if}
          </div>
        {:else if schema.type === 'string' || schema.type === 'number'}
          <div>
            <span class="block text-[11px] text-text-muted mb-1">
              {schema.label ?? key}{schema.required ? '' : ' (optional)'}
            </span>
            <ValueRefInput
              value={data.inputs[key] ?? (schema.default as string ?? '')}
              options={schema.connectable === false ? [] : valueOptions(schema.type)}
              type={schema.type === 'number' ? 'number' : 'text'}
              disabled={inputsDisabled}
              onchange={(v) => setInput(key, v)}
            />
            {#if schema.description}
              <p class="mt-1 text-[10px] leading-snug text-text-subtle">{schema.description}</p>
            {/if}
          </div>
        {/if}
      {/each}

      {#if status === 'error' && state?.error}
        <div class="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 font-mono overflow-y-scroll overflow-x-hidden text-wrap break-all max-h-40">
          {sanitizeLocalPathsForDisplay(state.error, 2)}
        </div>
      {/if}
    </div>
  {/if}

  {#if status === 'running' && state?.logs && state.logs.length > 0}
    <div class="px-3 pb-2 text-[10px] font-mono text-text-subtle truncate nodrag nopan">
      {sanitizeLocalPathsForDisplay(state.logs[state.logs.length - 1], 2)}
    </div>
  {/if}

  {#if status === 'done' && state?.outputFiles && state.outputFiles.length > 0}
    <div class="px-3 pb-2.5 nodrag nopan border-t border-border/60 pt-2.5">
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <p class="text-[9px] font-semibold text-text-subtle uppercase tracking-wider">Outputs</p>
        {#if runId}
          <button
            type="button"
            onclick={openResults}
            class="inline-flex items-center gap-1 text-[10px] font-medium text-brand hover:text-brand-hover transition-colors"
          >
            Open in Results
            <Icon icon="lucide:arrow-up-right" width="10" height="10" />
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#each state.outputFiles as f}
          <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700 overflow-y-scroll overflow-x-hidden text-wrap max-h-40">
            <Icon icon="lucide:file" width="8" height="8" />
            {f.label}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  {#if valueOutputs.length > 0}
    <div class="px-3 pb-2.5 pt-2 border-t border-border/60 nodrag nopan">
      <p class="text-[9px] font-semibold text-text-subtle uppercase tracking-wider mb-1">Value outputs</p>
      {#each valueOutputs as [key, schema]}
        <div class="flex items-center gap-1.5 h-5">
          <span class="text-[10px] text-text-muted flex-1 truncate">{schema.label ?? key}</span>
          <span class="text-[10px] font-mono text-text-secondary truncate max-w-32">{fmtValue(key, schema)}</span>
        </div>
      {/each}
    </div>
  {/if}

</div>

<!-- Single output handle — wire to a downstream node, then pick which value/file to use there. -->
<Handle type="source" position={Position.Right} id="output" />

</NodeWrapper>