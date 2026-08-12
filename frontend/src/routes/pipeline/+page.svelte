<script lang="ts">
  import { onMount, tick, setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    SvelteFlow,
    Background,
    BackgroundVariant,
    Controls,
    Panel,
    type Node,
    type Edge,
    type Connection,
    type NodeTypes,
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
  import NoteNode from '$lib/components/pipeline/NoteNode.svelte';
  import PipelineViewportFitter from '$lib/components/pipeline/layout/PipelineViewportFitter.svelte';
  import DeletableEdge from '$lib/components/pipeline/actions/DeletableEdge.svelte';
  import { PIPELINE_NODE_DATA_CONTEXT, type PipelineNodeDataContext } from '$lib/components/pipeline/scripts/node-data-commit';
  import { isExecutablePipelineNode } from '$lib/types/pipeline';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { liaPluginsStore } from '$lib/stores/lia-plugins.svelte';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { resolveStepEntry, allStepDefinitions } from '$lib/tools/pipeline-registry';
  import { defaultConditionData, isConditionConfigured } from '$lib/pipeline/conditions';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  // Live viewport transform + the flow container, used to drop new nodes into the
  // user's current view instead of a fixed off-screen spot. Left undefined so it
  // doesn't override fitView on mount — xyflow writes the real value back.
  let viewport = $state<{ x: number; y: number; zoom: number } | undefined>(undefined);
  let flowContainer = $state<HTMLDivElement | null>(null);
  let storeReady = $state(false);
  let viewportFitRequest = $state(0);
  let showAddMenu = $state(false);
  let stepSearch = $state('');
  let stepSearchInput = $state<HTMLInputElement | null>(null);
  let editingName = $state(false);
  let nameEditorInput = $state<HTMLInputElement | null>(null);
  let nameInput = $state('');
  let saving = $state(false);
  let savedConfirmation = $state(false);
  let nodeDataPersistTimer: ReturnType<typeof setTimeout> | undefined;

  let unsavedChanges = $state(false);

  // The done/error result banner is shown only right after a run and is dismissed
  // the moment the graph is edited. Leaving/returning to the canvas remounts the
  // page, so this naturally resets to false on re-entry.
  let showRunResult = $state(false);
  let runResultGraphKey = '';
  let wasRunning = false;

  type GraphSnapshot = { nodes: Node[]; edges: Edge[] };

  const HISTORY_LIMIT = 80;
  let undoStack = $state<GraphSnapshot[]>([]);
  let redoStack = $state<GraphSnapshot[]>([]);
  let historyReady = false;
  let restoringGraphHistory = false;
  let lastGraphSnapshot: GraphSnapshot | null = null;
  let lastGraphKey = '';
  let draggingGraphNodes = false;
  let dragStartSnapshot: GraphSnapshot | null = null;
  let dragStartKey = '';

  const nodeTypes: NodeTypes = {
    tool: ToolNode,
    start: StartNode,
    variable: VariableNode,
    math: MathNode,
    condition: ConditionNode,
    'sub-pipeline': SubPipelineNode,
    'api-request': ApiRequestNode,
    note: NoteNode,
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
    edges = edges.filter(e => e.id !== id);
    onDelete();
  }
  setContext('pipelineEdge', { removeEdgeById });

  function commitNodeDataChange(nextNodes: Node[], nextEdges: Edge[]) {
    if (!storeReady) return;
    nodes = nextNodes.map(node => ({
      ...node,
      data: JSON.parse(JSON.stringify(node.data ?? {})),
    }));
    edges = dedupeEdges(nextEdges).map(edge => ({ ...edge, selectable: false }));
    unsavedChanges = true;
    pipelineStore.setCurrentState(nodes, edges, nameInput);
    clearTimeout(nodeDataPersistTimer);
    nodeDataPersistTimer = setTimeout(() => {
      void persistPipelineSilently();
    }, 350);
  }

  setContext<PipelineNodeDataContext>(PIPELINE_NODE_DATA_CONTEXT, { commitNodeDataChange });

  // Collapse duplicate edges (same source/handle → target/handle) into one.
  // Older saved pipelines may contain a duplicate left by the previous connect()
  // bug (xyflow's auto-added edge + a manual one); this cleans them on load.
  function dedupeEdges(es: Edge[]): Edge[] {
    const seen = new Set<string>();
    const out: Edge[] = [];
    for (const e of es) {
      const key = `${e.source}|${e.sourceHandle}|${e.target}|${e.targetHandle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }

  function edgeMatchesConnection(edge: Edge, connection: Connection): boolean {
    return edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
      (edge.targetHandle ?? null) === (connection.targetHandle ?? null);
  }

  function connectionCreatesCycle(connection: Connection, candidateEdges: Edge[]): boolean {
    const source = connection.source;
    const target = connection.target;
    if (!source || !target) return true;
    if (source === target) return true;

    const graph = new Map<string, string[]>();
    for (const edge of candidateEdges) {
      if (!edge.source || !edge.target) continue;
      const outgoing = graph.get(edge.source) ?? [];
      outgoing.push(edge.target);
      graph.set(edge.source, outgoing);
    }

    const queue = [target];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === source) return true;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      queue.push(...(graph.get(nodeId) ?? []));
    }

    return false;
  }

  function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function normalizeNodeForHistory(node: Node): Node {
    const normalized: Node = {
      id: node.id,
      type: node.type,
      position: {
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0,
      },
      data: cloneJson(node.data ?? {}),
    };
    if (node.parentId) normalized.parentId = node.parentId;
    if (node.extent) normalized.extent = node.extent;
    if (node.hidden !== undefined) normalized.hidden = node.hidden;
    return normalized;
  }

  function normalizeEdgeForHistory(edge: Edge): Edge {
    const normalized: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      selectable: false,
    };
    if (edge.sourceHandle !== undefined && edge.sourceHandle !== null) normalized.sourceHandle = edge.sourceHandle;
    if (edge.targetHandle !== undefined && edge.targetHandle !== null) normalized.targetHandle = edge.targetHandle;
    if (edge.type) normalized.type = edge.type;
    if (edge.data) normalized.data = cloneJson(edge.data);
    if (edge.hidden !== undefined) normalized.hidden = edge.hidden;
    return normalized;
  }

  function cloneGraphSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
    return {
      nodes: snapshot.nodes.map(normalizeNodeForHistory),
      edges: snapshot.edges.map(normalizeEdgeForHistory),
    };
  }

  function createGraphSnapshot(): GraphSnapshot {
    return {
      nodes: nodes.map(normalizeNodeForHistory),
      edges: dedupeEdges(edges).map(normalizeEdgeForHistory),
    };
  }

  function graphSnapshotKey(snapshot: GraphSnapshot): string {
    return JSON.stringify(snapshot);
  }

  function resetGraphHistory() {
    undoStack = [];
    redoStack = [];
    historyReady = false;
    restoringGraphHistory = false;
    lastGraphSnapshot = null;
    lastGraphKey = '';
    draggingGraphNodes = false;
    dragStartSnapshot = null;
    dragStartKey = '';
  }

  function initializeGraphHistory(snapshot: GraphSnapshot) {
    resetGraphHistory();
    lastGraphSnapshot = cloneGraphSnapshot(snapshot);
    lastGraphKey = graphSnapshotKey(lastGraphSnapshot);
    historyReady = true;
  }

  function syncGraphHistory(currentSnapshot: GraphSnapshot) {
    const currentKey = graphSnapshotKey(currentSnapshot);

    if (!historyReady) {
      historyReady = true;
      lastGraphSnapshot = cloneGraphSnapshot(currentSnapshot);
      lastGraphKey = currentKey;
      return;
    }

    if (currentKey === lastGraphKey) return;

    if (draggingGraphNodes) {
      lastGraphSnapshot = cloneGraphSnapshot(currentSnapshot);
      lastGraphKey = currentKey;
      return;
    }

    if (!restoringGraphHistory && lastGraphSnapshot) {
      const previous = cloneGraphSnapshot(lastGraphSnapshot);
      if (graphSnapshotKey(previous) !== currentKey) {
        undoStack = [...undoStack, previous].slice(-HISTORY_LIMIT);
      }
      redoStack = [];
    }

    lastGraphSnapshot = cloneGraphSnapshot(currentSnapshot);
    lastGraphKey = currentKey;
  }

  async function restoreGraphSnapshot(snapshot: GraphSnapshot) {
    restoringGraphHistory = true;
    nodes = snapshot.nodes.map(normalizeNodeForHistory);
    edges = dedupeEdges(snapshot.edges).map(normalizeEdgeForHistory);
    unsavedChanges = true;
    await tick();
    restoringGraphHistory = false;
    await savePipeline();
  }

  function beginGraphDrag() {
    if (!storeReady || restoringGraphHistory || draggingGraphNodes) return;
    dragStartSnapshot = createGraphSnapshot();
    dragStartKey = graphSnapshotKey(dragStartSnapshot);
    draggingGraphNodes = true;
  }

  async function finishGraphDrag() {
    if (!draggingGraphNodes) return;
    await tick();

    const finalSnapshot = createGraphSnapshot();
    const finalKey = graphSnapshotKey(finalSnapshot);
    draggingGraphNodes = false;

    if (dragStartSnapshot && finalKey !== dragStartKey) {
      undoStack = [...undoStack, cloneGraphSnapshot(dragStartSnapshot)].slice(-HISTORY_LIMIT);
      redoStack = [];
      unsavedChanges = true;
      await persistPipelineSilently();
    }

    lastGraphSnapshot = cloneGraphSnapshot(finalSnapshot);
    lastGraphKey = finalKey;
    dragStartSnapshot = null;
    dragStartKey = '';
  }

  function hasDifferentSnapshot(stack: GraphSnapshot[]): boolean {
    const currentKey = graphSnapshotKey(createGraphSnapshot());
    return stack.some((snapshot) => graphSnapshotKey(snapshot) !== currentKey);
  }

  const canUndo = $derived(hasDifferentSnapshot(undoStack) && !pipelineStore.running);
  const canRedo = $derived(hasDifferentSnapshot(redoStack) && !pipelineStore.running);

  function popDifferentSnapshot(
    stack: GraphSnapshot[],
    currentKey: string
  ): { target: GraphSnapshot | null; rest: GraphSnapshot[] } {
    const rest = [...stack];
    while (rest.length > 0) {
      const target = rest[rest.length - 1];
      rest.pop();
      if (graphSnapshotKey(target) !== currentKey) return { target, rest };
    }
    return { target: null, rest };
  }

  function pushDistinctSnapshot(stack: GraphSnapshot[], snapshot: GraphSnapshot): GraphSnapshot[] {
    const key = graphSnapshotKey(snapshot);
    if (stack.length > 0 && graphSnapshotKey(stack[stack.length - 1]) === key) return stack;
    return [...stack, cloneGraphSnapshot(snapshot)].slice(-HISTORY_LIMIT);
  }

  async function undoGraphChange() {
    if (!canUndo) return;
    const current = createGraphSnapshot();
    const { target: previous, rest } = popDifferentSnapshot(undoStack, graphSnapshotKey(current));
    undoStack = rest;
    if (!previous) return;
    redoStack = pushDistinctSnapshot(redoStack, current);
    await restoreGraphSnapshot(previous);
  }

  async function redoGraphChange() {
    if (!canRedo) return;
    const current = createGraphSnapshot();
    const { target: next, rest } = popDifferentSnapshot(redoStack, graphSnapshotKey(current));
    redoStack = rest;
    if (!next) return;
    undoStack = pushDistinctSnapshot(undoStack, current);
    await restoreGraphSnapshot(next);
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return false;
    const tag = element.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
  }

  function handleKeyboardShortcut(event: KeyboardEvent) {
    const isModifierPressed = event.metaKey || event.ctrlKey;
    if (!isModifierPressed) return;

    const key = event.key.toLowerCase();

    // Global shortcuts — intentionally work even while a node field is focused.
    if (key === 's') {
      event.preventDefault();
      if (nameInput.trim() && unsavedChanges && !saving) void savePipeline();
      return;
    }
    if (key === 'enter') {
      event.preventDefault();
      if (canRun) void pipelineStore.run(nodes, edges);
      return;
    }

    // Undo / redo — ignored while typing so they don't hijack text editing.
    if (isEditableTarget(event.target)) return;
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undoGraphChange();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      void redoGraphChange();
    }
  }

  function onGraphDragStart() {
    beginGraphDrag();
  }

  function onGraphDragStop() {
    void finishGraphDrag();
  }

  async function deleteEdgeById(id: string) {
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
    for (const def of allStepDefinitions()) {
      if (q && !def.label.toLowerCase().includes(q) && !def.description.toLowerCase().includes(q)) continue;
      (map[def.category] ??= []).push({ id: def.id, label: def.label, description: def.description, type: 'tool' });
    }
    return map;
  });

  const ALL_UTILITY: MenuItem[] = [
    { id: 'variable',     type: 'variable',     label: 'Variable',     description: 'Store a string or number value' },
    { id: 'math',         type: 'math',          label: 'Math',         description: 'Arithmetic between two values' },
    { id: 'condition',    type: 'condition',     label: 'Condition',    description: 'Branch pipeline with no-code rules' },
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

  const executableNodes = $derived(nodes.filter(isExecutablePipelineNode));
  const toolNodes = $derived(nodes.filter(n => n.type === 'tool'));

  function defaultInputValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function nodeInputValue(n: Node, key: string, fallback: unknown): string {
    const inputs = n.data?.inputs as Record<string, string> | undefined;
    return inputs?.[key] ?? defaultInputValue(fallback);
  }

  function defaultInputsForStep(stepId: string): Record<string, string> {
    const def = resolveStepEntry(stepId)?.definition;
    if (!def) return {};
    const inputs: Record<string, string> = {};
    for (const [key, schema] of Object.entries(def.inputSchema)) {
      if (schema.default !== undefined) inputs[key] = defaultInputValue(schema.default);
    }
    return inputs;
  }

  const canRun = $derived(
    executableNodes.length > 0 &&
    !pipelineStore.running &&
    toolNodes.every(n => {
      const def = resolveStepEntry(n.data?.stepId as string ?? '')?.definition;
      if (!def) return false;
      return Object.entries(def.inputSchema).every(([k, s]) => {
        if (!s.required) return true;
        const val = nodeInputValue(n, k, s.default);
        return val !== '';
      });
    }) &&
    executableNodes.filter(n => n.type === 'sub-pipeline').every(n => n.data?.pipelineId) &&
    executableNodes.filter(n => n.type === 'api-request').every(n => n.data?.requestId) &&
    executableNodes.filter(n => n.type === 'condition').every(n => isConditionConfigured(n.data))
  );

  // Steps that have finished (done or skipped) — drives the running progress banner.
  const doneCount = $derived(
    executableNodes.filter(n => {
      const s = pipelineStore.nodeStates.get(n.id)?.status;
      return s === 'done' || s === 'skipped';
    }).length
  );

  const allDone = $derived(
    executableNodes.length > 0 &&
    executableNodes.every(n => {
      const s = pipelineStore.nodeStates.get(n.id)?.status;
      return s === 'done' || s === 'skipped';
    })
  );
  const hasRunError = $derived(
    executableNodes.length > 0 &&
    executableNodes.some(n => pipelineStore.nodeStates.get(n.id)?.status === 'error')
  );

  onMount(async () => {
    await pipelineStore.init();
    dataFiles.init();
    apiConnections.init();
    liaPluginsStore.init(); // make imported .lia plugins available as pipeline steps
    await aiModelsStore.init();

    const pending = pipelineStore.pendingLoad;
    if (pending) {
      nodes = [...(pending.nodes as Node[])];
      edges = dedupeEdges(pending.edges).map(e => ({ ...e, selectable: false }));
      nameInput = pending.name;
      pipelineStore.clearPendingLoad();
    } else {
      nodes = [...pipelineStore.currentNodes];
      edges = dedupeEdges(pipelineStore.currentEdges).map(e => ({ ...e, selectable: false }));
      nameInput = pipelineStore.pipelineName;
    }
    initializeGraphHistory(createGraphSnapshot());
    storeReady = true;
    viewportFitRequest += 1;
  });

  $effect(() => {
    if (!storeReady) return;
    syncGraphHistory(createGraphSnapshot());
    pipelineStore.setCurrentState(nodes, edges, nameInput);
  });

  // Reveal the result banner when a run finishes; snapshot the graph so any later
  // structural edit can dismiss it.
  $effect(() => {
    const running = pipelineStore.running;
    if (wasRunning && !running) {
      showRunResult = true;
      runResultGraphKey = graphSnapshotKey(createGraphSnapshot());
    }
    wasRunning = running;
  });

  // Editing the graph (add / move / connect / edit a field) dismisses the banner.
  // Uses the structural key, so xyflow's measurement churn doesn't trigger it.
  $effect(() => {
    if (!showRunResult) return;
    if (graphSnapshotKey(createGraphSnapshot()) !== runResultGraphKey) {
      showRunResult = false;
    }
  });

  $effect(() => {
    if (editingName && nameEditorInput) setTimeout(() => nameEditorInput?.focus(), 30);
  });

  $effect(() => {
    if (showAddMenu && stepSearchInput) setTimeout(() => stepSearchInput?.focus(), 30);
  });

  // Flow-coordinate position at the center of the visible pane, cascaded slightly
  // per node so successive adds don't stack exactly. Falls back to a grid layout if
  // the viewport hasn't been measured yet.
  function nextNodePosition(): { x: number; y: number } {
    const rect = flowContainer?.getBoundingClientRect();
    const step = nodes.filter(n => n.type !== 'start').length % 6;
    if (!rect || !viewport || !viewport.zoom) {
      return { x: 200 + (step % 3) * 380, y: 80 + Math.floor(step / 3) * 280 };
    }
    const cx = (rect.width / 2 - viewport.x) / viewport.zoom;
    const cy = (rect.height / 2 - viewport.y) / viewport.zoom;
    return { x: Math.round(cx - 140 + step * 28), y: Math.round(cy - 70 + step * 28) };
  }

  async function addNode(type: string, id: string) {
    const pos = nextNodePosition();
    let newNode: Node;
    switch (type) {
      case 'tool':         newNode = { id: crypto.randomUUID(), type, position: pos, data: { stepId: id, inputs: defaultInputsForStep(id) } }; break;
      case 'variable':     newNode = { id: crypto.randomUUID(), type, position: pos, data: { varType: 'string', value: '' } }; break;
      case 'math':         newNode = { id: crypto.randomUUID(), type, position: pos, data: { operation: '+', literalA: '', literalB: '' } }; break;
      case 'condition':    newNode = { id: crypto.randomUUID(), type, position: pos, data: defaultConditionData() }; break;
      case 'sub-pipeline': newNode = { id: crypto.randomUUID(), type, position: pos, data: { pipelineId: null, pipelineName: '' } }; break;
      case 'api-request':  newNode = { id: crypto.randomUUID(), type, position: pos, data: { requestId: null, requestName: '', paramOverrides: {} } }; break;
      case 'note':         newNode = { id: crypto.randomUUID(), type, position: pos, data: { text: '', width: 260 } }; break;
      default: return;
    }
    nodes = [...nodes, newNode];
    unsavedChanges = true;
    await savePipeline();
  }

  async function addNote() {
    await addNode('note', 'note');
  }

  async function clear() {
    const ok = await confirm({ title: 'Clear pipeline', message: 'Remove all steps, notes, and connections?', confirmLabel: 'Clear' });
    if (!ok) return;
    nodes = [];
    edges = [];
    pipelineStore.resetStates([]);
    unsavedChanges = true;
    await savePipeline();
  }

  async function savePipeline() {
    if (!nameInput.trim()) return;
    await tick();
    saving = true;
    try {
      await pipelineStore.savePipeline(nameInput.trim());
      unsavedChanges = false;
      savedConfirmation = true;
      setTimeout(()=>{
        if(!savedConfirmation) return;
        savedConfirmation=false;
      }, 2500);
      // toast.info('Pipeline saved');
    } catch {
      toast.error('Failed to save pipeline');
    } finally {
      saving = false;
    }
  }

  async function persistPipelineSilently() {
    if (!nameInput.trim()) return;
    await tick();
    try {
      await pipelineStore.savePipeline(nameInput.trim());
      unsavedChanges = false;
    } catch {
      toast.error('Failed to save pipeline');
    }
  }

  function connect(connection: Connection): boolean {
    // IMPORTANT: with bind:edges, xyflow already adds the new edge itself.
    // Do NOT add a second one here — that produced duplicate overlapping edges
    // (the root cause of "delete needs two clicks"). Every node now has a single
    // "input" handle that accepts multiple incoming edges (one per upstream
    // provider); the actual field→output wiring is chosen inside the node, so we
    // only need to collapse any exact-duplicate edge and mark the graph dirty.
    const nextEdges = dedupeEdges(edges);
    if (connectionCreatesCycle(connection, nextEdges)) {
      edges = nextEdges.filter(edge => !edgeMatchesConnection(edge, connection));
      toast.error('This connection would create a cycle');
      return false;
    }
    edges = nextEdges;
    unsavedChanges = true;
    return true;
  }

  async function onConnect(connection: Connection) {
    if (connect(connection)) await savePipeline();
  }

  // Persist after a node/edge deletion (Delete or Backspace, or context-menu).
  // xyflow has already updated the bound nodes/edges; wait a tick so the
  // $effect propagates them to the store before we save.
  async function onDelete() {
    unsavedChanges = true;
    await savePipeline();
  }

  // Renaming from the header must persist to the SAVED pipeline entry: the reactive
  // setCurrentState only updates the working copy, so commit + save explicitly.
  // Guarded so the blur that follows Enter/Escape doesn't save twice.
  function commitName() {
    if (!editingName) return;
    editingName = false;
    if (!nameInput.trim()) return;
    unsavedChanges = true;
    void savePipeline();
  }
</script>

<svelte:window onkeydown={handleKeyboardShortcut} />

<div
  class="flex flex-col h-full overflow-hidden"
  data-testid="pipeline-editor"
  data-pipeline-id={pipelineStore.pipelineId ?? 'draft'}
>
   <PageHeader title={nameInput || 'Untitled Pipeline'} description="Visual workflow builder — connect tools to automate analysis">
    {#snippet actions()}
      <div class="flex items-center gap-2">
        {#if editingName}
          <input
            type="text"
            bind:this={nameEditorInput}
            bind:value={nameInput}
            onblur={commitName}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitName(); }}
            class="text-xs font-medium bg-surface border border-brand/60 rounded px-2.5 py-1.5 outline-none w-40"
          />
        {:else}
          <button
            onclick={() => editingName = true}
            class="flex items-center gap-1.5 text-xs text-text-muted hover:text-brand transition-colors px-2 py-1.5 rounded-lg hover:bg-surface-2"
          >
            <Icon icon="lucide:pencil" width="12" height="12" />
            <span class="max-lg:hidden">
            Rename
          </span>
          </button>
        {/if}
        <!-- <button
          onclick={() => goto('/pipelines')}
          class="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors px-2 py-1.5 rounded-lg hover:bg-surface-2"
        >
          <Icon icon="famicons:grid-outline" width="13" height="13" />
          <span class="max-lg:hidden">
          Pipelines
          </span>
        </button> -->
        <div class="flex items-center gap-1">
          <button
            type="button"
            title="Undo"
            aria-label="Undo"
            onclick={() => void undoGraphChange()}
            disabled={!canUndo}
            class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon icon="lucide:undo-2" width="13" height="13" />
          </button>
          <button
            type="button"
            title="Redo"
            aria-label="Redo"
            onclick={() => void redoGraphChange()}
            disabled={!canRedo}
            class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon icon="lucide:redo-2" width="13" height="13" />
          </button>
        </div>
        {#if nodes.length > 0}
          <Button variant="ghost" size="sm" onclick={clear} disabled={pipelineStore.running}>
            <Icon icon="ph:broom" width="12" height="12" />
            <span class="max-lg:hidden">
            Clear
            </span>
          </Button>
        {/if}
        <div class={(unsavedChanges && !savedConfirmation && !saving)?"":"opacity-60"}>
        <Button variant="ghost" size="sm" loading={saving} onclick={savePipeline} disabled={!nameInput.trim() || !unsavedChanges}>
            <Icon icon={saving ? "svg-spinners:pulse" : (savedConfirmation ? "lucide:check" : "lucide:save")} width="12" height="12" class={(unsavedChanges && !savedConfirmation && !saving) ? "color: text-brand-hover" : ""}/>
            <span class="max-lg:hidden {(unsavedChanges && !savedConfirmation && !saving)?"color: text-brand-hover":""}">
            {saving?"Saving":(savedConfirmation?"Saved":"Save")}
            </span>
          </Button>
        </div>
        {#if pipelineStore.running}
          <Button
            variant="danger"
            testId="pipeline-cancel-button"
            onclick={() => pipelineStore.cancel()}
          >
            <Icon icon="lucide:square" width="12" height="12" />
            Cancel pipeline
          </Button>
        {:else}
          <Button
            variant="primary"
            testId="pipeline-run-button"
            disabled={!canRun}
            onclick={() => pipelineStore.run(nodes, edges)}
          >
            <Icon icon="lucide:play" width="12" height="12" />
            Run pipeline
          </Button>
        {/if}
      </div>
    {/snippet}
  </PageHeader>

  <div class="flex-1 relative" bind:this={flowContainer}>
    <SvelteFlow bind:nodes bind:edges bind:viewport {nodeTypes} {edgeTypes} onconnect={onConnect} ondelete={onDelete} deleteKey={pipelineStore.running ? [] : ['Delete', 'Backspace']} nodesDraggable={!pipelineStore.running} nodesConnectable={!pipelineStore.running} onpanecontextmenu={onPaneContextMenu} onnodecontextmenu={onNodeContextMenu} onedgecontextmenu={onEdgeContextMenu} onnodedragstart={onGraphDragStart} onnodedragstop={onGraphDragStop} onselectiondragstart={onGraphDragStart} onselectiondragstop={onGraphDragStop} defaultEdgeOptions={{ selectable: false, style: 'stroke: #0A948B; stroke-width:3;' }} proOptions={{ hideAttribution: true }} colorMode={settingsStore.resolvedTheme}>
      <PipelineViewportFitter request={viewportFitRequest} />
      <Background gap={24} size={2} patternColor="var(--color-border-2)" variant={BackgroundVariant.Dots} />
      <Panel position="top-left" class="rounded-lg border border-border bg-surface/95 shadow-sm">
        <button
          type="button"
          title="Add note"
          aria-label="Add note"
          onclick={() => void addNote()}
          disabled={pipelineStore.running}
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-brand disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
        >
          <Icon icon="lucide:sticky-note" width="13" height="13" />
          Note
        </button>
      </Panel>
      <Controls position="bottom-right" />
    </SvelteFlow>

    {#if nodes.length === 0}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none select-none">
        <div class="h-14 w-14 rounded-2xl bg-surface border border-border shadow-sm flex items-center justify-center">
          <Icon icon="lucide:workflow" width="24" height="24" class="text-text-faint" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium text-text-secondary">No steps yet</p>
          <p class="text-xs text-text-subtle mt-1">Add a step to start building your pipeline.</p>
        </div>
        <button
          type="button"
          onclick={() => showAddMenu = true}
          class="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-hover"
        >
          <Icon icon="lucide:plus" width="14" height="14" />
          Add step
        </button>
      </div>
    {/if}

    {#if pipelineStore.running}
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 shadow-sm">
        <Icon icon="svg-spinners:ring-resize" width="14" height="14" class="text-sky-500" />
        <p class="text-sm text-sky-800 font-medium">Pipeline running… {doneCount}/{executableNodes.length} steps</p>
      </div>
    {:else if allDone && showRunResult}
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 shadow-sm">
        <Icon icon="lucide:check" width="14" height="14" class="text-emerald-500" />
        <p class="text-sm text-emerald-800 font-medium">Pipeline complete — outputs added to Data.</p>
        {#if pipelineStore.currentRunId}
          <button
            type="button"
            class="rounded-lg border border-emerald-200 bg-surface px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
            onclick={() => goto(`/results?run=${pipelineStore.currentRunId}`)}
          >
            Open Results
          </button>
        {/if}
      </div>
    {:else if hasRunError && showRunResult}
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 shadow-sm">
        <Icon icon="lucide:circle-alert" width="14" height="14" class="text-red-500" />
        <p class="text-sm text-red-800 font-medium">Pipeline failed — open Results for logs and details.</p>
        {#if pipelineStore.currentRunId}
          <button
            type="button"
            class="rounded-lg border border-red-200 bg-surface px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
            onclick={() => goto(`/results?run=${pipelineStore.currentRunId}`)}
          >
            Open Results
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="border-t border-border bg-surface px-4 py-2 flex items-center gap-3">
    <button
      onclick={() => showAddMenu = !showAddMenu}
      disabled={pipelineStore.running}
      class="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5
             text-sm text-text-secondary hover:border-brand/40 hover:text-brand transition-colors shadow-sm
             disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon icon="lucide:plus" width="13" height="13" />
      Add step
    </button>
    <button
      onclick={() => void addNote()}
      disabled={pipelineStore.running}
      class="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5
             text-sm text-text-secondary hover:border-amber-300 hover:text-amber-700 transition-colors shadow-sm
             disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon icon="lucide:sticky-note" width="13" height="13" />
      Add note
    </button>
    <span class="text-[11px] text-text-subtle">
      {executableNodes.length} step{executableNodes.length !== 1 ? 's' : ''}
      {#if nodes.length > 0}· Drag to move · Connect handles to wire data{/if}
    </span>
  </div>
</div>

{#if ctxMenu}
  <div class="fixed inset-0 z-40" role="presentation"
       onclick={closeCtx}
       oncontextmenu={(e) => { e.preventDefault(); closeCtx(); }}></div>
  <div class="fixed z-50 min-w-44 rounded-lg border border-border bg-surface shadow-xl py-1 text-sm overflow-hidden"
       style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;">
    {#if ctxMenu.kind === 'pane'}
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40"
        onclick={() => { closeCtx(); void addNote(); }}>
        <Icon icon="lucide:sticky-note" width="13" height="13" /> Add note
      </button>
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40"
        onclick={() => { closeCtx(); showAddMenu = true; }}>
        <Icon icon="lucide:plus" width="13" height="13" /> Add step
      </button>
    {:else if ctxMenu.kind === 'node'}
      <button type="button" disabled={pipelineStore.running}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40"
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
  <div class="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-120 rounded-xl border border-border bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-surface">
      <Icon icon="lucide:search" width="13" height="13" class="text-text-subtle shrink-0" />
      <input type="text" bind:this={stepSearchInput} bind:value={stepSearch} placeholder="Search steps…"
        class="flex-1 text-sm bg-transparent outline-none text-text placeholder:text-text-subtle" />
      {#if stepSearch}
        <button onclick={() => stepSearch = ''} class="text-text-subtle hover:text-text-secondary">
          <Icon icon="lucide:x" width="12" height="12" />
        </button>
      {/if}
    </div>

    <div class="overflow-y-auto">
      {#if !hasResults}
        <p class="px-4 py-6 text-center text-sm text-text-subtle">No steps match "{stepSearch}"</p>
      {:else}
        {#if filteredUtility.length > 0}
          <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-text-subtle uppercase tracking-wider bg-surface sticky top-0 z-10">Logic & Control</p>
          {#each filteredUtility as item}
            <button type="button" onclick={() => { addNode(item.type, item.id); showAddMenu = false; stepSearch = ''; }}
              class="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors">
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
                <span class="text-sm font-medium text-text">{item.label}</span>
                <p class="text-xs text-text-subtle mt-0.5">{item.description}</p>
              </div>
            </button>
          {/each}
        {/if}

        {#each Object.entries(toolsByCategory) as [category, tools]}
          <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-text-subtle uppercase tracking-wider bg-surface sticky top-0 z-10">{category}</p>
          {#each tools as tool}
            <button type="button" onclick={() => { addNode('tool', tool.id); showAddMenu = false; stepSearch = ''; }}
              class="w-full text-left flex flex-col px-4 py-2.5 hover:bg-surface-2 transition-colors">
              <span class="text-sm font-medium text-text">{tool.label}</span>
              <span class="text-xs text-text-subtle mt-0.5">{tool.description}</span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  </div>
{/if}
