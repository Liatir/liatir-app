export interface InputFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'file';
  label?: string;
  required?: boolean;
  default?: unknown;
  accept?: string[];
}

export interface OutputFieldSchema {
  type: 'file' | 'stats' | 'string' | 'number';
  label?: string;
  ext?: string[];
  description?: string;
  /** Display hint for numeric metric outputs (type: 'number'). */
  format?: 'integer' | 'decimal' | 'percent';
}

export interface PipelineStepDefinition {
  id: string;
  type: 'native-tool' | 'lia-module' | 'wasm-plugin';
  label: string;
  description: string;
  category: string;
  inputSchema: Record<string, InputFieldSchema>;
  outputSchema: Record<string, OutputFieldSchema>;
}

export interface RunOutputFile {
  label: string;
  path: string;
  ext: string;
  size?: number;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

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
  onLog: (line: string) => void
) => Promise<{
  outputFiles: RunOutputFile[];
  output?: import('./tool-output').ToolOutput;
  /** Numeric metrics exposed as connectable value-outputs (→ Math / Condition nodes). */
  metrics?: Record<string, number>;
}>;

export interface PipelineRegistryEntry {
  definition: PipelineStepDefinition;
  run: StepRunFn;
}
