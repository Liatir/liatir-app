import type { Node, Edge } from '@xyflow/svelte';
import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import { dataFiles } from './dataFiles.svelte';
import { apiConnections, sendApiRequest } from './apiConnections.svelte';
import { analysisRuns } from './analysisRuns.svelte';
import { resolveStepEntry } from '$lib/tools/pipeline-registry';
import { ensureResultsDir } from '$lib/utils/results';
import type { ToolOutput } from '$lib/types/tool-output';
import type {
  ToolNodeData, VariableNodeData, MathNodeData, ConditionNodeData,
  SubPipelineNodeData, ApiRequestNodeData, NodeRunState, RunOutputFile,
  PipelineStepDefinition,
} from '$lib/types/pipeline';
import type { JsonValue } from '@liatir/core';

interface PipelineStepRecord {
  label: string;
  output?: ToolOutput;
  files: RunOutputFile[];
}

/** Combine each step's result into one grouped ToolOutput (a heading per step). */
function buildPipelineOutput(steps: PipelineStepRecord[]): ToolOutput {
  const sections: ToolOutput['sections'] = [];
  for (const s of steps) {
    sections.push({
      type: 'text',
      label: `▸ ${s.label}`,
      content: s.files.length ? s.files.map(f => f.label).join(' · ') : 'completed',
    });
    if (s.output) sections.push(...s.output.sections);
  }
  return { sections };
}

function getFile() { return `${getDataPrefix()}pipeline-workspace.json`; }

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

class PipelineCycleError extends Error {
  constructor(readonly nodeIds: string[]) {
    super(`Pipeline contains a cycle involving ${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'}.`);
    this.name = 'PipelineCycleError';
  }
}

function topoSort(nodes: Node[], edges: Edge[]): string[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
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
  if (sorted.length !== nodes.length) {
    const sortedIds = new Set(sorted);
    throw new PipelineCycleError(nodes.filter(n => !sortedIds.has(n.id)).map(n => n.id));
  }
  return sorted;
}

function initNodeState(): NodeRunState {
  return { status: 'pending', logs: [], outputFiles: [], error: null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Convert non-file node outputs into string outputValues so they can be
// referenced as `@pipe:nodeId:<outputKey>` by downstream nodes.
function outputsToValues(
  metrics?: Record<string, number>,
  values?: Record<string, JsonValue>
): Record<string, string> | undefined {
  if (!metrics && !values) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    out[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  for (const [key, value] of Object.entries(metrics ?? {})) {
    out[key] = String(value);
  }
  return out;
}

// Resolve a single field value. A value is either a plain literal (typed text,
// a data-file path) OR an `@pipe:nodeId:outKey` reference to an upstream node's
// output. References resolve against the already-computed node states: value
// outputs (variable / math / tool metrics / API fields) come from outputValues;
// file outputs are matched by their label.
function resolveRef(
  ref: unknown,
  nodes: Node[],
  nodeStates: Map<string, NodeRunState>
): string {
  if (typeof ref !== 'string' || !ref.startsWith('@pipe:')) return typeof ref === 'string' ? ref : '';
  const [, srcNodeId, outKey] = ref.split(':');
  const srcState = nodeStates.get(srcNodeId);
  if (!srcState) return '';

  // Value output (variable / math / tool numeric metric / API status & fields).
  if (srcState.outputValues?.[outKey] !== undefined) return srcState.outputValues[outKey];

  // File output — match by the source's declared output label.
  const srcNode = nodes.find(n => n.id === srcNodeId);
  const srcDef = resolveStepEntry((srcNode?.data?.stepId as string) ?? '')?.definition;
  const label = srcDef?.outputSchema[outKey]?.label ?? (outKey === 'responseBody' ? 'Response Body' : outKey);
  const outFile = srcState.outputFiles.find(f => f.label === label);
  return outFile ? outFile.path : '';
}

// Resolve every field of a node's data.inputs (each value a literal or `@pipe:` ref).
function resolveInputs(
  nodes: Node[],
  nodeStates: Map<string, NodeRunState>,
  dataInputs: Record<string, string> = {}
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(dataInputs)) resolved[k] = resolveRef(v, nodes, nodeStates);
  return resolved;
}

function defaultInputValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function inputsWithDefaults(
  def: PipelineStepDefinition,
  dataInputs: Record<string, string> = {}
): Record<string, string> {
  const inputs = { ...dataInputs };
  for (const [key, schema] of Object.entries(def.inputSchema)) {
    if (inputs[key] === undefined && schema.default !== undefined) {
      inputs[key] = defaultInputValue(schema.default);
    }
  }
  return inputs;
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
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  function patchState(id: string, patch: Partial<NodeRunState>) {
    const prev = nodeStates.get(id) ?? initNodeState();
    nodeStates = new Map([...nodeStates, [id, { ...prev, ...patch }]]);
  }

  async function persist() {
    const workspace: PipelineWorkspace = {
      current: {
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
        name: pipelineName,
        id: pipelineId,
      },
      saved: JSON.parse(JSON.stringify(savedPipelines)),
    };
    await appStorage.writeText(getFile(), JSON.stringify(workspace, null, 2));
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 800);
  }

  // Run a set of nodes inline (used for sub-pipeline execution)
  async function runNodes(
    nodes: Node[],
    edges: Edge[],
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
        const entry = resolveStepEntry(node.data?.stepId as string ?? '');
        if (!entry) { patch({ status: 'error', error: `Unknown tool: ${node.data?.stepId}` }); break; }

        patch({ status: 'running' });
        const { absDir: outputDir, virtualFolder } = await ensureResultsDir(entry.definition.label);

        const resolved = resolveInputs(
          nodes,
          localStates,
          inputsWithDefaults(entry.definition, node.data?.inputs as Record<string, string> ?? {})
        );
        const logs: string[] = [];
        try {
          const result = await entry.run(resolved, outputDir, (line) => { logs.push(line); onLog(line); });
          patch({ status: 'done', logs, outputFiles: result.outputFiles, outputValues: outputsToValues(result.metrics, result.values) });
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
        const a = Number(resolveRef(d.literalA ?? '', nodes, localStates) || 0);
        const b = Number(resolveRef(d.literalB ?? '', nodes, localStates) || 0);
        const res = computeMath(d.operation, a, b);
        patch({ status: 'done', outputValues: { result: String(res) } });
      } else if (node.type === 'condition') {
        const d = node.data as unknown as ConditionNodeData;
        const value = resolveRef(d.valueRef ?? '', nodes, localStates);
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
        if (await appStorage.exists(getFile())) {
          const raw = await appStorage.readText(getFile());
          const ws: PipelineWorkspace = JSON.parse(raw);
          currentNodes = ws.current?.nodes ?? [];
          currentEdges = ws.current?.edges ?? [];
          pipelineName = ws.current?.name ?? 'Untitled Pipeline';
          pipelineId = ws.current?.id ?? null;
          savedPipelines = ws.saved ?? [];
        }
      } catch { /* start fresh */ }
    },

    reset() {
      clearTimeout(persistTimer);
      initialized = false;
      savedPipelines = [];
      pipelineName = 'Untitled Pipeline';
      pipelineId = null;
      pendingLoad = null;
      currentNodes = [];
      currentEdges = [];
      nodeStates = new Map();
      running = false;
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
      // Preserve live run state when re-opening the pipeline that is currently
      // loaded (e.g. navigating away mid-run and coming back via the list).
      // Only wipe node states when switching to a *different* pipeline.
      const sameAsCurrent = pipelineId === p.id;
      currentNodes = JSON.parse(JSON.stringify(p.nodes));
      currentEdges = JSON.parse(JSON.stringify(p.edges));
      pipelineName = p.name;
      pipelineId = p.id;
      if (!sameAsCurrent && !running) {
        nodeStates = new Map();
      }
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

    exportToJson(p: SavedPipeline): string {
      const clean: SavedPipeline = {
        ...p,
        nodes: p.nodes.map(node => {
          if (node.type !== 'tool') return node;
          const entry = resolveStepEntry(node.data?.stepId as string ?? '');
          if (!entry) return node;
          const inputs = { ...(node.data?.inputs as Record<string, string> ?? {}) };
          for (const [key, schema] of Object.entries(entry.definition.inputSchema)) {
            if (schema.type === 'file') delete inputs[key];
          }
          return { ...node, data: { ...node.data, inputs } };
        }),
      };
      return JSON.stringify(clean, null, 2);
    },

    importFromJson(json: string): SavedPipeline | null {
      try {
        const p = JSON.parse(json) as Partial<SavedPipeline>;
        if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) return null;
        return {
          id: crypto.randomUUID(),
          name: p.name ?? 'Imported Pipeline',
          nodes: p.nodes,
          edges: p.edges,
          updatedAt: Date.now(),
        };
      } catch {
        return null;
      }
    },

    async addImported(p: SavedPipeline) {
      savedPipelines = [p, ...savedPipelines];
      await persist();
    },

    async run(nodes: Node[], edges: Edge[]) {
      if (running || nodes.length === 0) return;
      const api = liatir();
      if (!api) return;

      running = true;
      const fresh = new Map<string, NodeRunState>();
      for (const n of nodes) fresh.set(n.id, initNodeState());
      nodeStates = fresh;

      // Accumulate step results to record ONE grouped pipeline run in Results.
      const pipeStartedAt = Date.now();
      const pipeSteps: PipelineStepRecord[] = [];
      let fatalError: unknown = null;

      try {
        const order = topoSort(nodes, edges);
        const skipped = new Set<string>();

        for (const nodeId of order) {
          if (skipped.has(nodeId)) continue;
          const node = nodes.find(n => n.id === nodeId);
          if (!node || node.type === 'start') continue;

        // ── Tool node ──────────────────────────────────────────────────────────
        if (node.type === 'tool') {
          const entry = resolveStepEntry(node.data?.stepId as string ?? '');
          if (!entry) {
            patchState(nodeId, { status: 'error', error: `Unknown tool: ${node.data?.stepId}` });
            break;
          }
          patchState(nodeId, { status: 'running' });

          const { absDir: outputDir, virtualFolder } = await ensureResultsDir(entry.definition.label);

          const resolved = resolveInputs(
            nodes,
            nodeStates,
            inputsWithDefaults(entry.definition, node.data?.inputs as Record<string, string> ?? {})
          );
          const logs: string[] = [];
          try {
            const result = await entry.run(resolved, outputDir, (line) => {
              logs.push(line);
              patchState(nodeId, { logs: [...logs] });
            });
            patchState(nodeId, {
              status: 'done',
              logs,
              outputFiles: result.outputFiles,
              error: null,
              outputValues: outputsToValues(result.metrics, result.values),
            });
            pipeSteps.push({ label: entry.definition.label, output: result.output, files: result.outputFiles });
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
          const a = Number(resolveRef(d.literalA ?? '', nodes, nodeStates) || 0);
          const b = Number(resolveRef(d.literalB ?? '', nodes, nodeStates) || 0);
          patchState(nodeId, { status: 'done', outputValues: { result: String(computeMath(d.operation, a, b)) } });

        // ── Condition node ─────────────────────────────────────────────────────
        } else if (node.type === 'condition') {
          const d = node.data as unknown as ConditionNodeData;
          const value = resolveRef(d.valueRef ?? '', nodes, nodeStates);
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
            const subFiles = await runNodes(sub.nodes, sub.edges, (line) => {
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
          const provider = apiConnections.collectionById(req.collectionId) ?? undefined;
          // Per-param overrides configured on the node (literal or `@pipe:` ref).
          // Only non-empty values override the request's own params.
          const resolvedOverrides = resolveInputs(nodes, nodeStates, (node.data?.paramOverrides as Record<string, string>) ?? {});
          const paramOverrides: Record<string, string> = {};
          for (const [k, v] of Object.entries(resolvedOverrides)) if (v !== '') paramOverrides[k] = v;
          patchState(nodeId, { status: 'running', logs: [`${req.method} ${req.url}`] });
          try {
            const resp = await sendApiRequest(req, { provider, paramOverrides, envVars: apiConnections.activeEnvVars });
            const { absDir: reqOutputDir, virtualFolder: reqVirtualFolder } = await ensureResultsDir(req.name || d.requestId!);

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
                    outputValues[key] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : String(val);
                  }
                }
              }
            }

            await dataFiles.createFolder('Results').catch(() => {});
            await dataFiles.createFolder(reqVirtualFolder).catch(() => {});
            for (const f of outputFiles) await dataFiles.add(f.path, reqVirtualFolder).catch(() => {});

            patchState(nodeId, { status: 'done', outputFiles, outputValues });
            pipeSteps.push({ label: req.name || 'API Request', files: outputFiles });
          } catch (e) {
            patchState(nodeId, { status: 'error', error: String(e) });
            break;
          }
          }
        }
      } catch (e) {
        fatalError = e;
        if (e instanceof PipelineCycleError) {
          for (const nodeId of e.nodeIds) {
            patchState(nodeId, { status: 'error', error: e.message });
          }
        } else {
          const firstPending = nodes.find(n => n.type !== 'start' && nodeStates.get(n.id)?.status === 'pending');
          if (firstPending) patchState(firstPending.id, { status: 'error', error: errorMessage(e) });
        }
      } finally {
        // Record ONE grouped run for this pipeline execution (visible in Results),
        // instead of one loose run per step.
        const erroredEntry = [...nodeStates.entries()].find(([, s]) => s.status === 'error');
        const fatalMessage = fatalError ? errorMessage(fatalError) : null;
        if (pipeSteps.length > 0 || erroredEntry || fatalMessage) {
          const endedAt = Date.now();
          const logs = [...nodeStates.values()].flatMap(s => s.logs ?? []);
          const allFiles = pipeSteps.flatMap(s => s.files);
          await analysisRuns.add({
            id: crypto.randomUUID(),
            tool: 'pipeline',
            label: pipelineName || 'Pipeline',
            inputs: [],
            params: { steps: pipeSteps.length },
            outputFiles: allFiles,
            status: erroredEntry || fatalMessage ? 'error' : 'done',
            startedAt: pipeStartedAt,
            endedAt,
            durationMs: endedAt - pipeStartedAt,
            output: erroredEntry || fatalMessage ? null : buildPipelineOutput(pipeSteps),
            error: erroredEntry ? (nodeStates.get(erroredEntry[0])?.error ?? 'Pipeline failed') : fatalMessage,
            log: logs,
          }).catch(() => {});
        }

        running = false;
      }
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
    // binary
    case '+':   return a + b;
    case '-':   return a - b;
    case '*':   return a * b;
    case '/':   return b !== 0 ? a / b : 0;
    case '%':   return b !== 0 ? (a / b) * 100 : 0;  // a as a percentage of b
    case '^':   return Math.pow(a, b);
    case 'mod': return b !== 0 ? a % b : 0;
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    // unary (b ignored)
    case 'round': return Math.round(a);
    case 'floor': return Math.floor(a);
    case 'ceil':  return Math.ceil(a);
    case 'abs':   return Math.abs(a);
    case 'sqrt':  return Math.sqrt(a);
    case 'log2':  return Math.log2(a);
    case 'log10': return Math.log10(a);
    case 'ln':    return Math.log(a);
    default: return 0;
  }
}

export const pipelineStore = createPipelineStore();
