<script lang="ts">
	import NodeWrapper from './layout/NodeContentWrapper.svelte';
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { SubPipelineNodeData } from '$lib/types/pipeline';
  import { isExecutablePipelineNode } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import NodeDeleteButton from './actions/NodeDeleteButton.svelte';
  import EditableNodeLabel from './actions/EditableNodeLabel.svelte';
  import { statusDotClass, statusLabel } from './scripts/node-status';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './scripts/node-data-commit';

  let { id, data }: NodeProps<Node<SubPipelineNodeData>> = $props();
  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  const runState = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(runState?.status ?? 'pending');
  const disabled = $derived(pipelineStore.running);
  const incomplete = $derived(status === 'pending' && !data.pipelineId);

  // Available pipelines (no cycles, no self)
  const available = $derived(pipelineStore.availableSubPipelines(pipelineStore.pipelineId));

  let showPicker = $state(false);

  async function selectPipeline(pid: string, pname: string) {
    updateNodeData(id, { pipelineId: pid, pipelineName: pname });
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
    showPicker = false;
  }

  const lastLog = $derived(runState?.logs?.[runState.logs.length - 1] ?? null);
</script>

<NodeWrapper>

<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-56 rounded-xl border border-border bg-surface shadow-md overflow-visible">
  <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-border bg-indigo-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusDotClass(status)}" title={statusLabel(status)}></span>
    <Icon icon="lucide:workflow" width="11" height="11" class="text-indigo-500 shrink-0" />
    <EditableNodeLabel
      {id}
      label={data.label}
      typeName="Sub-Pipeline"
      nameClass="text-xs font-semibold text-indigo-800"
      typeClass="text-[10px] font-semibold text-indigo-700 uppercase tracking-wider"
    />
    {#if incomplete}
      <span class="ml-auto shrink-0 text-amber-500" title="Select a pipeline to run">
        <Icon icon="lucide:triangle-alert" width="12" height="12" />
      </span>
    {/if}
    <NodeDeleteButton {id} class="ml-auto" />
  </div>

  <div class="px-3 py-2.5 nodrag nopan min-h-[35px]">
    {#if data.pipelineId}
      <button
        onmouseup={() => {
          if(!disabled) showPicker = !showPicker;
        }}
        class="flex items-center gap-2 w-full rounded-lg border hover:border-indigo-500/40 {showPicker?"border-indigo-500/40":"border-border"} transition-colors px-3 py-2">
        <span class="flex-1 text-xs font-medium text-text-secondary truncate w-full text-left">{data.pipelineName || 'Pipeline'}</span>
        {#if !disabled}
          <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img" class="h-4 w-4 shrink-0 text-text-subtle transition {showPicker?"rotate-180":""}" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"></path></svg>
        {/if}
      </button>
    {:else}
      <button
        onmouseup={() => {
          if(!disabled) showPicker = !showPicker;
        }}
        {disabled}
        class="flex items-center gap-2 w-full rounded-lg border border-indigo-500 border-dashed hover:bg-indigo-500/10 {(!disabled)?"cursor-pointer":"cursor-default"} {showPicker?"border-indigo-500/40":"border-border"} transition-colors px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span class="flex-1 text-xs font-medium text-indigo-500 truncate w-full text-left">Select pipeline</span>
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img" class="h-4 w-4 shrink-0 text-text-subtle transition {showPicker?"rotate-180":""}" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"></path></svg>
      </button>
    {/if}

    {#if status === 'running' && lastLog}
      <div class="mt-2 text-[10px] font-mono text-text-subtle truncate">{sanitizeLocalPathsForDisplay(lastLog, 2)}</div>
    {/if}
    {#if status === 'error' && runState?.error}
      <div class="mt-2 text-[10px] text-red-500 font-mono">{sanitizeLocalPathsForDisplay(runState.error, 2)}</div>
    {/if}
    {#if status === 'done' && runState?.outputFiles && runState.outputFiles.length > 0}
      <div class="mt-2 flex flex-wrap gap-1">
        {#each runState.outputFiles as f}
          <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700">
            <Icon icon="lucide:file" width="8" height="8" />
            {f.label}
          </span>
        {/each}
      </div>
    {/if}
  </div>
</div>

<Handle type="source" position={Position.Right} id="output" />

{#if showPicker}
  <div use:clickOutside={{ enabled: showPicker, onOutside: () => (showPicker = false) }} class="nowheel absolute top-full mt-1 z-50 w-56 rounded-xl border border-border bg-surface shadow-xl overflow-hidden nodrag nopan">
    <div class="px-3 py-2 border-b border-border bg-surface">
      <span class="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Select pipeline</span>
    </div>
    <div class="max-h-48 overflow-y-auto">
      {#each available as p (p.id)}
        <button
          onclick={() => selectPipeline(p.id, p.name)}
          class="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-indigo-50 hover:text-indigo-700 transition-colors border-b border-border/50 last:border-0"
        >
          <div class="font-medium">{p.name}</div>
          <div class="text-[10px] text-text-subtle">{p.nodes.filter(isExecutablePipelineNode).length} steps</div>
        </button>
      {:else}
        <div class="px-3 py-4 text-center text-xs text-text-subtle">No saved pipelines available</div>
      {/each}
    </div>
  </div>
{/if}

</NodeWrapper>