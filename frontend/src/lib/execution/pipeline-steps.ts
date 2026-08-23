/**
 * What a pipeline run records about its own steps.
 *
 * A pure function of the graph and the node states, kept out of the store so it can be tested for
 * the things that are easy to get quietly wrong — the order, and the wiring — rather than only
 * observed after a real pipeline has run.
 */
import type { Edge, Node } from '@xyflow/svelte';
import { isExecutablePipelineNode, type NodeRunState } from '$lib/types/pipeline';
import { resolveStepEntry } from '$lib/tools/pipeline-registry';
import {
  LIATIR_RUN_RECORD_SCHEMA_VERSION,
  type LiatirRunStep,
  type LiatirRunStepConnection,
  type LiatirRunSteps,
} from '@liatir/core';

/**
 * Prefer the user's custom node name (`data.label`) over the tool/type name for anything
 * user-facing: Results headings, logs, artifact metadata.
 */
export function nodeDisplayLabel(node: Node, fallback: string): string {
  return ((node.data?.label as string) ?? '').trim() || fallback;
}

/**
 * A pipeline's `steps.json`: what ran, in the order it started, and how it was wired.
 *
 * Kept apart from `metadata.json`, which describes the pipeline run itself. This file describes what
 * happened inside it, and it is what makes the flat layout navigable: a step is an ordinary run in
 * `runs/`, and this is the only thing that says which runs belonged to this pipeline.
 *
 * **Ordered by start time, not by graph position.** It used to be written in the order the nodes
 * happened to sit in the graph array — creation order, which is nobody's mental model of a run. No
 * index accompanies it: a pipeline is a graph, independent steps can start together, and numbering
 * them would assert a sequence that does not exist. Nodes that never started have no time to sort
 * by and come last.
 *
 * **The connections are recorded too**, because the order things ran in does not say what fed what.
 * Two adjacent entries may be unrelated, and a condition's `trueBranch`/`falseBranch` handles are
 * the only thing that says which downstream steps hung off the branch that was taken.
 *
 * A utility node — variable, math, condition — has an identity but no directory, because it computes
 * a value rather than running a process and would otherwise leave an empty folder per arithmetic
 * operation. Its result is recorded here, which is the whole of what there is to record about it.
 */
export function pipelineStepsRecord(
  graphNodes: Node[],
  graphEdges: Edge[],
  nodeStates: Map<string, NodeRunState>,
): LiatirRunSteps {
  const steps: LiatirRunStep[] = [];
  for (const node of graphNodes) {
    if (!isExecutablePipelineNode(node)) continue;
    const state = nodeStates.get(node.id);
    if (!state) continue;
    const entry = node.type === 'tool'
      ? resolveStepEntry(node.data?.stepId as string ?? '')
      : null;
    const kind: LiatirRunStep['kind'] = entry
      ? entry.definition.type
      : node.type === 'api-request'
        ? 'api-request'
        : node.type === 'sub-pipeline'
          ? 'sub-pipeline'
          : 'utility';
    const value = state.outputValues && Object.keys(state.outputValues).length > 0
      ? state.outputValues
      : undefined;
    steps.push({
      nodeId: node.id,
      kind,
      label: nodeDisplayLabel(node, entry?.definition.label ?? node.type ?? 'Step'),
      runId: state.executionRunId ?? '',
      status: state.status,
      ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
      ...(state.endedAt !== undefined ? { endedAt: state.endedAt } : {}),
      error: state.error,
      ...(kind === 'utility' && value ? { value } : {}),
      ...(state.activeBranch ? { activeBranch: state.activeBranch } : {}),
    });
  }
  // Stable sort, so nodes that never started keep graph order among themselves.
  steps.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));

  // Only between steps this file actually lists: a connection pointing at a nodeId that is not here
  // would be a dangling reference, which is worse than the omission.
  const recorded = new Set(steps.map((step) => step.nodeId));
  const connections: LiatirRunStepConnection[] = graphEdges
    .filter((edge) => recorded.has(edge.source) && recorded.has(edge.target))
    .map((edge) => ({
      from: edge.source,
      output: edge.sourceHandle ?? null,
      to: edge.target,
      input: edge.targetHandle ?? null,
    }));

  return { schemaVersion: LIATIR_RUN_RECORD_SCHEMA_VERSION, steps, connections };
}
