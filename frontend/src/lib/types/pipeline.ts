export interface InputFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'file';
  label?: string;
  required?: boolean;
  default?: unknown;
  accept?: string[];  // for file type: accepted extensions
}

export interface OutputFieldSchema {
  type: 'file' | 'stats' | 'string' | 'number';
  label?: string;
  ext?: string[];       // for file type: extensions produced
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
  path: string;   // absolute path on disk
  ext: string;
  size?: number;
}
