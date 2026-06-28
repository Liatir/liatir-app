<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { VariableNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let { id, data }: NodeProps<Node<VariableNodeData>> = $props();
  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }

  async function updateVariableData(patch: Partial<VariableNodeData>) {
    updateNodeData(id, patch);
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }
</script>

<div class="min-w-48 rounded-xl border border-border bg-white shadow-md overflow-visible">
  <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-border bg-amber-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Variable</span>
    <NodeDeleteButton {id} class="ml-auto" />
  </div>

  <div class="px-3 py-2.5 space-y-2 nodrag nopan">
    <div class="flex gap-1.5">
      <button
        onclick={() => void updateVariableData({ varType: 'string' })}
        class="flex-1 text-[10px] rounded px-2 py-1 border transition-colors
               {data.varType !== 'number' ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium' : 'border-border text-zinc-400 hover:border-zinc-300'}"
      >string</button>
      <button
        onclick={() => void updateVariableData({ varType: 'number' })}
        class="flex-1 text-[10px] rounded px-2 py-1 border transition-colors
               {data.varType === 'number' ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium' : 'border-border text-zinc-400 hover:border-zinc-300'}"
      >number</button>
    </div>
    <input
      type={data.varType === 'number' ? 'number' : 'text'}
      value={data.value ?? ''}
      oninput={(e) => void updateVariableData({ value: (e.target as HTMLInputElement).value })}
      disabled={pipelineStore.running || status === 'done'}
      placeholder={data.varType === 'number' ? '0' : 'value…'}
      class="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono
             placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-400/40
             disabled:opacity-50 disabled:cursor-not-allowed"
    />
    {#if status === 'done' && state?.outputValues?.value !== undefined}
      <div class="text-[10px] text-emerald-600 font-mono truncate">= {state.outputValues.value}</div>
    {/if}
  </div>
</div>

<Handle type="source" position={Position.Right} id="value" />
