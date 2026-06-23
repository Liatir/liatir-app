<script lang="ts">
  import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { ToolNodeData } from '$lib/types/pipeline';
  import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import OptionPicker from '$lib/components/ui/OptionPicker.svelte';
  import type { PickerGroup } from '$lib/components/ui/OptionPicker.svelte';
  import { fmtBytes } from '$lib/utils';

  let { id, data }: NodeProps<Node<ToolNodeData>> = $props();

  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();

  const entry = $derived(PIPELINE_REGISTRY[data.stepId]);
  const def = $derived(entry?.definition);
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  const inputKeys = $derived(def ? Object.entries(def.inputSchema) : []);

  const inputsDisabled = $derived(pipelineStore.running);

  function truncatePath(path: string, max = 40): string {
    if (path.length <= max) return path;
    const parts = path.split(/[\\/]/);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : '…' + path.slice(-(max - 1));
  }

  // Build picker options from connected upstream nodes + data files
  function buildGroups(inputType: string, accept: string[] | undefined): PickerGroup[] {
    const groups: PickerGroup[] = [];
    const allNodes = getNodes() as Node<ToolNodeData>[];
    const allEdges = getEdges() as Edge[];

    // Only nodes that have an edge pointing TO this node
    const upstreamIds = new Set(allEdges.filter(e => e.target === id).map(e => e.source));

    const stepItems = allNodes
      .filter(n => upstreamIds.has(n.id) && n.type === 'tool' && n.data?.stepId)
      .flatMap(n => {
        const reg = PIPELINE_REGISTRY[n.data.stepId];
        if (!reg) return [];
        return Object.entries(reg.definition.outputSchema)
          .filter(([, s]) => !accept?.length || !s.ext?.length || accept.some(a => s.ext!.includes(a)))
          .map(([outKey, s]) => ({
            value: `@pipe:${n.id}:${outKey}`,
            label: s.label ?? outKey,
            sublabel: reg.definition.label,
            badge: s.ext?.[0] ?? s.type,
          }));
      });

    if (stepItems.length > 0) groups.push({ title: 'Connected steps', items: stepItems });

    // For file-type inputs, also show data files
    if (inputType === 'file') {
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
    }

    return groups;
  }

  function displayValue(key: string): string {
    const raw = data.inputs[key] ?? '';
    if (raw.startsWith('@pipe:')) {
      const [, nodeId, outKey] = raw.split(':');
      const node = (getNodes() as Node<ToolNodeData>[]).find(n => n.id === nodeId);
      if (!node) return raw;
      const reg = PIPELINE_REGISTRY[node.data.stepId];
      const outDef = reg?.definition.outputSchema[outKey];
      return `${reg?.definition.label ?? nodeId} → ${outDef?.label ?? outKey}`;
    }
    return raw;
  }

  function setInput(key: string, value: string) {
    updateNodeData(id, { inputs: { ...data.inputs, [key]: value } });
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

<div class="min-w-70 max-w-80 rounded-xl border border-border bg-white shadow-md overflow-hidden">

  <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-surface cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="flex-1 text-sm font-semibold text-zinc-800 truncate">{def?.label ?? data.stepId}</span>
    <span class="text-[10px] text-zinc-400 font-medium">
      {status === 'running' ? 'Running…' : status === 'done' ? 'Done' : status === 'error' ? 'Error' : status === 'skipped' ? 'Skipped' : 'Pending'}
    </span>
  </div>

  {#if def}
    <div class="px-3 py-2.5 space-y-2.5 nodrag nopan">
      {#each inputKeys as [key, schema]}
        {#if schema.type === 'file'}
          <OptionPicker
            value={data.inputs[key] ?? ''}
            groups={buildGroups('file', schema.accept)}
            label="{schema.label ?? key}{schema.required ? '' : ' (optional)'}"
            placeholder="Select or connect a step…"
            searchPlaceholder="Search…"
            emptyText="No matching options."
            emptyHref="/data"
            disabled={inputsDisabled}
            onchange={(v) => setInput(key, v)}
          />
        {:else if schema.type === 'string' || schema.type === 'number'}
          <div>
            <label class="block text-[11px] text-zinc-500 mb-1">
              {schema.label ?? key}{schema.required ? '' : ' (optional)'}
            </label>
            <input
              type={schema.type === 'number' ? 'number' : 'text'}
              value={data.inputs[key] ?? (schema.default as string ?? '')}
              oninput={(e) => setInput(key, (e.target as HTMLInputElement).value)}
              disabled={inputsDisabled}
              class="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono
                     placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-brand/40
                     disabled:opacity-50 disabled:cursor-not-allowed"
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

</div>

<Handle type="source" position={Position.Right} id="output" />
