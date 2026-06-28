import { getContext, tick } from 'svelte';
import type { Edge, Node } from '@xyflow/svelte';

export const PIPELINE_NODE_DATA_CONTEXT = 'pipelineNodeData';

export interface PipelineNodeDataContext {
  commitNodeDataChange: (nodes: Node[], edges: Edge[]) => void;
}

export function getPipelineNodeDataContext(): PipelineNodeDataContext | null {
  return getContext<PipelineNodeDataContext | null>(PIPELINE_NODE_DATA_CONTEXT) ?? null;
}

export async function commitNodeDataAfterUpdate(
  context: PipelineNodeDataContext | null,
  getNodes: () => Node[],
  getEdges: () => Edge[] | unknown,
) {
  if (!context) return;
  await tick();
  context.commitNodeDataChange(getNodes(), getEdges() as Edge[]);
}
