<script lang="ts">
  import { onMount, tick, setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
    type Connection,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolNode from '$lib/components/pipeline/ToolNode.svelte';
  import StartNode from '$lib/components/pipeline/StartNode.svelte';
  import VariableNode from '$lib/components/pipeline/VariableNode.svelte';
  import MathNode from '$lib/components/pipeline/MathNode.svelte';
  import ConditionNode from '$lib/components/pipeline/ConditionNode.svelte';
  import SubPipelineNode from '$lib/components/pipeline/SubPipelineNode.svelte';
  import ApiRequestNode from '$lib/components/pipeline/ApiRequestNode.svelte';
  import DeletableEdge from '$lib/components/pipeline/DeletableEdge.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let storeReady = $state(false);
  let showAddMenu = $state(false);
  let stepSearch = $state('');
  let editingName = $state(false);
  let nameInput = $state('');
  let saving = $state(false);
  let savedConfirmation = $state(false);

  let unsavedChanges = $state(false);

  const nodeTypes = {
    tool: ToolNode,
    start: StartNode,
    variable: VariableNode,
    math: MathNode,
    condition: ConditionNode,
    'sub-pipeline': SubPipelineNode,
    'api-request': ApiRequestNode,
  };

  // All edges use the custom deletable edge (hover → X button to remove).
  const edgeTypes = { default: DeletableEdge };

  // ── Right-click context menu ─────────────────────────────────────────────────
  let ctxMenu = $state<{ x: number; y: number; kind: 'pane' | 'node' | 'edge'; id?: string } | null>(null);

  function onPaneContextMenu({ event }: { event: MouseEvent }) {
    event.preventDefault();
    ctxMenu = { x: event.clientX, y: event.clientY, kind: 'pane' };
  }
  function onNodeContextMenu({ node, event }: { node: Node; event: MouseEvent }) {
    event.preventDefault();
    if (node.type === 'start') { ctxMenu = null; return; }
    ctxMenu = { x: event.clientX, y: event.clientY, kind: 'node', id: node.id };
  }
  function onEdgeContextMenu({ edge, event }: { edge: Edge; event: MouseEvent }) {
    event.preventDefault();
    ctxMenu = { x: event.clientX, y: event.clientY, kind: 'edge', id: edge.id };
  }
  function closeCtx() { ctxMenu = null; }

  async function deleteNodeById(id: string) {
    nodes = nodes.filter(n => n.id !== id);
    edges = edges.filter(e => e.source !== id && e.target !== id);
    closeCtx();
    await onDelete();
  }
  // Single source of truth for edge removal (used by the edge's X button AND the
  // context menu). xyflow's bind:edges reverts a structural change made during the
  // click cycle, so we defer the removal to the next frame.
  function removeEdgeById(id: string) {
    requestAnimationFrame(() => {
      edges = edges.filter(e => e.id !== id);
      unsavedChanges = true;
      void savePipeline();
    });
  }
  setContext('pipelineEdge', { removeEdgeById });

  function deleteEdgeById(id: string) {
    closeCtx();
    removeEdgeById(id);
  }
  async function duplicateNodeById(id: string) {
    const orig = nodes.find(n => n.id === id);
    if (!orig) return;
    const copy: Node = {
      ...(JSON.parse(JSON.stringify(orig)) as Node),
      id: crypto.randomUUID(),
      position: { x: orig.position.x + 40, y: orig.position.y + 40 },
      selected: false,
    };
    nodes = [...nodes, copy];
    closeCtx();
    unsavedChanges = true;
    await tick();
    await savePipeline();
  }

  // ── Add-step menu ──────────────────────────────────────────────────────────

  interface MenuItem { id: string; label: string; description: string; type: string }

  const toolsByCategory = $derived.by(() => {
    const q = stepSearch.toLowerCase();
    const map: Record<string, MenuItem[]> = {};
    for (const [id, entry] of Object.entries(PIPELINE_REGISTRY)) {
      if (q && !entry.definition.label.toLowerCase().includes(q) && !entry.definition.description.toLowerCase().includes(q)) continue;
      const cat = entry.definition.category;
      (map[cat] ??= []).push({ id, label: entry.definition.label, description: entry.definition.description, type: 'tool' });
    }
    return map;
  });

  const ALL_UTILITY: MenuItem[] = [
    { id: 'variable',     type: 'variable',     label: 'Variable',     description: 'Store a string or number value' },
    { id: 'math',         type: 'math',          label: 'Math',         description: 'Arithmetic between two values' },
    { id: 'condition',    type: 'condition',     label: 'Condition',    description: 'Branch pipeline on a JS expression' },
    { id: 'sub-pipeline', type: 'sub-pipeline',  label: 'Sub-Pipeline', description: 'Run a saved pipeline as a step' },
    { id: 'api-request',  type: 'api-request',   label: 'API Request',  description: 'Call an HTTP request from API Connector' },
  ];

  const filteredUtility = $derived(
    stepSearch.trim()
      ? ALL_UTILITY.filter(n => n.label.toLowerCase().includes(stepSearch.toLowerCase()) || n.description.toLowerCase().includes(stepSearch.toLowerCase()))
      : ALL_UTILITY
  );

  const hasResults = $derived(Object.keys(toolsByCategory).length > 0 || filteredUtility.length > 0);

  // ── Runtime helpers ────────────────────────────────────────────────────────

  const toolNodes = $derived(nodes.filter(n => n.type === 'tool'));

  const canRun = $derived(
    nodes.some(n => n.type !== 'start') &&
    !pipelineStore.running &&
    toolNodes.every(n => {
      const def = PIPELINE_REGISTRY[n.data?.stepId as string ?? '']?.definition;
      if (!def) return false;
      return Object.entries(def.inputSchema).every(([k, s]) => {
        if (!s.required) return true;
        const val = (n.data?.inputs as Record<string, string>)?.[k] ?? '';
        return val !== '';
      });
    }) &&
    nodes.filter(n => n.type === 'sub-pipeline').every(n => n.data?.pipelineId) &&
    nodes.filter(n => n.type === 'api-request').every(n => n.data?.requestId) &&
    nodes.filter(n => n.type === 'condition').every(n => (n.data?.condition as string)?.trim())
  );

  const allDone = $derived(
    nodes.some(n => n.type !== 'start') &&
    nodes.filter(n => n.type !== 'start').every(n => {
      const s = pipelineStore.nodeStates.get(n.id)?.status;
      return s === 'done' || s === 'skipped';
    })
  );

  onMount(async () => {
    await pipelineStore.init();
    dataFiles.init();
    apiConnections.init();

    const pending = pipelineStore.pendingLoad;
    if (pending) {
      nodes = [...(pending.nodes as Node[])];
      edges = pending.edges.map(e => ({ ...e, selectable: false }));
      nameInput = pending.name;
      pipelineStore.clearPendingLoad();
    } else {
      nodes = [...pipelineStore.currentNodes];
      edges = pipelineStore.currentEdges.map(e => ({ ...e, selectable: false }));
      nameInput = pipelineStore.pipelineName;
    }
    storeReady = true;
  });

  $effect(() => {
    if (!storeReady) return;
    pipelineStore.setCurrentState(nodes, edges, nameInput);
  });

  async function addNode(type: string, id: string) {
    const col = nodes.filter(n => n.type !== 'start').length;
    const pos = { x: 200 + (col % 3) * 380, y: 80 + Math.floor(col / 3) * 280 };
    let newNode: Node;
    switch (type) {
      case 'tool':         newNode = { id: crypto.randomUUID(), type, position: pos, data: { stepId: id, inputs: {} } }; break;
      case 'variable':     newNode = { id: crypto.randomUUID(), type, position: pos, data: { varType: 'string', value: '' } }; break;
      case 'math':         newNode = { id: crypto.randomUUID(), type, position: pos, data: { operation: '+', literalA: '', literalB: '' } }; break;
      case 'condition':    newNode = { id: crypto.randomUUID(), type, position: pos, data: { condition: '' } }; break;
      case 'sub-pipeline': newNode = { id: crypto.randomUUID(), type, position: pos, data: { pipelineId: null, pipelineName: '' } }; break;
      case 'api-request':  newNode = { id: crypto.randomUUID(), type, position: pos, data: { requestId: null, requestName: '' } }; break;
      default: return;
    }
    nodes = [...nodes, newNode];
    unsavedChanges = true;
    await savePipeline();
  }

  async function clear() {
    const ok = await confirm({ title: 'Clear pipeline', message: 'Remove all steps and connections?', confirmLabel: 'Clear' });
    if (!ok) return;
    nodes = [];
    edges = [];
    pipelineStore.resetStates([]);
    unsavedChanges = true;
    await savePipeline();
  }

  $effect(()=>{
    if(!savedConfirmation) return;
    setTimeout(()=>{
      if(!savedConfirmation) return;
      savedConfirmation=false;
    }, 2500);
  }) 

  async function savePipeline() {
    if (!nameInput.trim()) return;
    saving = true;
    try {
      await pipelineStore.savePipeline(nameInput.trim());
      unsavedChanges = false;
      // toast.info('Pipeline saved');
      savedConfirmation = true;
    } catch {
      toast.error('Failed to save pipeline');
    } finally {
      saving = false;
    }
  }

  async function connect(connection: Connection) {
    // Allow multiple incoming edges on the generic "input" handle (tool/sub-pipeline nodes).
    // For value handles (a, b, value, etc.) keep single-edge semantics.
    const allowMultiple = connection.targetHandle === 'input';
    edges = [
      ...(allowMultiple
        ? edges
        : edges.filter(e => !(e.target === connection.target && e.targetHandle === connection.targetHandle))),
      {
        id: `${connection.source}:${connection.sourceHandle}→${connection.target}:${connection.targetHandle}`,
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target,
        targetHandle: connection.targetHandle ?? null,
        style: 'stroke: #4f39f6; stroke-width:3;',
        // Not selectable: avoids the xyflow select-on-first-click race that made
        // edge deletion (button + context menu) require two clicks.
        selectable: false,
      },
    ];
    unsavedChanges = true;
  }

  async function onConnect(connection: Connection) {
    await connect(connection);
    await savePipeline();
  }

  // Persist after a node/edge deletion (Delete or Backspace, or context-menu).
  // xyflow has already updated the bound nodes/edges; wait a tick so the
  // $effect propagates them to the store before we save.
  async function onDelete() {
    unsavedChanges = true;
    await tick();
    await savePipeline();
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
   <PageHeader title={nameInput || 'Untitled Pipeline'} description="Visual workflow builder — connect tools to automate analysis">
    {#snippet actions()}
      <div class="flex items-center gap-2">
        {#if editingName}
          <input
            type="text"
            bind:value={nameInput}
            onblur={() => editingName = false}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') editingName = false; }}
            autofocus
            class="text-xs font-medium bg-white border border-brand/60 rounded px-2.5 py-1.5 outline-none w-40"
          />
        {:else}
          <button
            onclick={() => editingName = true}
            class="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-brand transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-100"
          >
            <Icon icon="lucide:pencil" width="12" height="12" />
            <span class="max-lg:hidden">
            Rename
          </span>
          </button>
        {/if}
        <!-- <button
          onclick={() => goto('/pipelines')}
          class="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-100"
        >
          <Icon icon="famicons:grid-outline" width="13" height="13" />
          <span class="max-lg:hidden">
          Pipelines
          </span>
        </button> -->
        {#if nodes.length > 0}
          <Button variant="ghost" size="sm" onclick={clear} disabled={pipelineStore.running}>
            <Icon icon="ph:broom" width="12" height="12" />
            <span class="max-lg:hidden">
            Clear
            </span>
          </Button>
        {/if}
        <div class={unsavedChanges?"":"opacity-60"}>
        <Button variant="ghost" size="sm" loading={saving} onclick={savePipeline} disabled={!nameInput.trim() || !unsavedChanges}>
            <Icon icon="{saving?"svg-spinners:pulse":(savedConfirmation?"lucide:check":"lucide:save")}" width="12" height="12" />
            <span class="max-lg:hidden">
            {saving?"Saving":(savedConfirmation?"Saved":"Save")}
            </span>
          </Button>
        </div>
        <Button
          variant="primary"
          disabled={!canRun}
          loading={pipelineStore.running}
          onclick={() => pipelineStore.run(nodes, edges)}
        >
          <Icon icon="lucide:play" width="12" height="12" />
          Run pipeline
        </Button>
      </div>
    {/snippet}
  </PageHeader>

  <div class="flex-1 relative">
    <SvelteFlow bind:nodes bind:edges {nodeTypes} {edgeTypes} fitView onconnect={onConnect} ondelete={onDelete} deleteKey={['Delete', 'Backspace']} onpanecontextmenu={onPaneContextMenu} onnodecontextmenu={onNodeContextMenu} onedgecontextmenu={onEdgeContextMenu} defaultEdgeOptions={{ selectable: false }} proOptions={{ hideAttribution: true }}>
      <Background gap={24} size={1} color="#e4e4e7" />
      <Controls position="bottom-right" />
    </SvelteFlow>

    {#if nodes.length === 0}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none select-none">
        <div class="h-14 w-14 rounded-2xl bg-white border border-border shadow-sm flex items-center justify-center">
          <Icon icon="lucide:workflow" width="24" height="24" class="text-zinc-300" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium text-zinc-600">No steps yet</p>
          <p class="text-xs text-zinc-400 mt-1">Click "Add step" to start building your pipeline.</p>
        </div>
      </div>
    {/if}

    {#if allDone}
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 shadow-sm">
        <Icon icon="lucide:check" width="14" height="14" class="text-emerald-500" />
        <p class="text-sm text-emerald-800 font-medium">Pipeline complete — outputs added to Data.</p>
      </div>
    {/if}
  </div>

  <div class="border-t border-border bg-surface px-4 py-2 flex items-center gap-3">
    <button
      onclick={() => showAddMenu = !showAddMenu}
      disabled={pipelineStore.running}
      class="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5
             text-sm text-zinc-600 hover:border-brand/40 hover:text-brand transition-colors shadow-sm
             disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon icon="lucide:plus" width="13" height="13" />
      Add step
    </button>
    <span class="text-[11px] text-zinc-400">
      {nodes.filter(n => n.type !== 'start').length} step{nodes.filter(n => n.type !== 'start').length !== 1 ? 's' : ''}
      {#if nodes.length > 0}· Drag to reorder · Connect handles to wire data{/if}
    </span>
  </div>
</div>

{#if ctxMenu}
  <div class="fixed inset-0 z-40" role="presentation"
       onclick={closeCtx}
       oncontextmenu={(e) => { e.preventDefault(); closeCtx(); }}></div>
  <div class="fixed z-50 min-w-44 rounded-lg border border-border bg-white shadow-xl py-1 text-sm overflow-hidden"
       style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;">
    {#if ctxMenu.kind === 'pane'}
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40"
        onclick={() => { closeCtx(); showAddMenu = true; }}>
        <Icon icon="lucide:plus" width="13" height="13" /> Add step
      </button>
    {:else if ctxMenu.kind === 'node'}
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40"
        onclick={() => duplicateNodeById(ctxMenu!.id!)}>
        <Icon icon="lucide:copy" width="13" height="13" /> Duplicate
      </button>
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
        onclick={() => deleteNodeById(ctxMenu!.id!)}>
        <Icon icon="lucide:trash-2" width="13" height="13" /> Delete node
      </button>
    {:else if ctxMenu.kind === 'edge'}
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
        onclick={() => deleteEdgeById(ctxMenu!.id!)}>
        <Icon icon="lucide:trash-2" width="13" height="13" /> Delete connection
      </button>
    {/if}
  </div>
{/if}

{#if showAddMenu}
  <div class="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" role="presentation" onclick={() => { showAddMenu = false; stepSearch = ''; }}></div>
  <div class="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-120 rounded-xl border border-border bg-white shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-surface">
      <Icon icon="lucide:search" width="13" height="13" class="text-zinc-400 shrink-0" />
      <input type="text" bind:value={stepSearch} placeholder="Search steps…" autofocus
        class="flex-1 text-sm bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400" />
      {#if stepSearch}
        <button onclick={() => stepSearch = ''} class="text-zinc-400 hover:text-zinc-600">
          <Icon icon="lucide:x" width="12" height="12" />
        </button>
      {/if}
    </div>

    <div class="overflow-y-auto">
      {#if !hasResults}
        <p class="px-4 py-6 text-center text-sm text-zinc-400">No steps match "{stepSearch}"</p>
      {:else}
        {#if filteredUtility.length > 0}
          <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-surface sticky top-0 z-10">Logic & Control</p>
          {#each filteredUtility as item}
            <button type="button" onclick={() => { addNode(item.type, item.id); showAddMenu = false; stepSearch = ''; }}
              class="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 transition-colors">
              <div class="h-7 w-7 rounded-lg flex items-center justify-center shrink-0
                {item.type === 'variable' ? 'bg-amber-100' : item.type === 'math' ? 'bg-violet-100' :
                 item.type === 'condition' ? 'bg-sky-100' : item.type === 'sub-pipeline' ? 'bg-indigo-100' : 'bg-rose-100'}">
                <Icon
                  icon={item.type === 'variable' ? 'lucide:text-cursor-input' : item.type === 'math' ? 'lucide:calculator' :
                        item.type === 'condition' ? 'lucide:git-branch' : item.type === 'sub-pipeline' ? 'lucide:workflow' : 'lucide:link'}
                  width="13" height="13"
                  class={item.type === 'variable' ? 'text-amber-600' : item.type === 'math' ? 'text-violet-600' :
                         item.type === 'condition' ? 'text-sky-600' : item.type === 'sub-pipeline' ? 'text-indigo-600' : 'text-rose-600'}
                />
              </div>
              <div>
                <span class="text-sm font-medium text-zinc-800">{item.label}</span>
                <p class="text-xs text-zinc-400 mt-0.5">{item.description}</p>
              </div>
            </button>
          {/each}
        {/if}

        {#each Object.entries(toolsByCategory) as [category, tools]}
          <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-surface sticky top-0 z-10">{category}</p>
          {#each tools as tool}
            <button type="button" onclick={() => { addNode('tool', tool.id); showAddMenu = false; stepSearch = ''; }}
              class="w-full text-left flex flex-col px-4 py-2.5 hover:bg-zinc-50 transition-colors">
              <span class="text-sm font-medium text-zinc-800">{tool.label}</span>
              <span class="text-xs text-zinc-400 mt-0.5">{tool.description}</span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  </div>
{/if}
