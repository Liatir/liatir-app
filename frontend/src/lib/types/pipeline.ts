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

export interface ConditionNodeData extends Record<string, unknown> {
  condition: string;
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

export interface NodeRunState {
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
}>;

export interface PipelineRegistryEntry {
  definition: PipelineStepDefinition;
  run: StepRunFn;
}
