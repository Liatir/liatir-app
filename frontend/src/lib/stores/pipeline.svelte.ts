import type { Node, Edge } from '@xyflow/svelte';
import { liatir } from '$lib/api';
import { dataFiles } from './dataFiles.svelte';
import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
import type { ToolNodeData, NodeRunState } from '$lib/types/pipeline';

function createPipelineStore() {
  let nodeStates = $state(new Map<string, NodeRunState>());
  let running = $state(false);

  // Kahn's algorithm — returns node IDs in topological order
  function topoSort(nodes: Node<ToolNodeData>[], edges: Edge[]): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const n of nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }
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

  function initNodeState(id: string): NodeRunState {
    return { status: 'pending', logs: [], outputFiles: [], error: null };
  }

  function patchState(id: string, patch: Partial<NodeRunState>) {
    const prev = nodeStates.get(id) ?? initNodeState(id);
    nodeStates = new Map([...nodeStates, [id, { ...prev, ...patch }]]);
  }

  async function run(nodes: Node<ToolNodeData>[], edges: Edge[]) {
    if (running || nodes.length === 0) return;
    const api = liatir();
    if (!api) return;

    const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    const outputDir = `${data}/tool-outputs`;

    running = true;

    // Reset all states
    const fresh = new Map<string, NodeRunState>();
    for (const n of nodes) fresh.set(n.id, initNodeState(n.id));
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

      // Resolve inputs: static values + @pipe: tokens + edges from completed source nodes
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

        for (const f of result.outputFiles) {
          await dataFiles.add(f.path).catch(() => {});
        }
      } catch (e) {
        patchState(nodeId, { status: 'error', logs, outputFiles: [], error: String(e) });
        break;
      }
    }

    running = false;
  }

  function resetStates(nodeIds: string[]) {
    const fresh = new Map<string, NodeRunState>();
    for (const id of nodeIds) fresh.set(id, initNodeState(id));
    nodeStates = fresh;
  }

  return {
    get nodeStates() { return nodeStates; },
    get running() { return running; },
    run,
    resetStates,
  };
}

export const pipelineStore = createPipelineStore();
