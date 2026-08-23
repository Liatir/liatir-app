/**
 * What a pipeline run says about its own steps.
 *
 * `steps.json` was written in graph-array order — the order nodes were dropped on the canvas — and
 * recorded no connections at all. Both are the kind of thing that looks fine until someone opens the
 * file to work out what happened: a list in creation order reads as a sequence that was never run,
 * and without the edges there is nothing saying what fed what, or which branch of a condition the
 * run actually took.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/svelte';

// The tool registry this reaches through is imported by modules that declare runes at module scope.
// The function under test is pure; the stub only gets its import graph to load under plain Node.
vi.stubGlobal('$state', <T>(value: T) => value);

const { pipelineStepsRecord } = await import('$lib/execution/pipeline-steps');
type NodeRunState = import('$lib/types/pipeline').NodeRunState;

function node(id: string, type: string): Node {
  return { id, type, position: { x: 0, y: 0 }, data: {} } as Node;
}

function edge(from: string, output: string | null, to: string, input: string | null): Edge {
  return {
    id: `${from}-${to}`,
    source: from,
    target: to,
    ...(output !== null ? { sourceHandle: output } : {}),
    ...(input !== null ? { targetHandle: input } : {}),
  } as Edge;
}

function state(partial: Partial<NodeRunState>): NodeRunState {
  return { status: 'done', logs: [], outputFiles: [], error: null, ...partial } as NodeRunState;
}

describe('a pipeline run’s steps.json', () => {
  it('is ordered by when each step started, not by where its node sits in the graph', () => {
    // Declared c, a, b — the order they were added to the canvas. They ran a, b, c.
    const nodes = [node('c', 'variable'), node('a', 'variable'), node('b', 'variable')];
    const states = new Map<string, NodeRunState>([
      ['c', state({ startedAt: 300 })],
      ['a', state({ startedAt: 100 })],
      ['b', state({ startedAt: 200 })],
    ]);

    const record = pipelineStepsRecord(nodes, [], states);

    expect(record.steps.map((step) => step.nodeId)).toEqual(['a', 'b', 'c']);
  });

  it('puts steps that never started last, keeping graph order among them', () => {
    // Skipped by a branch or never reached: there is no start time to sort by, and inventing one
    // would place them among steps that really did run.
    const nodes = [node('skipped-1', 'variable'), node('ran', 'variable'), node('skipped-2', 'variable')];
    const states = new Map<string, NodeRunState>([
      ['skipped-1', state({ status: 'pending' })],
      ['ran', state({ startedAt: 500 })],
      ['skipped-2', state({ status: 'pending' })],
    ]);

    const record = pipelineStepsRecord(nodes, [], states);

    expect(record.steps.map((step) => step.nodeId)).toEqual(['ran', 'skipped-1', 'skipped-2']);
  });

  it('carries no index, because independent steps can start at the same moment', () => {
    const nodes = [node('a', 'variable'), node('b', 'variable')];
    const states = new Map<string, NodeRunState>([
      ['a', state({ startedAt: 100 })],
      ['b', state({ startedAt: 100 })],
    ]);

    const record = pipelineStepsRecord(nodes, [], states);

    for (const step of record.steps) {
      expect(step).not.toHaveProperty('index');
    }
    // Both started together and both are present — the tie is not resolved by dropping one.
    expect(record.steps).toHaveLength(2);
  });

  it('records what feeds what, named by handle on both ends', () => {
    const nodes = [node('a', 'variable'), node('b', 'math')];
    const states = new Map<string, NodeRunState>([
      ['a', state({ startedAt: 100 })],
      ['b', state({ startedAt: 200 })],
    ]);

    const record = pipelineStepsRecord(nodes, [edge('a', 'output', 'b', 'input')], states);

    expect(record.connections).toEqual([
      { from: 'a', output: 'output', to: 'b', input: 'input' },
    ]);
  });

  it('says which branch a condition took, and where each branch led', () => {
    const nodes = [
      node('cond', 'condition'),
      node('on-true', 'variable'),
      node('on-false', 'variable'),
    ];
    const states = new Map<string, NodeRunState>([
      ['cond', state({ startedAt: 100, activeBranch: 'true', outputValues: { trueBranch: 'yes', falseBranch: '' } })],
      ['on-true', state({ startedAt: 200 })],
      ['on-false', state({ status: 'pending' })],
    ]);
    const edges = [
      edge('cond', 'trueBranch', 'on-true', 'input'),
      edge('cond', 'falseBranch', 'on-false', 'input'),
    ];

    const record = pipelineStepsRecord(nodes, edges, states);

    const condition = record.steps.find((step) => step.nodeId === 'cond');
    expect(condition?.activeBranch).toBe('true');
    // Both connections are kept: which one was abandoned is readable from the branch, and dropping
    // it would hide half of what the pipeline is wired to do.
    expect(record.connections).toEqual([
      { from: 'cond', output: 'trueBranch', to: 'on-true', input: 'input' },
      { from: 'cond', output: 'falseBranch', to: 'on-false', input: 'input' },
    ]);
  });

  it('never points a connection at a step it does not list', () => {
    // A node with no run state is not recorded, so an edge touching it would dangle.
    const nodes = [node('a', 'variable'), node('ghost', 'variable')];
    const states = new Map<string, NodeRunState>([['a', state({ startedAt: 100 })]]);

    const record = pipelineStepsRecord(nodes, [edge('a', 'output', 'ghost', 'input')], states);

    const listed = new Set(record.steps.map((step) => step.nodeId));
    expect(listed).toEqual(new Set(['a']));
    expect(record.connections).toEqual([]);
  });

  it('stamps the schema version, so a reader knows what shape it is holding', () => {
    const record = pipelineStepsRecord([], [], new Map());

    expect(record.schemaVersion).toBe(1);
    expect(record.steps).toEqual([]);
    expect(record.connections).toEqual([]);
  });
});
