/**
 * How a pipeline node saves an edit the user made inside it.
 *
 * A node component (a form field on a step, say) can change its own data, but only the pipeline editor
 * that owns the graph can persist it. Passing a save callback down through every node type would be
 * unwieldy, so the editor publishes one on Svelte's context and nodes reach for it.
 *
 * A node rendered *outside* a pipeline — the same component reused on a standalone tool page — finds no
 * context and gets `null`. That is a supported case, not an error: there is simply no graph to save to.
 */
import { getContext, tick } from 'svelte';
import type { Edge, Node } from '@xyflow/svelte';

export const PIPELINE_NODE_DATA_CONTEXT = 'pipelineNodeData';

export interface PipelineNodeDataContext {
  commitNodeDataChange: (nodes: Node[], edges: Edge[]) => void;
}

export function getPipelineNodeDataContext(): PipelineNodeDataContext | null {
  return getContext<PipelineNodeDataContext | null>(PIPELINE_NODE_DATA_CONTEXT) ?? null;
}

/**
 * Persists the graph after a node changed its own data.
 *
 * The `tick()` is what makes this correct. A node updates its data reactively, and svelte-flow's node
 * array only reflects that once Svelte has flushed. Reading the nodes before the tick would capture the
 * state *before* the edit and save a stale graph — silently discarding the change the user just made.
 */
export async function commitNodeDataAfterUpdate(
  context: PipelineNodeDataContext | null,
  getNodes: () => Node[],
  getEdges: () => Edge[] | unknown,
) {
  if (!context) return;
  await tick();
  context.commitNodeDataChange(getNodes(), getEdges() as Edge[]);
}
