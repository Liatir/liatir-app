import type { ToolOutput } from './tool-output';
import type { AIRunContext } from '$lib/ai/direct-run-context';

export type {
  InputFieldSchema,
  OutputFieldSchema,
  PipelineStepDefinition,
  RunOutputFile,
  StepStatus,
  LiatirExecutionResult,
  LiatirFileArtifact,
  LiatirStepDefinition,
} from '@liatir/core';

import type {
  JsonValue,
  PipelineStepDefinition,
  RunOutputFile,
  StepStatus,
} from '@liatir/core';

// ── Visual DAG node types ────────────────────────────────────────────────────

export interface ToolNodeData extends Record<string, unknown> {
  stepId: string;
  inputs: Record<string, string>;
  label?: string;
}

export interface VariableNodeData extends Record<string, unknown> {
  varType: 'string' | 'number';
  value: string;
  label?: string;
}

export type MathOperation =
  // binary
  | '+' | '-' | '*' | '/' | '%' | '^' | 'mod' | 'min' | 'max'
  // unary (operand B ignored)
  | 'round' | 'floor' | 'ceil' | 'abs' | 'sqrt' | 'log2' | 'log10' | 'ln';

export interface MathNodeData extends Record<string, unknown> {
  operation: MathOperation;
  /** Operand A — a literal number OR an `@pipe:nodeId:outKey` reference to an upstream value. */
  literalA?: string;
  /** Operand B — a literal number OR an `@pipe:nodeId:outKey` reference (binary ops only). */
  literalB?: string;
  label?: string;
}

export type ConditionOperator =
  | 'exists'
  | 'empty'
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'greater-than'
  | 'greater-or-equal'
  | 'less-than'
  | 'less-or-equal'
  | 'truthy'
  | 'falsy';

export interface ConditionNodeData extends Record<string, unknown> {
  /** Legacy JS expression kept only for older saved pipelines. */
  condition?: string;
  operator?: ConditionOperator;
  compareValue?: string;
  /** The value tested by the expression (`value`): a literal OR an `@pipe:` reference to an upstream output. */
  valueRef?: string;
  label?: string;
}

export interface SubPipelineNodeData extends Record<string, unknown> {
  pipelineId: string | null;
  pipelineName: string;
  label?: string;
}

export interface ApiRequestNodeData extends Record<string, unknown> {
  requestId: string | null;
  requestName: string;
  /** Optional per-parameter overrides (param key → literal OR `@pipe:` reference). Empty = use the request's own value. */
  paramOverrides?: Record<string, string>;
  label?: string;
}

/** Palette available for note nodes. `none` removes the note background entirely. */
export type NoteColor = 'amber' | 'sky' | 'emerald' | 'rose' | 'violet' | 'slate' | 'none';

export interface NoteNodeData extends Record<string, unknown> {
  text: string;
  /** Fixed width in px (resizable); the height auto-fits the content. */
  width?: number;
  /** Background/accent color; defaults to `none` (transparent) when unset. */
  color?: NoteColor;
}

export const EXECUTABLE_PIPELINE_NODE_TYPES = [
  'tool',
  'variable',
  'math',
  'condition',
  'sub-pipeline',
  'api-request',
] as const;

const EXECUTABLE_PIPELINE_NODE_TYPE_SET = new Set<string>(EXECUTABLE_PIPELINE_NODE_TYPES);

export function isExecutablePipelineNode(node: { type?: string | null }): boolean {
  return EXECUTABLE_PIPELINE_NODE_TYPE_SET.has(node.type ?? '');
}

export interface NodeRunState {
  /** Stable child-run identity allocated before this node starts. */
  executionRunId?: string;
  status: StepStatus;
  logs: string[];
  outputFiles: RunOutputFile[];
  error: string | null;
  outputValues?: Record<string, string>;
  activeBranch?: 'true' | 'false';
}

// ── Legacy list-mode types (kept for analysisRuns compatibility) ─────────────

export interface PipelineStepState {
  id: string;
  stepId: string;
  inputs: Record<string, string>;
  status: StepStatus;
  logs: string[];
  outputFiles: RunOutputFile[];
  error: string | null;
}

export type StepRunFn = (
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  context?: AIRunContext
) => Promise<{
  outputFiles: RunOutputFile[];
  output?: ToolOutput;
  /** Numeric metrics exposed as connectable value-outputs (→ Math / Condition nodes). */
  metrics?: Record<string, number>;
  /** Non-file output values exposed as connectable pipeline values. */
  values?: Record<string, JsonValue>;
  /** Durable, engine-specific evidence attached to the owning execution. */
  executionEvidence?: Record<string, JsonValue>;
}>;

export interface PipelineRegistryEntry {
  definition: PipelineStepDefinition;
  run: StepRunFn;
}
