<script lang="ts">
  import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { ToolNodeData, OutputFieldSchema } from '$lib/types/pipeline';
  import { resolveStepEntry } from '$lib/tools/pipeline-registry';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import OptionPicker from '$lib/components/ui/OptionPicker.svelte';
  import type { PickerGroup } from '$lib/components/ui/OptionPicker.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { fmtBytes } from '$lib/utils';
  import { upstreamOptions } from '$lib/tools/pipeline-io';
  import ValueRefInput from './ValueRefInput.svelte';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let { id, data }: NodeProps<Node<ToolNodeData>> = $props();

  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();

  const entry = $derived(resolveStepEntry(data.stepId));
  const def = $derived(entry?.definition);
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  const inputKeys = $derived(def ? Object.entries(def.inputSchema) : []);

  // Non-file outputs exposed as connectable value handles for downstream nodes.
  const valueOutputs = $derived(
    def ? Object.entries(def.outputSchema).filter(([, s]) => s.type !== 'file' && s.type !== 'stats') : []
  );

  function fmtValue(key: string, schema: OutputFieldSchema): string {
    const raw = state?.outputValues?.[key];
    if (raw === undefined) return '–';
    const n = Number(raw);
    if (schema.type !== 'number' || Number.isNaN(n)) return raw.length > 36 ? `${raw.slice(0, 33)}...` : raw;
    if (schema.format === 'percent') return `${n.toFixed(1)}%`;
    if (schema.format === 'integer') return n.toLocaleString();
    return n.toFixed(3);
  }

  const inputsDisabled = $derived(pipelineStore.running);

  function truncatePath(path: string, max = 40): string {
    if (path.length <= max) return path;
    const parts = path.split(/[\\/]/);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : '…' + path.slice(-(max - 1));
  }

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
          sublabel: truncatePath(f.path),
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

  async function setInput(key: string, value: string) {
    updateNodeData(id, { inputs: { ...data.inputs, [key]: value } });
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }
</script>

<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-70 max-w-80 rounded-xl border border-border bg-white shadow-md overflow-visible">

  <div class="flex items-center gap-2 px-3 py-2.5 rounded-t-xl border-b border-border bg-surface cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="flex-1 text-sm font-semibold text-zinc-800 truncate">{def?.label ?? data.stepId}</span>
    <span class="text-[10px] text-zinc-400 font-medium">
      {status === 'running' ? 'Running…' : status === 'done' ? 'Done' : status === 'error' ? 'Error' : status === 'skipped' ? 'Skipped' : 'Pending'}
    </span>
    <NodeDeleteButton {id} />
  </div>

  {#if def}
    <div class="px-3 py-2.5 space-y-2.5 nodrag nopan">
      {#each inputKeys as [key, schema]}
        {#if schema.type === 'file'}
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
        {:else if schema.options && schema.options.length > 0}
          <div>
            <span class="block text-[11px] text-zinc-500 mb-1">
              {schema.label ?? key}{schema.required ? '' : ' (optional)'}
            </span>
            <Select
              value={data.inputs[key] ?? String(schema.default ?? '')}
              options={schema.options.map((option) => ({ value: option.value, label: option.label }))}
              disabled={inputsDisabled}
              class="w-full"
              onchange={(v) => setInput(key, v)}
            />
          </div>
        {:else if schema.type === 'string' || schema.type === 'number'}
          <div>
            <span class="block text-[11px] text-zinc-500 mb-1">
              {schema.label ?? key}{schema.required ? '' : ' (optional)'}
            </span>
            <ValueRefInput
              value={data.inputs[key] ?? (schema.default as string ?? '')}
              options={valueOptions(schema.type)}
              type={schema.type === 'number' ? 'number' : 'text'}
              disabled={inputsDisabled}
              onchange={(v) => setInput(key, v)}
            />
          </div>
        {/if}
      {/each}

      {#if status === 'error' && state?.error}
        <div class="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 font-mono overflow-y-scroll overflow-x-hidden text-wrap break-all max-h-40">
          {state.error}
        </div>
      {/if}
    </div>
  {/if}

  {#if status === 'running' && state?.logs && state.logs.length > 0}
    <div class="px-3 pb-2 text-[10px] font-mono text-zinc-400 truncate nodrag nopan">
      {state.logs[state.logs.length - 1]}
    </div>
  {/if}

  {#if status === 'done' && state?.outputFiles && state.outputFiles.length > 0}
    <div class="px-3 pb-2.5 flex flex-wrap gap-1 nodrag nopan border-t border-border/60 pt-2.5">
      {#each state.outputFiles as f}
        <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700  overflow-y-scroll overflow-x-hidden text-wrap max-h-40">
          <Icon icon="lucide:file" width="8" height="8" />
          {f.label}
        </span>
      {/each}
    </div>
  {/if}

  {#if valueOutputs.length > 0}
    <div class="px-3 pb-2.5 pt-2 border-t border-border/60 nodrag nopan">
      <p class="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Value outputs</p>
      {#each valueOutputs as [key, schema]}
        <div class="flex items-center gap-1.5 h-5">
          <span class="text-[10px] text-zinc-500 flex-1 truncate">{schema.label ?? key}</span>
          <span class="text-[10px] font-mono text-zinc-600 truncate max-w-32">{fmtValue(key, schema)}</span>
        </div>
      {/each}
    </div>
  {/if}

</div>

<!-- Single output handle — wire to a downstream node, then pick which value/file to use there. -->
<Handle type="source" position={Position.Right} id="output" />
