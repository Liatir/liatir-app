<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { MathNodeData, MathOperation } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { upstreamOptions } from '$lib/tools/pipeline-io';
  import ValueRefInput from './ValueRefInput.svelte';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let { id, data }: NodeProps<Node<MathNodeData>> = $props();
  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  // Binary ops use both operands; unary ops use only A.
  const BINARY: MathOperation[] = ['+', '-', '*', '/', '%', '^', 'mod', 'min', 'max'];
  const UNARY: MathOperation[]  = ['round', 'floor', 'ceil', 'abs', 'sqrt', 'log2', 'log10', 'ln'];

  const OP_LABELS: Record<MathOperation, string> = {
    '+': '+  add', '-': '−  subtract', '*': '×  multiply', '/': '÷  divide',
    '%': '%  A as % of B', '^': '^  power', 'mod': 'mod  remainder',
    'min': 'min', 'max': 'max',
    'round': 'round', 'floor': 'floor', 'ceil': 'ceil', 'abs': 'abs',
    'sqrt': '√  sqrt', 'log2': 'log₂', 'log10': 'log₁₀', 'ln': 'ln',
  };

  const disabled = $derived(pipelineStore.running);
  const needsB = $derived(BINARY.includes(data.operation ?? '+'));

  // Numeric outputs of connected upstream nodes, usable as operands.
  const operandOptions = $derived.by(() => {
    void state; // re-evaluate as the graph runs
    return upstreamOptions(id, getNodes(), getEdges() as Edge[], 'value', { valueType: 'number' });
  });

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }

  async function updateMathData(patch: Partial<MathNodeData>) {
    updateNodeData(id, patch);
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }
</script>

<!-- Single input handle — wire upstream value nodes in, then pick each operand below. -->
<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-56 rounded-xl border border-border bg-white shadow-md overflow-visible">
  <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-border bg-violet-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="text-[10px] font-semibold text-violet-700 uppercase tracking-wider">Math</span>
    <select
      value={data.operation}
      onchange={(e) => void updateMathData({ operation: (e.target as HTMLSelectElement).value as MathOperation })}
      {disabled}
      onclick={(e) => e.stopPropagation()}
      class="ml-auto text-[10px] border border-violet-200 rounded px-1.5 py-0.5 bg-violet-50 text-violet-700
             font-mono outline-none cursor-pointer disabled:opacity-50 nodrag max-w-36"
    >
      <optgroup label="Binary">
        {#each BINARY as op}<option value={op}>{OP_LABELS[op]}</option>{/each}
      </optgroup>
      <optgroup label="Unary (A only)">
        {#each UNARY as op}<option value={op}>{OP_LABELS[op]}</option>{/each}
      </optgroup>
    </select>
    <NodeDeleteButton {id} />
  </div>

  <div class="px-3 py-2.5 space-y-1.5 nodrag nopan">
    <div class="flex items-center gap-2">
      <span class="text-[10px] text-zinc-400 w-3 shrink-0">A</span>
      <div class="flex-1 min-w-0">
        <ValueRefInput
          value={data.literalA ?? ''}
          options={operandOptions}
          type="number"
          placeholder="0 or link →"
          {disabled}
          accentClass="focus:ring-violet-400/40"
          onchange={(v) => void updateMathData({ literalA: v })}
        />
      </div>
    </div>
    {#if needsB}
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-zinc-400 w-3 shrink-0">B</span>
        <div class="flex-1 min-w-0">
          <ValueRefInput
            value={data.literalB ?? ''}
            options={operandOptions}
            type="number"
            placeholder="0 or link →"
            {disabled}
            accentClass="focus:ring-violet-400/40"
            onchange={(v) => void updateMathData({ literalB: v })}
          />
        </div>
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

<!-- Single output handle (numeric result). -->
<Handle type="source" position={Position.Right} id="result" />
