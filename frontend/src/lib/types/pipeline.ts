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

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

// ── Visual DAG node types ────────────────────────────────────────────────────

export interface ToolNodeData extends Record<string, unknown> {
  stepId: string;
  inputs: Record<string, string>;
  label?: string;
}

export interface NodeRunState {
  status: StepStatus;
  logs: string[];
  outputFiles: RunOutputFile[];
  error: string | null;
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
) => Promise<{ outputFiles: RunOutputFile[] }>;

export interface PipelineRegistryEntry {
  definition: PipelineStepDefinition;
  run: StepRunFn;
}
