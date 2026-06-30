<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { ConditionNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { upstreamOptions } from '$lib/tools/pipeline-io';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import ValueRefInput from './ValueRefInput.svelte';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let { id, data }: NodeProps<Node<ConditionNodeData>> = $props();
  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  const conditionInputId = $derived(`condition-${id}`);
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');
  const disabled = $derived(pipelineStore.running);

  // Any value output of a connected upstream node can be tested.
  const valueOptions = $derived.by(() => {
    void state;
    return upstreamOptions(id, getNodes(), getEdges() as Edge[], 'value');
  });

  function statusColor() {
    if (status === 'done') return state?.activeBranch === 'true' ? 'bg-emerald-500' : 'bg-amber-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }

  async function updateConditionData(patch: Partial<ConditionNodeData>) {
    updateNodeData(id, patch);
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }
</script>

<!-- Single input handle — wire upstream value nodes in, then pick the value to test below. -->
<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-56 rounded-xl border border-border bg-white shadow-md overflow-visible">
  <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-border bg-sky-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="text-[10px] font-semibold text-sky-700 uppercase tracking-wider">Condition</span>
    {#if status === 'done' && state?.activeBranch}
      <span class="ml-auto text-[10px] font-mono {state.activeBranch === 'true' ? 'text-emerald-600' : 'text-amber-600'}">
        → {state.activeBranch}
      </span>
    {/if}
    <NodeDeleteButton {id} class="ml-auto" />
  </div>

  <div class="px-3 py-2.5 nodrag nopan space-y-2">
    <div>
      <span class="block text-[10px] text-zinc-400 mb-1">Value to test</span>
      <ValueRefInput
        value={data.valueRef ?? ''}
        options={valueOptions}
        type="text"
        placeholder="literal or link →"
        {disabled}
        accentClass="focus:ring-sky-400/40"
        onchange={(v) => void updateConditionData({ valueRef: v })}
      />
    </div>
    <div>
      <label for={conditionInputId} class="block text-[10px] text-zinc-400 mb-1">Condition <span class="text-zinc-300">(JS, uses <code class="font-mono">value</code>)</span></label>
      <input
        id={conditionInputId}
        type="text"
        value={data.condition ?? ''}
        oninput={(e) => void updateConditionData({ condition: (e.target as HTMLInputElement).value })}
        {disabled}
        placeholder="Number(value) > 1000"
        class="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono
               placeholder:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-sky-400/40
               disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
    {#if status === 'error' && state?.error}
      <div class="text-[10px] text-red-500 font-mono">{sanitizeLocalPathsForDisplay(state.error, 2)}</div>
    {/if}
  </div>
</div>

<!-- Two output handles: true (top-right) and false (bottom-right) -->
<Handle type="source" position={Position.Right} id="trueBranch" style="top: 38px">
  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] text-emerald-600 font-semibold pointer-events-none select-none">T</span>
</Handle>
<Handle type="source" position={Position.Right} id="falseBranch" style="top: 70px">
  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] text-amber-600 font-semibold pointer-events-none select-none">F</span>
</Handle>
