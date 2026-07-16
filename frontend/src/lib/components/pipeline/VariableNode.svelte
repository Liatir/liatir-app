<!--
	A pipeline node holding a literal value, to be wired into a step's input.

	It lets a user parameterise a pipeline visually — a threshold, a sample name, a gene ID — and, because
	it is a node, reuse the same value across several steps by connecting it to each. Without it, every
	constant would have to be retyped into each step that needs it.

	The run state is read per node ID from the pipeline store (`pipelineStore.nodeStates.get(id)`), which
	is what keeps each node's status independent — one node running does not freeze the whole canvas.
-->
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { VariableNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import EditableNodeLabel from './EditableNodeLabel.svelte';
  import { statusDotClass, statusLabel } from './node-status';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let { id, data }: NodeProps<Node<VariableNodeData>> = $props();
  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  /**
   * Updates the node *and* persists the graph — see `node-data-commit`. Both halves are needed: the
   * first makes the change visible, the second makes it survive a reload.
   */
  async function updateVariableData(patch: Partial<VariableNodeData>) {
    updateNodeData(id, patch);
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }
</script>

<div class="min-w-48 rounded-xl border border-border bg-surface shadow-md overflow-visible">
  <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-border bg-amber-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusDotClass(status)}" title={statusLabel(status)}></span>
    <EditableNodeLabel
      {id}
      label={data.label}
      typeName="Variable"
      nameClass="text-xs font-semibold text-amber-800"
      typeClass="text-[10px] font-semibold text-amber-700 uppercase tracking-wider"
    />
    <NodeDeleteButton {id} class="ml-auto" />
  </div>

  <!--
    `nodrag nopan`: interacting with the controls below must not drag the node or pan the canvas. Without
    these, selecting text in the input would move the node out from under the cursor.
  -->
  <div class="px-3 py-2.5 space-y-2 nodrag nopan">
    <div class="flex gap-1.5">
      <button
        onclick={() => void updateVariableData({ varType: 'string' })}
        class="flex-1 text-[10px] rounded px-2 py-1 border transition-colors
               {data.varType !== 'number' ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium' : 'border-border text-text-subtle hover:border-border-2'}"
      >string</button>
      <button
        onclick={() => void updateVariableData({ varType: 'number' })}
        class="flex-1 text-[10px] rounded px-2 py-1 border transition-colors
               {data.varType === 'number' ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium' : 'border-border text-text-subtle hover:border-border-2'}"
      >number</button>
    </div>
    <!--
      Locked while the pipeline runs, and once this node has produced its value: editing it mid-run would
      mean the value shown no longer matches the one the downstream steps actually consumed.
    -->
    <input
      type={data.varType === 'number' ? 'number' : 'text'}
      value={data.value ?? ''}
      oninput={(e) => void updateVariableData({ value: (e.target as HTMLInputElement).value })}
      disabled={pipelineStore.running || status === 'done'}
      placeholder={data.varType === 'number' ? '0' : 'value…'}
      class="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono
             placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-amber-400/40
             disabled:opacity-50 disabled:cursor-not-allowed"
    />
    {#if status === 'done' && state?.outputValues?.value !== undefined}
      <div class="text-[10px] text-emerald-600 font-mono truncate">= {state.outputValues.value}</div>
    {/if}
  </div>
</div>

<Handle type="source" position={Position.Right} id="value" />
