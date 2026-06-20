<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SvelteFlow,
    Background,
    Controls,
    MiniMap,
    type Node,
    type Edge,
    type Connection,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolNode from '$lib/components/pipeline/ToolNode.svelte';
  import StartNode from '$lib/components/pipeline/StartNode.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
  import type { ToolNodeData } from '$lib/types/pipeline';

  // ── Canvas state ─────────────────────────────────────────────────────────────
  let nodes = $state<Node<ToolNodeData>[]>([]);
  let edges = $state<Edge[]>([]);
  let showAddMenu = $state(false);

  const nodeTypes = { tool: ToolNode, start: StartNode };

  // Group tools by category for the add-step menu
  const stepsByCategory = $derived.by(() => {
    const map: Record<string, { id: string; label: string; description: string }[]> = {};
    for (const [id, entry] of Object.entries(PIPELINE_REGISTRY)) {
      const cat = entry.definition.category;
      (map[cat] ??= []).push({ id, label: entry.definition.label, description: entry.definition.description });
    }
    return map;
  });

  // ── Derived ──────────────────────────────────────────────────────────────────
  const toolNodes = $derived(nodes.filter(n => n.type === 'tool'));

  const canRun = $derived(
    toolNodes.length > 0 && !pipelineStore.running &&
    toolNodes.every(n => {
      const def = PIPELINE_REGISTRY[n.data?.stepId ?? '']?.definition;
      if (!def) return false;
      return Object.entries(def.inputSchema).every(([k, s]) => {
        if (!s.required) return true;
        const val = n.data?.inputs?.[k] ?? '';
        const hasEdge = edges.some(e => e.target === n.id && e.targetHandle === k);
        return val !== '' || hasEdge;
      });
    })
  );

  const allDone = $derived(
    toolNodes.length > 0 &&
    toolNodes.every(n => pipelineStore.nodeStates.get(n.id)?.status === 'done')
  );

  onMount(() => { dataFiles.init(); });

  // ── Actions ──────────────────────────────────────────────────────────────────
  function addToolNode(stepId: string) {
    const entry = PIPELINE_REGISTRY[stepId];
    if (!entry) return;
    const id = crypto.randomUUID();
    const col = toolNodes.length;
    nodes = [...nodes, {
      id,
      type: 'tool',
      position: { x: 200 + (col % 3) * 360, y: 80 + Math.floor(col / 3) * 260 },
      data: { stepId, inputs: {} },
    }];
  }

  function clear() {
    nodes = [];
    edges = [];
    pipelineStore.resetStates([]);
  }

  function onConnect(connection: Connection) {
    // Remove any existing edge to the same target handle (single connection per input)
    edges = [
      ...edges.filter(e => !(e.target === connection.target && e.targetHandle === connection.targetHandle)),
      {
        id: `${connection.source}:${connection.sourceHandle}→${connection.target}:${connection.targetHandle}`,
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target,
        targetHandle: connection.targetHandle ?? null,
        animated: pipelineStore.running,
        style: 'stroke: #4f39f6; stroke-width: 2;',
      },
    ];
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PageHeader title="Pipeline" description="Visual workflow builder — connect tools to automate analysis">
    {#snippet actions()}
      <div class="flex items-center gap-2">
        {#if nodes.length > 0}
          <Button variant="ghost" size="sm" onclick={clear} disabled={pipelineStore.running}>Clear</Button>
        {/if}
        <Button
          variant="primary"
          disabled={!canRun}
          loading={pipelineStore.running}
          onclick={() => pipelineStore.run(nodes, edges)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Run pipeline
        </Button>
      </div>
    {/snippet}
  </PageHeader>

  <!-- Flow canvas -->
  <div class="flex-1 relative">
    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      fitView
      onconnect={onConnect}
      deleteKey="Delete"
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="#e4e4e7" />
      <Controls position="bottom-right" />
      <MiniMap
        position="bottom-left"
        nodeColor={(n) => {
          const s = pipelineStore.nodeStates.get(n.id);
          if (s?.status === 'done')    return '#10b981';
          if (s?.status === 'error')   return '#ef4444';
          if (s?.status === 'running') return '#4f39f6';
          return '#d4d4d8';
        }}
        maskColor="rgba(255,255,255,0.6)"
      />
    </SvelteFlow>

    <!-- Empty state -->
    {#if nodes.length === 0}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none select-none">
        <div class="h-14 w-14 rounded-2xl bg-white border border-border shadow-sm flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
            <line x1="7" y1="12" x2="17" y2="6"/><line x1="7" y1="12" x2="17" y2="18"/>
          </svg>
        </div>
        <div class="text-center">
          <p class="text-sm font-medium text-zinc-600">No steps yet</p>
          <p class="text-xs text-zinc-400 mt-1">Click "Add step" to start building your pipeline.</p>
        </div>
      </div>
    {/if}

    <!-- Success banner -->
    {#if allDone}
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none
                  flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50
                  px-4 py-2.5 shadow-sm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <p class="text-sm text-emerald-800 font-medium">Pipeline complete — outputs added to Data.</p>
      </div>
    {/if}
  </div>

  <!-- Bottom toolbar -->
  <div class="border-t border-border bg-surface px-4 py-2 flex items-center gap-3">
    <button
      onclick={() => showAddMenu = !showAddMenu}
      disabled={pipelineStore.running}
      class="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5
             text-sm text-zinc-600 hover:border-brand/40 hover:text-brand transition-colors shadow-sm
             disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add step
    </button>
    <span class="text-[11px] text-zinc-400">
      {toolNodes.length} step{toolNodes.length !== 1 ? 's' : ''}
      {#if toolNodes.length > 0}· Drag to reorder · Connect output → input handles{/if}
    </span>
  </div>
</div>

<!-- Add step menu (fixed popup) -->
{#if showAddMenu}
  <div class="fixed inset-0 z-40" role="presentation" onclick={() => showAddMenu = false}></div>
  <div class="fixed z-50 bottom-14 left-4 w-68 rounded-xl border border-border bg-white shadow-xl overflow-hidden">
    {#each Object.entries(stepsByCategory) as [category, tools]}
      <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-surface sticky top-0">
        {category}
      </p>
      {#each tools as tool}
        <button
          type="button"
          onclick={() => { addToolNode(tool.id); showAddMenu = false; }}
          class="w-full text-left flex flex-col px-3 py-2 hover:bg-zinc-50 transition-colors"
        >
          <span class="text-sm font-medium text-zinc-800">{tool.label}</span>
          <span class="text-[11px] text-zinc-400 truncate">{tool.description}</span>
        </button>
      {/each}
    {/each}
  </div>
{/if}
