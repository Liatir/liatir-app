import type { Node, Edge } from '@xyflow/svelte';
import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import { dataFiles } from './dataFiles.svelte';
import { liaPluginsStore } from './lia-plugins.svelte';
import { apiConnections, sendApiRequest } from './apiConnections.svelte';
import { analysisRuns } from './analysisRuns.svelte';
import { resolveStepEntry } from '$lib/tools/pipeline-registry';
import { ensureResultsDir } from '$lib/utils/results';
import { withArtifactsMetadata } from '$lib/utils/artifacts';
import { evaluateConditionNode } from '$lib/pipeline/conditions';
import type { ToolOutput } from '$lib/types/tool-output';
import type {
  ToolNodeData, VariableNodeData, MathNodeData, ConditionNodeData,
  SubPipelineNodeData, ApiRequestNodeData, NodeRunState, RunOutputFile,
  PipelineStepDefinition,
} from '$lib/types/pipeline';
import { isExecutablePipelineNode } from '$lib/types/pipeline';
import type { AIPipelineRunContext } from '$lib/ai/direct-run-context';
import type { JsonValue } from '@liatir/core';
import { createAsyncStoreInitializer } from './async-store-initializer';
import {
  isRunCancelled,
  PIPELINE_CANCELLED_MESSAGE,
  throwIfRunCancelled,
} from '$lib/pipeline/cancellation';

interface PipelineStepRecord {
  label: string;
  output?: ToolOutput;
  files: RunOutputFile[];
}

interface ApiStepResult {
  label: string;
  outputFiles: RunOutputFile[];
  outputValues: Record<string, string>;
  virtualFolder: string;
}

/** Combine each step's result into one grouped ToolOutput (a heading per step). */
function buildPipelineOutput(steps: PipelineStepRecord[]): ToolOutput {
  const sections: ToolOutput['sections'] = [];
  if (steps.length === 0) {
    sections.push({
      type: 'text',
      label: 'Pipeline',
      content: 'Pipeline completed.',
    });
    return { sections };
  }
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
  runtime?: SerializedPipelineRuntimeState[];
}

interface PipelineRuntimeState {
  pipelineId: string | null;
  pipelineName: string;
  nodeStates: Map<string, NodeRunState>;
  running: boolean;
  runId: string | null;
  startedAt: number | null;
}

interface SerializedPipelineRuntimeState {
  key: string;
  pipelineId: string | null;
  pipelineName: string;
  nodeStates: [string, NodeRunState][];
  running: boolean;
  runId: string | null;
  startedAt: number | null;
}

interface ActivePipelineExecution {
  runId: string;
  controller: AbortController;
  childJobIds: Set<string>;
}

const DRAFT_PIPELINE_KEY = '__draft__';
const EMPTY_NODE_STATES: Map<string, NodeRunState> = new Map();
const INTERRUPTED_PIPELINE_ERROR = 'Pipeline run was interrupted before Liatir could finalize it.';

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

function executableGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const executableNodes = nodes.filter(isExecutablePipelineNode);
  const executableIds = new Set(executableNodes.map(node => node.id));
  return {
    nodes: executableNodes,
    edges: edges.filter(edge => executableIds.has(edge.source) && executableIds.has(edge.target)),
  };
}

function initNodeState(): NodeRunState {
  return { status: 'pending', logs: [], outputFiles: [], error: null };
}

function runtimeKeyFor(id: string | null | undefined): string {
  return id ?? DRAFT_PIPELINE_KEY;
}

function createRuntimeState(
  key: string,
  pipelineId: string | null,
  pipelineName: string
): PipelineRuntimeState {
  return {
    pipelineId,
    pipelineName,
    nodeStates: new Map(),
    running: false,
    runId: null,
    startedAt: null,
  };
}

function serializeRuntimeState(
  key: string,
  state: PipelineRuntimeState
): SerializedPipelineRuntimeState {
  return {
    key,
    pipelineId: state.pipelineId,
    pipelineName: state.pipelineName,
    nodeStates: [...state.nodeStates.entries()],
    running: state.running,
    runId: state.runId,
    startedAt: state.startedAt,
  };
}

function deserializeRuntimeState(serialized: SerializedPipelineRuntimeState): PipelineRuntimeState {
  const nodeStates = new Map(serialized.nodeStates ?? []);

  if (serialized.running) {
    for (const [nodeId, state] of nodeStates.entries()) {
      if (state.status === 'running') {
        nodeStates.set(nodeId, {
          ...state,
          status: 'error',
          error: INTERRUPTED_PIPELINE_ERROR,
        });
      }
    }
  }

  return {
    pipelineId: serialized.pipelineId,
    pipelineName: serialized.pipelineName,
    nodeStates,
    running: false,
    runId: serialized.runId,
    startedAt: serialized.startedAt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Prefer the user's custom node name (data.label) over the tool/type name for
// anything user-facing (Results headings, logs, artifact metadata).
function nodeDisplayLabel(node: Node, fallback: string): string {
  return ((node.data?.label as string) ?? '').trim() || fallback;
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
    if (schema.connectable === false && typeof inputs[key] === 'string' && inputs[key].startsWith('@pipe:')) {
      inputs[key] = defaultInputValue(schema.default);
    } else if (inputs[key] === undefined && schema.default !== undefined) {
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
  let runtimeByPipeline = $state(new Map<string, PipelineRuntimeState>());
  const activeExecutions = new Map<string, ActivePipelineExecution>();

  let savedPipelines = $state<SavedPipeline[]>([]);
  let pipelineName = $state('Untitled Pipeline');
  let pipelineId = $state<string | null>(null);
  let pendingLoad = $state<{ nodes: Node[]; edges: Edge[]; name: string; id: string | null } | null>(null);

  let currentNodes: Node[] = [];
  let currentEdges: Edge[] = [];

  const initializer = createAsyncStoreInitializer();
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  function currentRuntimeKey(): string {
    return runtimeKeyFor(pipelineId);
  }

  function runtimeFor(
    key = currentRuntimeKey(),
    id = pipelineId,
    name = pipelineName
  ): PipelineRuntimeState {
    const existing = runtimeByPipeline.get(key);
    if (existing) return existing;
    const created = createRuntimeState(key, id, name);
    runtimeByPipeline = new Map([...runtimeByPipeline, [key, created]]);
    return created;
  }

  function setRuntime(key: string, state: PipelineRuntimeState) {
    runtimeByPipeline = new Map([...runtimeByPipeline, [key, state]]);
    schedulePersist();
  }

  function patchStateFor(key: string, id: string, patch: Partial<NodeRunState>) {
    const runtime = runtimeFor(key);
    const prev = runtime.nodeStates.get(id) ?? initNodeState();
    setRuntime(key, {
      ...runtime,
      nodeStates: new Map([...runtime.nodeStates, [id, { ...prev, ...patch }]]),
    });
  }

  function patchState(id: string, patch: Partial<NodeRunState>) {
    patchStateFor(currentRuntimeKey(), id, patch);
  }

  function runtimeNodeStates(key: string): Map<string, NodeRunState> {
    return runtimeFor(key).nodeStates;
  }

  function moveRuntimeState(fromKey: string, toKey: string, id: string | null, name: string) {
    if (fromKey === toKey) return;
    const existing = runtimeByPipeline.get(fromKey);
    if (!existing) return;
    const next = new Map(runtimeByPipeline);
    next.delete(fromKey);
    next.set(toKey, { ...existing, pipelineId: id, pipelineName: name });
    runtimeByPipeline = next;
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
      runtime: [...runtimeByPipeline.entries()].map(([key, state]) => serializeRuntimeState(key, state)),
    };
    await appStorage.writeText(getFile(), JSON.stringify(workspace, null, 2));
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 800);
  }

  async function flushPersist() {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    await persist();
  }

  /** A file output is settled only after it exists and its Data registration is durable. */
  async function registerSettledFiles(files: RunOutputFile[], virtualFolder: string): Promise<void> {
    if (files.length === 0) return;
    const api = liatir();
    if (!api) throw new Error('Liatir API not available');

    await dataFiles.createFolder('Results');
    await dataFiles.createFolder(virtualFolder);
    for (const file of files) {
      await api.invoke('lia_file_size', { path: file.path });
      await dataFiles.add(file.path, virtualFolder);
    }
  }

  async function executeApiRequestNode(
    node: Node,
    graphNodes: Node[],
    nodeStates: Map<string, NodeRunState>,
    signal: AbortSignal | undefined,
    runIdentity: {
      pipelineRunId: string;
      pipelineId: string | null;
      nodeId: string;
    },
  ): Promise<ApiStepResult> {
    const d = node.data as unknown as ApiRequestNodeData;
    if (!d.requestId) throw new Error('No request selected');
    const req = apiConnections.requestById(d.requestId);
    if (!req) throw new Error('Request not found');
    const api = liatir();
    if (!api) throw new Error('Liatir API not available');

    const label = nodeDisplayLabel(node, req.name || 'API Request');
    const provider = apiConnections.collectionById(req.collectionId) ?? undefined;
    const resolvedOverrides = resolveInputs(
      graphNodes,
      nodeStates,
      (node.data?.paramOverrides as Record<string, string>) ?? {},
    );
    const paramOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(resolvedOverrides)) {
      if (value !== '') paramOverrides[key] = value;
    }

    const response = await sendApiRequest(req, {
      provider,
      paramOverrides,
      envVars: apiConnections.activeEnvVars,
      signal,
    });
    throwIfRunCancelled(signal);

    const { absDir, virtualFolder } = await ensureResultsDir(req.name || d.requestId);
    const artifactId = crypto.randomUUID();
    const bodyPath = `${absDir}/response-${artifactId}.json`;
    await api.invoke('lia_write_file_path', { path: bodyPath, content: response.body });

    let outputFiles: RunOutputFile[] = [{ label: 'Response Body', path: bodyPath, ext: 'json' }];
    const outputValues: Record<string, string> = { status: String(response.status) };

    if (req.outputSchema) {
      let parsed: unknown;
      try { parsed = JSON.parse(response.body); } catch { /* not JSON */ }
      if (parsed !== undefined) {
        for (const [key, field] of Object.entries(req.outputSchema)) {
          const value = getValueAtPath(parsed, field.path);
          if (value === undefined) continue;
          const valuePath = `${absDir}/${key}-${artifactId}.json`;
          await api.invoke('lia_write_file_path', { path: valuePath, content: JSON.stringify(value) });
          outputFiles.push({ label: field.label || key, path: valuePath, ext: 'json' });
          outputValues[key] = value !== null && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        }
      }
    }

    outputFiles = withArtifactsMetadata(outputFiles, {
      role: 'final',
      createdAt: Date.now(),
      producer: {
        kind: 'api-request',
        id: d.requestId,
        label,
        nodeId: runIdentity.nodeId,
      },
      parentRun: {
        runKind: 'pipeline-step',
        runId: runIdentity.pipelineRunId,
        analysisRunId: runIdentity.pipelineRunId,
        pipelineRunId: runIdentity.pipelineRunId,
        pipelineId: runIdentity.pipelineId,
        nodeId: runIdentity.nodeId,
      },
    });
    await registerSettledFiles(outputFiles, virtualFolder);
    throwIfRunCancelled(signal);

    return { label, outputFiles, outputValues, virtualFolder };
  }

  // Run a set of nodes inline (used for sub-pipeline execution)
  async function runNodes(
    nodes: Node[],
    edges: Edge[],
    onLog: (line: string) => void,
    parentContext?: AIPipelineRunContext,
    pipelineStack: string[] = [],
  ): Promise<RunOutputFile[]> {
    const { nodes: graphNodes, edges: graphEdges } = executableGraph(nodes, edges);
    const localStates = new Map<string, NodeRunState>();
    for (const n of graphNodes) localStates.set(n.id, initNodeState());

    const order = topoSort(graphNodes, graphEdges);
    const skipped = new Set<string>();
    const allOutputFiles: RunOutputFile[] = [];

    for (const nodeId of order) {
      throwIfRunCancelled(parentContext?.signal);
      if (skipped.has(nodeId)) continue;
      const node = graphNodes.find(n => n.id === nodeId);
      if (!node || node.type === 'start') continue;

      const patch = (p: Partial<NodeRunState>) => {
        const prev = localStates.get(nodeId) ?? initNodeState();
        localStates.set(nodeId, { ...prev, ...p });
      };

      if (node.type === 'tool') {
        const entry = resolveStepEntry(node.data?.stepId as string ?? '');
        if (!entry) {
          const error = new Error(`Unknown tool: ${node.data?.stepId}`);
          patch({ status: 'error', error: error.message });
          throw error;
        }

        patch({ status: 'running' });
        const { absDir: outputDir, virtualFolder } = await ensureResultsDir(entry.definition.label);

        const resolved = resolveInputs(
          graphNodes,
          localStates,
          inputsWithDefaults(entry.definition, node.data?.inputs as Record<string, string> ?? {})
        );
        const logs: string[] = [];
        try {
          const nestedNodeId = parentContext ? `${parentContext.nodeId}/${nodeId}` : nodeId;
          const result = await entry.run(
            resolved,
            outputDir,
            (line) => { logs.push(line); onLog(line); },
            parentContext
              ? {
                  ...parentContext,
                  nodeId: nestedNodeId,
                  toolId: entry.definition.id,
                  label: nodeDisplayLabel(node, entry.definition.label),
                  params: resolved,
                  startedAt: Date.now(),
                  outputDir,
                }
              : undefined,
          );
          const outputFiles = parentContext
            ? withArtifactsMetadata(result.outputFiles, {
                role: 'final',
                createdAt: Date.now(),
                producer: {
                  kind: entry.definition.type,
                  id: entry.definition.id,
                  label: nodeDisplayLabel(node, entry.definition.label),
                  nodeId: nestedNodeId,
                },
                parentRun: {
                  runKind: 'pipeline-step',
                  runId: parentContext.pipelineRunId,
                  analysisRunId: parentContext.pipelineRunId,
                  pipelineRunId: parentContext.pipelineRunId,
                  pipelineId: parentContext.pipelineId,
                  nodeId: nestedNodeId,
                },
              })
            : result.outputFiles;
          await registerSettledFiles(outputFiles, virtualFolder);
          throwIfRunCancelled(parentContext?.signal);
          patch({
            status: 'done',
            logs,
            outputFiles,
            outputValues: outputsToValues(result.metrics, result.values),
          });
          allOutputFiles.push(...outputFiles);
        } catch (e) {
          const cancelled = isRunCancelled(e, parentContext?.signal);
          patch({
            status: cancelled ? 'cancelled' : 'error',
            logs,
            error: cancelled ? PIPELINE_CANCELLED_MESSAGE : errorMessage(e),
          });
          throw e;
        }
      } else if (node.type === 'variable') {
        const d = node.data as unknown as VariableNodeData;
        patch({ status: 'done', outputValues: { value: d.value ?? '' } });
      } else if (node.type === 'math') {
        const d = node.data as unknown as MathNodeData;
        const a = Number(resolveRef(d.literalA ?? '', graphNodes, localStates) || 0);
        const b = Number(resolveRef(d.literalB ?? '', graphNodes, localStates) || 0);
        const res = computeMath(d.operation, a, b);
        patch({ status: 'done', outputValues: { result: String(res) } });
      } else if (node.type === 'condition') {
        const d = node.data as unknown as ConditionNodeData;
        const value = resolveRef(d.valueRef ?? '', graphNodes, localStates);
        const evaluated = evaluateConditionNode(d, value);
        if (evaluated.error) {
          patch({ status: 'error', error: evaluated.error });
          throw new Error(evaluated.error);
        }
        const ok = evaluated.ok;
        const branch: 'true' | 'false' = ok ? 'true' : 'false';
        patch({ status: 'done', activeBranch: branch, outputValues: { trueBranch: ok ? value : '', falseBranch: !ok ? value : '' } });
        const dead = findDeadBranchNodes(graphNodes, graphEdges, nodeId, ok ? 'falseBranch' : 'trueBranch', localStates);
        for (const s of dead) { skipped.add(s); localStates.set(s, { ...initNodeState(), status: 'skipped' }); }
      } else if (node.type === 'api-request') {
        patch({
          status: 'running',
          logs: [`Running API Connector request`],
        });
        try {
          const nestedNodeId = parentContext ? `${parentContext.nodeId}/${nodeId}` : nodeId;
          const result = await executeApiRequestNode(
            node,
            graphNodes,
            localStates,
            parentContext?.signal,
            {
              pipelineRunId: parentContext?.pipelineRunId ?? crypto.randomUUID(),
              pipelineId: parentContext?.pipelineId ?? null,
              nodeId: nestedNodeId,
            },
          );
          patch({
            status: 'done',
            logs: [`API Connector request completed`],
            outputFiles: result.outputFiles,
            outputValues: result.outputValues,
          });
          allOutputFiles.push(...result.outputFiles);
        } catch (e) {
          const cancelled = isRunCancelled(e, parentContext?.signal);
          patch({
            status: cancelled ? 'cancelled' : 'error',
            error: cancelled ? PIPELINE_CANCELLED_MESSAGE : errorMessage(e),
          });
          throw e;
        }
      } else if (node.type === 'sub-pipeline') {
        const d = node.data as unknown as SubPipelineNodeData;
        if (!d.pipelineId) {
          patch({ status: 'error', error: 'No pipeline selected' });
          throw new Error('No pipeline selected');
        }
        if (pipelineStack.includes(d.pipelineId)) {
          const error = new Error(`Sub-pipeline cycle detected at ${d.pipelineId}`);
          patch({ status: 'error', error: error.message });
          throw error;
        }
        const sub = savedPipelines.find((pipeline) => pipeline.id === d.pipelineId);
        if (!sub) {
          patch({ status: 'error', error: 'Pipeline not found' });
          throw new Error('Pipeline not found');
        }

        const nestedNodeId = parentContext ? `${parentContext.nodeId}/${nodeId}` : nodeId;
        patch({ status: 'running', logs: [`▶ Running sub-pipeline: ${nodeDisplayLabel(node, sub.name)}`] });
        try {
          const subContext: AIPipelineRunContext | undefined = parentContext
            ? {
                ...parentContext,
                nodeId: nestedNodeId,
                toolId: 'sub-pipeline',
                label: nodeDisplayLabel(node, sub.name),
                params: { pipelineId: sub.id },
                startedAt: Date.now(),
                outputDir: '',
              }
            : undefined;
          const subFiles = await runNodes(
            sub.nodes,
            sub.edges,
            onLog,
            subContext,
            [...pipelineStack, d.pipelineId],
          );
          throwIfRunCancelled(parentContext?.signal);
          patch({ status: 'done', outputFiles: subFiles });
          allOutputFiles.push(...subFiles);
        } catch (e) {
          const cancelled = isRunCancelled(e, parentContext?.signal);
          patch({
            status: cancelled ? 'cancelled' : 'error',
            error: cancelled ? PIPELINE_CANCELLED_MESSAGE : errorMessage(e),
          });
          throw e;
        }
      }
    }
    return allOutputFiles;
  }

  return {
    get nodeStates() {
      return runtimeByPipeline.get(currentRuntimeKey())?.nodeStates ?? EMPTY_NODE_STATES;
    },
    get running() {
      return runtimeByPipeline.get(currentRuntimeKey())?.running ?? false;
    },
    get runningCount() {
      return [...runtimeByPipeline.values()].filter((runtime) => runtime.running).length;
    },
    get currentRunId() {
      return runtimeByPipeline.get(currentRuntimeKey())?.runId ?? null;
    },
    isPipelineRunning(id: string | null = pipelineId) {
      return runtimeByPipeline.get(runtimeKeyFor(id))?.running ?? false;
    },
    nodeStatesFor(id: string | null = pipelineId): Map<string, NodeRunState> {
      return runtimeByPipeline.get(runtimeKeyFor(id))?.nodeStates ?? EMPTY_NODE_STATES;
    },
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
      await initializer.run(async (isCurrent) => {
        const api = liatir();
        if (!api) return;
        try {
          if (await appStorage.exists(getFile())) {
            const raw = await appStorage.readText(getFile());
            const ws: PipelineWorkspace = JSON.parse(raw);
            if (!isCurrent()) return;

            currentNodes = ws.current?.nodes ?? [];
            currentEdges = ws.current?.edges ?? [];
            pipelineName = ws.current?.name ?? 'Untitled Pipeline';
            pipelineId = ws.current?.id ?? null;
            savedPipelines = ws.saved ?? [];
            const serializedRuntimes = ws.runtime ?? [];
            runtimeByPipeline = new Map(
              serializedRuntimes.map((runtime) => [runtime.key, deserializeRuntimeState(runtime)])
            );

            const interruptedRuntimes = serializedRuntimes.filter(
              (runtime) => runtime.running && runtime.runId
            );
            if (interruptedRuntimes.length > 0) {
              await analysisRuns.init();
              for (const runtime of interruptedRuntimes) {
                if (!isCurrent()) return;
                const endedAt = Date.now();
                const startedAt = runtime.startedAt ?? endedAt;
                await analysisRuns.add({
                  id: runtime.runId!,
                  tool: 'pipeline',
                  label: runtime.pipelineName || 'Pipeline',
                  inputs: [],
                  params: {
                    steps: runtime.nodeStates.length,
                    pipelineId: runtime.pipelineId,
                    pipelineRunId: runtime.runId,
                  },
                  outputFiles: [],
                  status: 'error',
                  startedAt,
                  endedAt,
                  durationMs: Math.max(0, endedAt - startedAt),
                  output: null,
                  error: INTERRUPTED_PIPELINE_ERROR,
                  log: runtime.nodeStates.flatMap(([, state]) => state.logs ?? []),
                }).catch((error) => {
                  console.error('[pipeline] failed to persist interrupted analysis run', error);
                });
              }

              if (!isCurrent()) return;
              // Persist the reconciled non-running states so subsequent launches
              // do not repeatedly recover the same interrupted execution.
              await persist();
            }
          }
        } catch { /* start fresh */ }
      });
    },

    reset() {
      clearTimeout(persistTimer);
      for (const execution of activeExecutions.values()) execution.controller.abort();
      activeExecutions.clear();
      initializer.reset();
      savedPipelines = [];
      pipelineName = 'Untitled Pipeline';
      pipelineId = null;
      pendingLoad = null;
      currentNodes = [];
      currentEdges = [];
      runtimeByPipeline = new Map();
    },

    resetRuntime() {
      for (const execution of activeExecutions.values()) execution.controller.abort();
      activeExecutions.clear();
      runtimeByPipeline = new Map();
      schedulePersist();
    },

    async savePipeline(name: string) {
      const previousKey = currentRuntimeKey();
      const id = pipelineId ?? crypto.randomUUID();
      const p: SavedPipeline = {
        id, name,
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
        updatedAt: Date.now(),
      };
      pipelineName = name;
      pipelineId = id;
      moveRuntimeState(previousKey, runtimeKeyFor(id), id, name);
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
      runtimeFor(runtimeKeyFor(p.id), p.id, p.name);
      pendingLoad = { nodes: currentNodes, edges: currentEdges, name: p.name, id: p.id };
    },

    newPipeline() {
      currentNodes = [];
      currentEdges = [];
      pipelineName = 'Untitled Pipeline';
      pipelineId = null;
      runtimeByPipeline = new Map([...runtimeByPipeline, [DRAFT_PIPELINE_KEY, createRuntimeState(DRAFT_PIPELINE_KEY, null, 'Untitled Pipeline')]]);
      pendingLoad = { nodes: [], edges: [], name: 'Untitled Pipeline', id: null };
      schedulePersist();
    },

    async deleteSavedPipeline(id: string) {
      savedPipelines = savedPipelines.filter(p => p.id !== id);
      await persist();
    },

    async renamePipeline(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      savedPipelines = savedPipelines.map(p =>
        p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p
      );
      if (pipelineId === id) pipelineName = trimmed;
      await persist();
    },

    async duplicatePipeline(source: SavedPipeline): Promise<SavedPipeline> {
      const copy: SavedPipeline = {
        id: crypto.randomUUID(),
        name: `${source.name} (copy)`,
        nodes: JSON.parse(JSON.stringify(source.nodes)),
        edges: JSON.parse(JSON.stringify(source.edges)),
        updatedAt: Date.now(),
      };
      savedPipelines = [copy, ...savedPipelines];
      await persist();
      return copy;
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
      const runPipelineId = pipelineId;
      const runPipelineName = pipelineName || 'Pipeline';
      const runKey = runtimeKeyFor(runPipelineId);
      const existingRuntime = runtimeFor(runKey, runPipelineId, runPipelineName);
      const { nodes: graphNodes, edges: graphEdges } = executableGraph(nodes, edges);
      if (existingRuntime.running || graphNodes.length === 0) return;
      const api = liatir();
      if (!api) return;
      await Promise.all([
        dataFiles.init(),
        apiConnections.init(),
        liaPluginsStore.init(),
      ]);

      const fresh = new Map<string, NodeRunState>();
      for (const n of graphNodes) fresh.set(n.id, initNodeState());
      const pipelineRunId = crypto.randomUUID();
      const controller = new AbortController();
      const execution: ActivePipelineExecution = {
        runId: pipelineRunId,
        controller,
        childJobIds: new Set(),
      };
      activeExecutions.set(runKey, execution);
      setRuntime(runKey, {
        pipelineId: runPipelineId,
        pipelineName: runPipelineName,
        nodeStates: fresh,
        running: true,
        runId: pipelineRunId,
        startedAt: Date.now(),
      });

      const states = () => runtimeNodeStates(runKey);
      const patchRunState = (nodeId: string, patch: Partial<NodeRunState>) => patchStateFor(runKey, nodeId, patch);
      const pipelineStepContext = (
        nodeId: string,
        definition: PipelineStepDefinition,
        label: string,
        resolved: Record<string, string>,
        outputDir: string,
        startedAt: number
      ): AIPipelineRunContext => ({
        runKind: 'pipeline-step',
        pipelineRunId,
        pipelineId: runPipelineId,
        pipelineName: runPipelineName,
        nodeId,
        toolId: definition.id,
        label,
        params: resolved,
        startedAt,
        outputDir,
        signal: controller.signal,
        onJobId: (jobId) => {
          const active = activeExecutions.get(runKey);
          if (active?.runId === pipelineRunId) active.childJobIds.add(jobId);
        },
      });

      // Accumulate step results to record ONE grouped pipeline run in Results.
      const pipeStartedAt = Date.now();
      const pipeSteps: PipelineStepRecord[] = [];
      let fatalError: unknown = null;

      try {
        const order = topoSort(graphNodes, graphEdges);
        const skipped = new Set<string>();

        for (const nodeId of order) {
          throwIfRunCancelled(controller.signal);
          if (skipped.has(nodeId)) continue;
          const node = graphNodes.find(n => n.id === nodeId);
          if (!node || node.type === 'start') continue;

        // ── Tool node ──────────────────────────────────────────────────────────
        if (node.type === 'tool') {
          const entry = resolveStepEntry(node.data?.stepId as string ?? '');
          if (!entry) {
            patchRunState(nodeId, { status: 'error', error: `Unknown tool: ${node.data?.stepId}` });
            break;
          }
          const nodeLabel = nodeDisplayLabel(node, entry.definition.label);
          patchRunState(nodeId, { status: 'running' });

          const { absDir: outputDir, virtualFolder } = await ensureResultsDir(entry.definition.label);

          const resolved = resolveInputs(
            graphNodes,
            states(),
            inputsWithDefaults(entry.definition, node.data?.inputs as Record<string, string> ?? {})
          );
          const logs: string[] = [];
          try {
            const result = await entry.run(resolved, outputDir, (line) => {
              logs.push(line);
              patchRunState(nodeId, { logs: [...logs] });
            }, pipelineStepContext(nodeId, entry.definition, nodeLabel, resolved, outputDir, pipeStartedAt));
            const outputFiles = withArtifactsMetadata(result.outputFiles, {
              role: 'final',
              createdAt: Date.now(),
              producer: {
                kind: entry.definition.type,
                id: entry.definition.id,
                label: nodeLabel,
                nodeId,
              },
              parentRun: {
                runKind: 'pipeline-step',
                runId: pipelineRunId,
                analysisRunId: pipelineRunId,
                pipelineRunId,
                pipelineId: runPipelineId,
                nodeId,
              },
            });
            await registerSettledFiles(outputFiles, virtualFolder);
            throwIfRunCancelled(controller.signal);
            patchRunState(nodeId, {
              status: 'done',
              logs,
              outputFiles,
              error: null,
              outputValues: outputsToValues(result.metrics, result.values),
            });
            pipeSteps.push({ label: nodeLabel, output: result.output, files: outputFiles });
          } catch (e) {
            const cancelled = isRunCancelled(e, controller.signal);
            patchRunState(nodeId, {
              status: cancelled ? 'cancelled' : 'error',
              logs,
              outputFiles: [],
              error: cancelled ? PIPELINE_CANCELLED_MESSAGE : String(e),
            });
            break;
          }

        // ── Variable node ──────────────────────────────────────────────────────
        } else if (node.type === 'variable') {
          const d = node.data as unknown as VariableNodeData;
          patchRunState(nodeId, { status: 'done', outputValues: { value: d.value ?? '' } });

        // ── Math node ──────────────────────────────────────────────────────────
        } else if (node.type === 'math') {
          const d = node.data as unknown as MathNodeData;
          const a = Number(resolveRef(d.literalA ?? '', graphNodes, states()) || 0);
          const b = Number(resolveRef(d.literalB ?? '', graphNodes, states()) || 0);
          patchRunState(nodeId, { status: 'done', outputValues: { result: String(computeMath(d.operation, a, b)) } });

        // ── Condition node ─────────────────────────────────────────────────────
        } else if (node.type === 'condition') {
          const d = node.data as unknown as ConditionNodeData;
          const value = resolveRef(d.valueRef ?? '', graphNodes, states());
          const evaluated = evaluateConditionNode(d, value);
          if (evaluated.error) {
            patchRunState(nodeId, { status: 'error', error: evaluated.error });
            break;
          }
          const ok = evaluated.ok;
          const branch: 'true' | 'false' = ok ? 'true' : 'false';
          patchRunState(nodeId, {
            status: 'done',
            activeBranch: branch,
            outputValues: { trueBranch: ok ? value : '', falseBranch: !ok ? value : '' },
          });
          const dead = findDeadBranchNodes(graphNodes, graphEdges, nodeId, ok ? 'falseBranch' : 'trueBranch', states());
          for (const s of dead) {
            skipped.add(s);
            patchRunState(s, { status: 'skipped' });
          }

        // ── Sub-pipeline node ──────────────────────────────────────────────────
        } else if (node.type === 'sub-pipeline') {
          const d = node.data as unknown as SubPipelineNodeData;
          if (!d.pipelineId) {
            patchRunState(nodeId, { status: 'error', error: 'No pipeline selected' });
            break;
          }
          const sub = savedPipelines.find(p => p.id === d.pipelineId);
          if (!sub) {
            patchRunState(nodeId, { status: 'error', error: 'Pipeline not found' });
            break;
          }
          patchRunState(nodeId, { status: 'running', logs: [`▶ Running sub-pipeline: ${nodeDisplayLabel(node, sub.name)}`] });
          try {
            const subContext: AIPipelineRunContext = {
              runKind: 'pipeline-step',
              pipelineRunId,
              pipelineId: runPipelineId,
              pipelineName: runPipelineName,
              nodeId,
              toolId: 'sub-pipeline',
              label: nodeDisplayLabel(node, sub.name),
              params: { pipelineId: sub.id },
              startedAt: pipeStartedAt,
              outputDir: '',
              signal: controller.signal,
              onJobId: (jobId) => execution.childJobIds.add(jobId),
            };
            const subFiles = await runNodes(
              sub.nodes,
              sub.edges,
              (line) => {
                const curr = states().get(nodeId);
                patchRunState(nodeId, { logs: [...(curr?.logs ?? []), line] });
              },
              subContext,
              runPipelineId ? [runPipelineId, sub.id] : [sub.id],
            );
            throwIfRunCancelled(controller.signal);
            patchRunState(nodeId, { status: 'done', outputFiles: subFiles });
            pipeSteps.push({ label: nodeDisplayLabel(node, sub.name), files: subFiles });
          } catch (e) {
            const cancelled = isRunCancelled(e, controller.signal);
            patchRunState(nodeId, {
              status: cancelled ? 'cancelled' : 'error',
              error: cancelled ? PIPELINE_CANCELLED_MESSAGE : String(e),
            });
            break;
          }

        // ── API Request node ───────────────────────────────────────────────────
        } else if (node.type === 'api-request') {
          const d = node.data as unknown as ApiRequestNodeData;
          if (!d.requestId) {
            patchRunState(nodeId, { status: 'error', error: 'No request selected' });
            break;
          }
          const req = apiConnections.requestById(d.requestId);
          if (!req) {
            patchRunState(nodeId, { status: 'error', error: 'Request not found' });
            break;
          }
          patchRunState(nodeId, { status: 'running', logs: [`${req.method} ${req.url}`] });
          try {
            const result = await executeApiRequestNode(
              node,
              graphNodes,
              states(),
              controller.signal,
              { pipelineRunId, pipelineId: runPipelineId, nodeId },
            );
            patchRunState(nodeId, {
              status: 'done',
              outputFiles: result.outputFiles,
              outputValues: result.outputValues,
            });
            pipeSteps.push({ label: result.label, files: result.outputFiles });
          } catch (e) {
            const cancelled = isRunCancelled(e, controller.signal);
            patchRunState(nodeId, {
              status: cancelled ? 'cancelled' : 'error',
              error: cancelled ? PIPELINE_CANCELLED_MESSAGE : String(e),
            });
            break;
          }
          }
        }
      } catch (e) {
        const cancelled = isRunCancelled(e, controller.signal);
        fatalError = cancelled ? null : e;
        if (cancelled) {
          const activeNode = graphNodes.find(n => states().get(n.id)?.status === 'running');
          if (activeNode) {
            patchRunState(activeNode.id, {
              status: 'cancelled',
              error: PIPELINE_CANCELLED_MESSAGE,
            });
          }
        } else if (e instanceof PipelineCycleError) {
          for (const nodeId of e.nodeIds) {
            patchRunState(nodeId, { status: 'error', error: e.message });
          }
        } else {
          const firstPending = graphNodes.find(n => states().get(n.id)?.status === 'pending');
          if (firstPending) patchRunState(firstPending.id, { status: 'error', error: errorMessage(e) });
        }
      } finally {
        // Record ONE grouped run for this pipeline execution (visible in Results),
        // instead of one loose run per step.
        const finalStates = states();
        const erroredEntry = [...finalStates.entries()].find(([, s]) => s.status === 'error');
        const cancelledEntry = [...finalStates.entries()].find(([, s]) => s.status === 'cancelled');
        const wasCancelled = controller.signal.aborted || Boolean(cancelledEntry);
        const fatalMessage = fatalError ? errorMessage(fatalError) : null;
        if (graphNodes.length > 0) {
          // The Result index is the public completion signal. Persist every
          // terminal node state first so readers can never observe a completed
          // Result while its pipeline nodes are still running or absent.
          await flushPersist();
          const endedAt = Date.now();
          const logs = [...finalStates.values()].flatMap(s => s.logs ?? []);
          const allFiles = pipeSteps.flatMap(s => s.files);
          await analysisRuns.init();
          await analysisRuns.add({
            id: pipelineRunId,
            tool: 'pipeline',
            label: runPipelineName,
            inputs: [],
            params: { steps: pipeSteps.length, pipelineId: runPipelineId, pipelineRunId },
            outputFiles: allFiles,
            status: wasCancelled ? 'cancelled' : (erroredEntry || fatalMessage ? 'error' : 'done'),
            startedAt: pipeStartedAt,
            endedAt,
            durationMs: endedAt - pipeStartedAt,
            output: wasCancelled || erroredEntry || fatalMessage ? null : buildPipelineOutput(pipeSteps),
            error: wasCancelled
              ? PIPELINE_CANCELLED_MESSAGE
              : (erroredEntry ? (finalStates.get(erroredEntry[0])?.error ?? 'Pipeline failed') : fatalMessage),
            log: logs,
          }).catch((error) => {
            console.error('[pipeline] failed to persist analysis run', error);
          });
        }

        const runtime = runtimeFor(runKey, runPipelineId, runPipelineName);
        setRuntime(runKey, {
          ...runtime,
          running: false,
          runId: pipelineRunId,
          startedAt: pipeStartedAt,
        });
        await flushPersist();
        const active = activeExecutions.get(runKey);
        if (active?.runId === pipelineRunId) activeExecutions.delete(runKey);
      }
    },

    async cancel(id: string | null = pipelineId) {
      const key = runtimeKeyFor(id);
      const execution = activeExecutions.get(key);
      if (!execution) return;

      execution.controller.abort();
      const api = liatir();
      if (!api) return;
      await Promise.all(
        [...execution.childJobIds].map((jobId) =>
          api.invoke('lia_jobs_kill', { jobId }).catch(() => false)
        )
      );
    },

    resetStates(nodeIds: string[]) {
      const fresh = new Map<string, NodeRunState>();
      for (const id of nodeIds) fresh.set(id, initNodeState());
      const runtime = runtimeFor();
      setRuntime(currentRuntimeKey(), { ...runtime, nodeStates: fresh, running: false, runId: null, startedAt: null });
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
