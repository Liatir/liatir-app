import type { Node, Edge } from '@xyflow/svelte';
import { liatir } from '$lib/api';
import { dataFiles } from './dataFiles.svelte';
import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
import type { ToolNodeData, NodeRunState } from '$lib/types/pipeline';

const FILE = 'pipeline-workspace.json';

export interface SavedPipeline {
  id: string;
  name: string;
  nodes: Node<ToolNodeData>[];
  edges: Edge[];
  updatedAt: number;
}

interface PipelineWorkspace {
  current: { nodes: Node<ToolNodeData>[]; edges: Edge[]; name: string; id: string | null };
  saved: SavedPipeline[];
}

function createPipelineStore() {
  // ── Runtime run state (reactive) ───────────────────────────────────────
  let nodeStates = $state(new Map<string, NodeRunState>());
  let running = $state(false);

  // ── Persistence state (reactive for UI) ───────────────────────────────
  let savedPipelines = $state<SavedPipeline[]>([]);
  let pipelineName = $state('Untitled Pipeline');
  let pipelineId = $state<string | null>(null);
  let pendingLoad = $state<{ nodes: Node<ToolNodeData>[]; edges: Edge[]; name: string; id: string | null } | null>(null);

  // ── Current working nodes/edges (plain, kept for disk persistence) ────
  let currentNodes: Node<ToolNodeData>[] = [];
  let currentEdges: Edge[] = [];

  let initialized = false;
  let persistTimer: ReturnType<typeof setTimeout>;

  // ── Kahn topological sort ─────────────────────────────────────────────
  function topoSort(nodes: Node<ToolNodeData>[], edges: Edge[]): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
    for (const e of edges) {
      adj.get(e.source)?.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const sorted: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      sorted.push(id);
      for (const next of adj.get(id) ?? []) {
        const d = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
    return sorted;
  }

  function initNodeState(): NodeRunState {
    return { status: 'pending', logs: [], outputFiles: [], error: null };
  }

  function patchState(id: string, patch: Partial<NodeRunState>) {
    const prev = nodeStates.get(id) ?? initNodeState();
    nodeStates = new Map([...nodeStates, [id, { ...prev, ...patch }]]);
  }

  // ── Persistence ───────────────────────────────────────────────────────
  async function persist() {
    const api = liatir();
    if (!api) return;
    const workspace: PipelineWorkspace = {
      current: {
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
        name: pipelineName,
        id: pipelineId,
      },
      saved: JSON.parse(JSON.stringify(savedPipelines)),
    };
    await api.desktop.fs.data.writeText(FILE, JSON.stringify(workspace, null, 2), { createDirs: true });
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 800);
  }

  return {
    // ── Reactive getters ────────────────────────────────────────────────
    get nodeStates() { return nodeStates; },
    get running() { return running; },
    get savedPipelines() { return savedPipelines; },
    get pipelineName() { return pipelineName; },
    get pipelineId() { return pipelineId; },
    get pendingLoad() { return pendingLoad; },

    // ── Current working state (for component initialization) ────────────
    get currentNodes() { return currentNodes; },
    get currentEdges() { return currentEdges; },

    // Called by pipeline editor whenever nodes/edges change
    setCurrentState(nodes: Node<ToolNodeData>[], edges: Edge[], name?: string) {
      currentNodes = nodes;
      currentEdges = edges;
      if (name !== undefined) pipelineName = name;
      schedulePersist();
    },

    clearPendingLoad() { pendingLoad = null; },

    // ── Initialization ──────────────────────────────────────────────────
    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        if (await api.desktop.fs.data.exists(FILE)) {
          const raw = await api.desktop.fs.data.readText(FILE);
          const ws: PipelineWorkspace = JSON.parse(raw);
          currentNodes = ws.current?.nodes ?? [];
          currentEdges = ws.current?.edges ?? [];
          pipelineName = ws.current?.name ?? 'Untitled Pipeline';
          pipelineId = ws.current?.id ?? null;
          savedPipelines = ws.saved ?? [];
        }
      } catch { /* start fresh */ }
    },

    // ── Pipeline CRUD ───────────────────────────────────────────────────
    async savePipeline(name: string) {
      const id = pipelineId ?? crypto.randomUUID();
      const p: SavedPipeline = {
        id,
        name,
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
        updatedAt: Date.now(),
      };
      pipelineName = name;
      pipelineId = id;
      const idx = savedPipelines.findIndex(x => x.id === id);
      if (idx >= 0) {
        savedPipelines = savedPipelines.map((x, i) => i === idx ? p : x);
      } else {
        savedPipelines = [p, ...savedPipelines];
      }
      await persist();
      return p;
    },

    loadSavedPipeline(p: SavedPipeline) {
      currentNodes = JSON.parse(JSON.stringify(p.nodes));
      currentEdges = JSON.parse(JSON.stringify(p.edges));
      pipelineName = p.name;
      pipelineId = p.id;
      nodeStates = new Map();
      pendingLoad = { nodes: currentNodes, edges: currentEdges, name: p.name, id: p.id };
    },

    newPipeline() {
      currentNodes = [];
      currentEdges = [];
      pipelineName = 'Untitled Pipeline';
      pipelineId = null;
      nodeStates = new Map();
      pendingLoad = { nodes: [], edges: [], name: 'Untitled Pipeline', id: null };
      schedulePersist();
    },

    async deleteSavedPipeline(id: string) {
      savedPipelines = savedPipelines.filter(p => p.id !== id);
      await persist();
    },

    // ── Execution ───────────────────────────────────────────────────────
    async run(nodes: Node<ToolNodeData>[], edges: Edge[]) {
      if (running || nodes.length === 0) return;
      const api = liatir();
      if (!api) return;

      const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };

      running = true;
      const fresh = new Map<string, NodeRunState>();
      for (const n of nodes) fresh.set(n.id, initNodeState());
      nodeStates = fresh;

      const order = topoSort(nodes, edges);

      for (const nodeId of order) {
        const node = nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'tool') continue;

        const entry = PIPELINE_REGISTRY[node.data.stepId];
        if (!entry) {
          patchState(nodeId, { status: 'error', error: `Unknown tool: ${node.data.stepId}` });
          break;
        }

        patchState(nodeId, { status: 'running' });

        // Place outputs in Results/{tool-name}/
        const safeLabel = entry.definition.label.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || node.data.stepId;
        const outputDir = `${data}/Results/${safeLabel}`;
        const virtualFolder = `Results/${safeLabel}`;

        const resolved: Record<string, string> = {};
        for (const [k, v] of Object.entries(node.data.inputs)) {
          if (v.startsWith('@pipe:')) {
            const [, srcNodeId, outKey] = v.split(':');
            const srcDef = PIPELINE_REGISTRY[nodes.find(n => n.id === srcNodeId)?.data.stepId ?? '']?.definition;
            const targetLabel = srcDef?.outputSchema[outKey]?.label ?? outKey;
            const srcState = nodeStates.get(srcNodeId);
            const outFile = srcState?.outputFiles.find(f => f.label === targetLabel);
            if (outFile) resolved[k] = outFile.path;
          } else {
            resolved[k] = v;
          }
        }
        for (const edge of edges.filter(e => e.target === nodeId)) {
          if (!edge.targetHandle || !edge.sourceHandle) continue;
          const srcNode = nodes.find(n => n.id === edge.source);
          if (!srcNode) continue;
          const srcDef = PIPELINE_REGISTRY[srcNode.data.stepId]?.definition;
          const targetLabel = srcDef?.outputSchema[edge.sourceHandle]?.label ?? edge.sourceHandle;
          const srcState = nodeStates.get(edge.source);
          const outFile = srcState?.outputFiles.find(f => f.label === targetLabel);
          if (outFile) resolved[edge.targetHandle] = outFile.path;
        }

        const logs: string[] = [];
        try {
          const result = await entry.run(resolved, outputDir, (line) => {
            logs.push(line);
            patchState(nodeId, { logs: [...logs] });
          });
          patchState(nodeId, { status: 'done', logs, outputFiles: result.outputFiles, error: null });
          // Register outputs in Results/{tool-name} virtual folder
          await dataFiles.createFolder('Results').catch(() => {});
          await dataFiles.createFolder(virtualFolder).catch(() => {});
          for (const f of result.outputFiles) {
            await dataFiles.add(f.path, virtualFolder).catch(() => {});
          }
        } catch (e) {
          patchState(nodeId, { status: 'error', logs, outputFiles: [], error: String(e) });
          break;
        }
      }
      running = false;
    },

    resetStates(nodeIds: string[]) {
      const fresh = new Map<string, NodeRunState>();
      for (const id of nodeIds) fresh.set(id, initNodeState());
      nodeStates = fresh;
    },
  };
}

export const pipelineStore = createPipelineStore();
