import type { Node, Edge } from '@xyflow/svelte';
import { liatir } from '$lib/api';
import { dataFiles } from './dataFiles.svelte';
import { apiConnections, sendApiRequest } from './apiConnections.svelte';
import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
import type {
  ToolNodeData, VariableNodeData, MathNodeData, ConditionNodeData,
  SubPipelineNodeData, ApiRequestNodeData, NodeRunState, RunOutputFile,
} from '$lib/types/pipeline';

const FILE = 'pipeline-workspace.json';

export interface SavedPipeline {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  updatedAt: number;
}

interface PipelineWorkspace {
  current: { nodes: Node[]; edges: Edge[]; name: string; id: string | null };
  saved: SavedPipeline[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function topoSort(nodes: Node[], edges: Edge[]): string[] {
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

// Resolve all inputs for a node from edges (files and values) + node.data.inputs tokens
function resolveInputs(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
  nodeStates: Map<string, NodeRunState>,
  dataInputs: Record<string, string> = {}
): Record<string, string> {
  const resolved: Record<string, string> = { ...dataInputs };

  // Resolve @pipe: tokens from node.data.inputs
  for (const [k, v] of Object.entries(resolved)) {
    if (typeof v === 'string' && v.startsWith('@pipe:')) {
      const [, srcNodeId, outKey] = v.split(':');
      const srcDef = PIPELINE_REGISTRY[nodes.find(n => n.id === srcNodeId)?.data?.stepId as string ?? '']?.definition;
      const targetLabel = srcDef?.outputSchema[outKey]?.label ?? outKey;
      const srcState = nodeStates.get(srcNodeId);
      const outFile = srcState?.outputFiles.find(f => f.label === targetLabel);
      if (outFile) resolved[k] = outFile.path;
    }
  }

  // Resolve from edges
  for (const edge of edges.filter(e => e.target === nodeId)) {
    if (!edge.targetHandle || !edge.sourceHandle) continue;
    const srcState = nodeStates.get(edge.source);
    if (!srcState) continue;

    // Value output (variable / math / condition)
    if (srcState.outputValues?.[edge.sourceHandle] !== undefined) {
      resolved[edge.targetHandle] = srcState.outputValues[edge.sourceHandle];
      continue;
    }

    // File output (tool nodes)
    const srcNode = nodes.find(n => n.id === edge.source);
    if (!srcNode) continue;
    const srcDef = PIPELINE_REGISTRY[srcNode.data?.stepId as string ?? '']?.definition;
    const targetLabel = srcDef?.outputSchema[edge.sourceHandle]?.label ?? edge.sourceHandle;
    const outFile = srcState.outputFiles.find(f => f.label === targetLabel);
    if (outFile) resolved[edge.targetHandle] = outFile.path;
  }

  return resolved;
}

// Find nodes exclusively reachable via the dead branch of a condition node
function findDeadBranchNodes(
  nodes: Node[],
  edges: Edge[],
  conditionNodeId: string,
  deadHandle: string,
  nodeStates: Map<string, NodeRunState>
): Set<string> {
  const dead = new Set<string>();
  const deadEdge = edges.find(e => e.source === conditionNodeId && e.sourceHandle === deadHandle);
  if (!deadEdge) return dead;

  const queue = [deadEdge.target];
  while (queue.length) {
    const nid = queue.shift()!;
    if (dead.has(nid) || nodeStates.get(nid)?.status === 'done') continue;
    const incoming = edges.filter(e => e.target === nid);
    const allDead = incoming.every(e =>
      (e.source === conditionNodeId && e.sourceHandle === deadHandle) || dead.has(e.source)
    );
    if (allDead) {
      dead.add(nid);
      for (const e of edges.filter(e => e.source === nid)) queue.push(e.target);
    }
  }
  return dead;
}

// Extract a value from a JSON object using dot-notation path (e.g. "data.user.id")
function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\$\./, '').split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// Check if a candidate pipeline would create a cycle with the current pipeline
function wouldCreateCycle(
  candidateId: string,
  currentPipelineId: string,
  saved: SavedPipeline[],
  visited = new Set<string>()
): boolean {
  if (visited.has(candidateId)) return false;
  visited.add(candidateId);
  const pipeline = saved.find(p => p.id === candidateId);
  if (!pipeline) return false;
  for (const node of pipeline.nodes) {
    if (node.type === 'sub-pipeline') {
      const subId = node.data?.pipelineId as string | null;
      if (!subId) continue;
      if (subId === currentPipelineId) return true;
      if (wouldCreateCycle(subId, currentPipelineId, saved, new Set(visited))) return true;
    }
  }
  return false;
}

// ── Store ─────────────────────────────────────────────────────────────────────

function createPipelineStore() {
  let nodeStates = $state(new Map<string, NodeRunState>());
  let running = $state(false);

  let savedPipelines = $state<SavedPipeline[]>([]);
  let pipelineName = $state('Untitled Pipeline');
  let pipelineId = $state<string | null>(null);
  let pendingLoad = $state<{ nodes: Node[]; edges: Edge[]; name: string; id: string | null } | null>(null);

  let currentNodes: Node[] = [];
  let currentEdges: Edge[] = [];

  let initialized = false;
  let persistTimer: ReturnType<typeof setTimeout>;

  function patchState(id: string, patch: Partial<NodeRunState>) {
    const prev = nodeStates.get(id) ?? initNodeState();
    nodeStates = new Map([...nodeStates, [id, { ...prev, ...patch }]]);
  }

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

  // Run a set of nodes inline (used for sub-pipeline execution)
  async function runNodes(
    nodes: Node[],
    edges: Edge[],
    dataDir: string,
    onLog: (line: string) => void
  ): Promise<RunOutputFile[]> {
    const localStates = new Map<string, NodeRunState>();
    for (const n of nodes) localStates.set(n.id, initNodeState());

    const order = topoSort(nodes, edges);
    const skipped = new Set<string>();
    const allOutputFiles: RunOutputFile[] = [];

    for (const nodeId of order) {
      if (skipped.has(nodeId)) continue;
      const node = nodes.find(n => n.id === nodeId);
      if (!node || node.type === 'start') continue;

      const patch = (p: Partial<NodeRunState>) => {
        const prev = localStates.get(nodeId) ?? initNodeState();
        localStates.set(nodeId, { ...prev, ...p });
      };

      if (node.type === 'tool') {
        const entry = PIPELINE_REGISTRY[node.data?.stepId as string ?? ''];
        if (!entry) { patch({ status: 'error', error: `Unknown tool: ${node.data?.stepId}` }); break; }

        patch({ status: 'running' });
        const safeLabel = entry.definition.label.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || node.data?.stepId as string;
        const outputDir = `${dataDir}/Results/${safeLabel}`;
        const virtualFolder = `Results/${safeLabel}`;
        const api = liatir()!;
        await api.invoke('lia_fs_mkdir', { rel: 'Results', permanent: false, window_label: null, plugin_storage_module: null }).catch(() => {});
        await api.invoke('lia_fs_mkdir', { rel: virtualFolder, permanent: false, window_label: null, plugin_storage_module: null }).catch(() => {});

        const resolved = resolveInputs(nodeId, nodes, edges, localStates, node.data?.inputs as Record<string, string> ?? {});
        const logs: string[] = [];
        try {
          const result = await entry.run(resolved, outputDir, (line) => { logs.push(line); onLog(line); });
          patch({ status: 'done', logs, outputFiles: result.outputFiles });
          allOutputFiles.push(...result.outputFiles);
          await dataFiles.createFolder('Results').catch(() => {});
          await dataFiles.createFolder(virtualFolder).catch(() => {});
          for (const f of result.outputFiles) await dataFiles.add(f.path, virtualFolder).catch(() => {});
        } catch (e) {
          patch({ status: 'error', error: String(e) });
          break;
        }
      } else if (node.type === 'variable') {
        const d = node.data as unknown as VariableNodeData;
        patch({ status: 'done', outputValues: { value: d.value ?? '' } });
      } else if (node.type === 'math') {
        const d = node.data as unknown as MathNodeData;
        const inp = resolveInputs(nodeId, nodes, edges, localStates, {});
        const a = Number(inp['a'] ?? d.literalA ?? 0);
        const b = Number(inp['b'] ?? d.literalB ?? 0);
        const res = computeMath(d.operation, a, b);
        patch({ status: 'done', outputValues: { result: String(res) } });
      } else if (node.type === 'condition') {
        const d = node.data as unknown as ConditionNodeData;
        const inp = resolveInputs(nodeId, nodes, edges, localStates, {});
        const value = inp['value'] ?? '';
        let ok = false;
        try { ok = Boolean(new Function('value', `return (${d.condition})`)(value)); } catch { /* false */ }
        const branch: 'true' | 'false' = ok ? 'true' : 'false';
        patch({ status: 'done', activeBranch: branch, outputValues: { trueBranch: ok ? value : '', falseBranch: !ok ? value : '' } });
        const dead = findDeadBranchNodes(nodes, edges, nodeId, ok ? 'falseBranch' : 'trueBranch', localStates);
        for (const s of dead) { skipped.add(s); localStates.set(s, { ...initNodeState(), status: 'skipped' }); }
      }
    }
    return allOutputFiles;
  }

  return {
    get nodeStates() { return nodeStates; },
    get running() { return running; },
    get savedPipelines() { return savedPipelines; },
    get pipelineName() { return pipelineName; },
    get pipelineId() { return pipelineId; },
    get pendingLoad() { return pendingLoad; },
    get currentNodes() { return currentNodes; },
    get currentEdges() { return currentEdges; },

    setCurrentState(nodes: Node[], edges: Edge[], name?: string) {
      currentNodes = nodes;
      currentEdges = edges;
      if (name !== undefined) pipelineName = name;
      schedulePersist();
    },

    clearPendingLoad() { pendingLoad = null; },

    // Returns filtered saved pipelines that wouldn't create a cycle with currentId
    availableSubPipelines(currentId: string | null): SavedPipeline[] {
      return savedPipelines.filter(p => {
        if (p.id === currentId) return false;
        if (currentId && wouldCreateCycle(p.id, currentId, savedPipelines)) return false;
        return true;
      });
    },

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

    async savePipeline(name: string) {
      const id = pipelineId ?? crypto.randomUUID();
      const p: SavedPipeline = {
        id, name,
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
        updatedAt: Date.now(),
      };
      pipelineName = name;
      pipelineId = id;
      const idx = savedPipelines.findIndex(x => x.id === id);
      savedPipelines = idx >= 0
        ? savedPipelines.map((x, i) => i === idx ? p : x)
        : [p, ...savedPipelines];
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

    async run(nodes: Node[], edges: Edge[]) {
      if (running || nodes.length === 0) return;
      const api = liatir();
      if (!api) return;

      const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };

      running = true;
      const fresh = new Map<string, NodeRunState>();
      for (const n of nodes) fresh.set(n.id, initNodeState());
      nodeStates = fresh;

      const order = topoSort(nodes, edges);
      const skipped = new Set<string>();

      for (const nodeId of order) {
        if (skipped.has(nodeId)) continue;
        const node = nodes.find(n => n.id === nodeId);
        if (!node || node.type === 'start') continue;

        // ── Tool node ──────────────────────────────────────────────────────────
        if (node.type === 'tool') {
          const entry = PIPELINE_REGISTRY[node.data?.stepId as string ?? ''];
          if (!entry) {
            patchState(nodeId, { status: 'error', error: `Unknown tool: ${node.data?.stepId}` });
            break;
          }
          patchState(nodeId, { status: 'running' });

          const safeLabel = entry.definition.label.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || node.data?.stepId as string;
          const outputDir = `${data}/Results/${safeLabel}`;
          const virtualFolder = `Results/${safeLabel}`;

          await api.invoke('lia_fs_mkdir', { rel: 'Results', permanent: false, window_label: null, plugin_storage_module: null }).catch(() => {});
          await api.invoke('lia_fs_mkdir', { rel: virtualFolder, permanent: false, window_label: null, plugin_storage_module: null }).catch(() => {});

          const resolved = resolveInputs(nodeId, nodes, edges, nodeStates, node.data?.inputs as Record<string, string> ?? {});
          const logs: string[] = [];
          try {
            const result = await entry.run(resolved, outputDir, (line) => {
              logs.push(line);
              patchState(nodeId, { logs: [...logs] });
            });
            patchState(nodeId, { status: 'done', logs, outputFiles: result.outputFiles, error: null });
            await dataFiles.createFolder('Results').catch(() => {});
            await dataFiles.createFolder(virtualFolder).catch(() => {});
            for (const f of result.outputFiles) await dataFiles.add(f.path, virtualFolder).catch(() => {});
          } catch (e) {
            patchState(nodeId, { status: 'error', logs, outputFiles: [], error: String(e) });
            break;
          }

        // ── Variable node ──────────────────────────────────────────────────────
        } else if (node.type === 'variable') {
          const d = node.data as unknown as VariableNodeData;
          patchState(nodeId, { status: 'done', outputValues: { value: d.value ?? '' } });

        // ── Math node ──────────────────────────────────────────────────────────
        } else if (node.type === 'math') {
          const d = node.data as unknown as MathNodeData;
          const inp = resolveInputs(nodeId, nodes, edges, nodeStates, {});
          const a = Number(inp['a'] ?? d.literalA ?? 0);
          const b = Number(inp['b'] ?? d.literalB ?? 0);
          patchState(nodeId, { status: 'done', outputValues: { result: String(computeMath(d.operation, a, b)) } });

        // ── Condition node ─────────────────────────────────────────────────────
        } else if (node.type === 'condition') {
          const d = node.data as unknown as ConditionNodeData;
          const inp = resolveInputs(nodeId, nodes, edges, nodeStates, {});
          const value = inp['value'] ?? '';
          let ok = false;
          try {
            // eslint-disable-next-line no-new-func
            ok = Boolean(new Function('value', `return (${d.condition ?? 'false'})`)(value));
          } catch (e) {
            patchState(nodeId, { status: 'error', error: `Invalid condition: ${e}` });
            break;
          }
          const branch: 'true' | 'false' = ok ? 'true' : 'false';
          patchState(nodeId, {
            status: 'done',
            activeBranch: branch,
            outputValues: { trueBranch: ok ? value : '', falseBranch: !ok ? value : '' },
          });
          const dead = findDeadBranchNodes(nodes, edges, nodeId, ok ? 'falseBranch' : 'trueBranch', nodeStates);
          for (const s of dead) {
            skipped.add(s);
            patchState(s, { status: 'skipped' });
          }

        // ── Sub-pipeline node ──────────────────────────────────────────────────
        } else if (node.type === 'sub-pipeline') {
          const d = node.data as unknown as SubPipelineNodeData;
          if (!d.pipelineId) {
            patchState(nodeId, { status: 'error', error: 'No pipeline selected' });
            break;
          }
          const sub = savedPipelines.find(p => p.id === d.pipelineId);
          if (!sub) {
            patchState(nodeId, { status: 'error', error: 'Pipeline not found' });
            break;
          }
          patchState(nodeId, { status: 'running', logs: [`▶ Running sub-pipeline: ${sub.name}`] });
          try {
            const subFiles = await runNodes(sub.nodes, sub.edges, data, (line) => {
              const curr = nodeStates.get(nodeId);
              patchState(nodeId, { logs: [...(curr?.logs ?? []), line] });
            });
            patchState(nodeId, { status: 'done', outputFiles: subFiles });
          } catch (e) {
            patchState(nodeId, { status: 'error', error: String(e) });
            break;
          }

        // ── API Request node ───────────────────────────────────────────────────
        } else if (node.type === 'api-request') {
          const d = node.data as unknown as ApiRequestNodeData;
          if (!d.requestId) {
            patchState(nodeId, { status: 'error', error: 'No request selected' });
            break;
          }
          const req = apiConnections.requestById(d.requestId);
          if (!req) {
            patchState(nodeId, { status: 'error', error: 'Request not found' });
            break;
          }
          patchState(nodeId, { status: 'running', logs: [`${req.method} ${req.url}`] });
          try {
            const resp = await sendApiRequest(req);
            const safeReqName = req.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || d.requestId!;
            const reqOutputDir = `${data}/Results/${safeReqName}`;
            const reqVirtualFolder = `Results/${safeReqName}`;

            await api.invoke('lia_fs_mkdir', { rel: 'Results', permanent: false, window_label: null, plugin_storage_module: null }).catch(() => {});
            await api.invoke('lia_fs_mkdir', { rel: reqVirtualFolder, permanent: false, window_label: null, plugin_storage_module: null }).catch(() => {});

            const ts = Date.now();
            const bodyPath = `${reqOutputDir}/response-${ts}.json`;
            await api.invoke('lia_write_file_path', { path: bodyPath, content: resp.body }).catch(() => {});

            const outputFiles: RunOutputFile[] = [{ label: 'Response Body', path: bodyPath, ext: 'json' }];
            const outputValues: Record<string, string> = { status: String(resp.status) };

            if (req.outputSchema) {
              let parsed: unknown;
              try { parsed = JSON.parse(resp.body); } catch { /* not JSON */ }
              if (parsed !== undefined) {
                for (const [key, field] of Object.entries(req.outputSchema)) {
                  const val = getValueAtPath(parsed, field.path);
                  if (val !== undefined) {
                    const valPath = `${reqOutputDir}/${key}-${ts}.json`;
                    await api.invoke('lia_write_file_path', { path: valPath, content: JSON.stringify(val) }).catch(() => {});
                    outputFiles.push({ label: field.label || key, path: valPath, ext: 'json' });
                    outputValues[key] = String(val);
                  }
                }
              }
            }

            await dataFiles.createFolder('Results').catch(() => {});
            await dataFiles.createFolder(reqVirtualFolder).catch(() => {});
            for (const f of outputFiles) await dataFiles.add(f.path, reqVirtualFolder).catch(() => {});

            patchState(nodeId, { status: 'done', outputFiles, outputValues });
          } catch (e) {
            patchState(nodeId, { status: 'error', error: String(e) });
            break;
          }
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

function computeMath(
  op: MathNodeData['operation'] | undefined,
  a: number,
  b: number
): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b !== 0 ? a / b : 0;
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'round': return Math.round(a);
    case 'floor': return Math.floor(a);
    case 'ceil': return Math.ceil(a);
    case 'abs': return Math.abs(a);
    default: return 0;
  }
}

export const pipelineStore = createPipelineStore();
