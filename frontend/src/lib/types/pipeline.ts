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

export interface MathNodeData extends Record<string, unknown> {
  operation: '+' | '-' | '*' | '/' | 'min' | 'max' | 'round' | 'floor' | 'ceil' | 'abs';
  literalA?: string;
  literalB?: string;
  label?: string;
}

export interface ConditionNodeData extends Record<string, unknown> {
  condition: string;
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
