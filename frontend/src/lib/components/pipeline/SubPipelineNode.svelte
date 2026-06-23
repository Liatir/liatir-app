<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { SubPipelineNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';

  let { id, data }: NodeProps<Node<SubPipelineNodeData>> = $props();
  const { updateNodeData } = useSvelteFlow();
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');
  const disabled = $derived(pipelineStore.running);

  // Available pipelines (no cycles, no self)
  const available = $derived(pipelineStore.availableSubPipelines(pipelineStore.pipelineId));

  let showPicker = $state(false);

  function selectPipeline(pid: string, pname: string) {
    updateNodeData(id, { pipelineId: pid, pipelineName: pname });
    showPicker = false;
  }

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }

  const lastLog = $derived(state?.logs?.[state.logs.length - 1] ?? null);
</script>

<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-56 rounded-xl border border-border bg-white shadow-md overflow-hidden">
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-indigo-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <Icon icon="lucide:workflow" width="11" height="11" class="text-indigo-500 shrink-0" />
    <span class="text-[10px] font-semibold text-indigo-700 uppercase tracking-wider">Sub-Pipeline</span>
  </div>

  <div class="px-3 py-2.5 nodrag nopan">
    {#if data.pipelineId}
      <div class="flex items-center gap-2">
        <span class="flex-1 text-xs font-medium text-zinc-700 truncate">{data.pipelineName || 'Pipeline'}</span>
        {#if !disabled}
          <button
            onclick={() => showPicker = true}
            class="text-[10px] text-zinc-400 hover:text-brand transition-colors"
          >Change</button>
        {/if}
      </div>
    {:else}
      <button
        onclick={() => showPicker = true}
        {disabled}
        class="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-3 py-2
               text-[11px] text-indigo-500 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Icon icon="lucide:plus" width="10" height="10" />
        Select pipeline
      </button>
    {/if}

    {#if status === 'running' && lastLog}
      <div class="mt-2 text-[10px] font-mono text-zinc-400 truncate">{lastLog}</div>
    {/if}
    {#if status === 'error' && state?.error}
      <div class="mt-2 text-[10px] text-red-500 font-mono">{state.error}</div>
    {/if}
    {#if status === 'done' && state?.outputFiles && state.outputFiles.length > 0}
      <div class="mt-2 flex flex-wrap gap-1">
        {#each state.outputFiles as f}
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
  <div class="fixed inset-0 z-50" role="presentation" onclick={() => showPicker = false}></div>
  <div class="absolute left-full top-0 ml-2 z-50 w-56 rounded-xl border border-border bg-white shadow-xl overflow-hidden nodrag nopan">
    <div class="px-3 py-2 border-b border-border bg-surface">
      <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Select pipeline</span>
    </div>
    <div class="max-h-48 overflow-y-auto">
      {#each available as p (p.id)}
        <button
          onclick={() => selectPipeline(p.id, p.name)}
          class="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors border-b border-border/50 last:border-0"
        >
          <div class="font-medium">{p.name}</div>
          <div class="text-[10px] text-zinc-400">{p.nodes.filter(n => n.type === 'tool').length} steps</div>
        </button>
      {:else}
        <div class="px-3 py-4 text-center text-xs text-zinc-400">No saved pipelines available</div>
      {/each}
    </div>
  </div>
{/if}
