<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { MathNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';

  let { id, data }: NodeProps<Node<MathNodeData>> = $props();
  const { updateNodeData } = useSvelteFlow();
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  const OPERATIONS: MathNodeData['operation'][] = ['+', '-', '*', '/', 'min', 'max', 'round', 'floor', 'ceil', 'abs'];
  const disabled = $derived(pipelineStore.running || status === 'done');

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }

  const needsB = $derived(!['round', 'floor', 'ceil', 'abs'].includes(data.operation ?? '+'));
</script>

<!-- Input handles -->
<Handle type="target" position={Position.Left} id="a" style="top: 52px" />
{#if needsB}
  <Handle type="target" position={Position.Left} id="b" style="top: 86px" />
{/if}

<div class="min-w-52 rounded-xl border border-border bg-white shadow-md overflow-hidden">
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-violet-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="text-[10px] font-semibold text-violet-700 uppercase tracking-wider">Math</span>
    <select
      bind:value={data.operation}
      onchange={(e) => updateNodeData(id, { operation: (e.target as HTMLSelectElement).value as MathNodeData['operation'] })}
      {disabled}
      onclick={(e) => e.stopPropagation()}
      class="ml-auto text-[10px] border border-violet-200 rounded px-1.5 py-0.5 bg-violet-50 text-violet-700
             font-mono outline-none cursor-pointer disabled:opacity-50 nodrag"
    >
      {#each OPERATIONS as op}
        <option value={op}>{op}</option>
      {/each}
    </select>
  </div>

  <div class="px-3 py-2.5 space-y-1.5 nodrag nopan">
    <div class="flex items-center gap-2">
      <span class="text-[10px] text-zinc-400 w-3 shrink-0">A</span>
      <input
        type="number"
        value={data.literalA ?? ''}
        oninput={(e) => updateNodeData(id, { literalA: (e.target as HTMLInputElement).value })}
        {disabled}
        placeholder="0 or connect →"
        class="flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] font-mono
               placeholder:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-400/40
               disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
    {#if needsB}
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-zinc-400 w-3 shrink-0">B</span>
        <input
          type="number"
          value={data.literalB ?? ''}
          oninput={(e) => updateNodeData(id, { literalB: (e.target as HTMLInputElement).value })}
          {disabled}
          placeholder="0 or connect →"
          class="flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] font-mono
                 placeholder:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-400/40
                 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    {/if}
    {#if status === 'done' && state?.outputValues?.result !== undefined}
      <div class="text-[10px] text-emerald-600 font-mono">= {state.outputValues.result}</div>
    {/if}
    {#if status === 'error' && state?.error}
      <div class="text-[10px] text-red-500 font-mono">{state.error}</div>
    {/if}
  </div>
</div>

<Handle type="source" position={Position.Right} id="result" />
