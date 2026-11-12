import type { JsonValue, LiatirInputFieldSchema, LiatirOutputFieldSchema, LiatirPythonPluginRuntimeSpec } from './index.js';

/** Editable workspace source; every execution snapshots this complete definition. */
export interface LiatirPythonScript {
  id: string;
  name: string;
  code: string;
  folder: string;
  savedAt: number;
  language: 'python';
  inputSchema: Record<string, LiatirInputFieldSchema>;
  outputSchema: Record<string, LiatirOutputFieldSchema>;
  python: Omit<LiatirPythonPluginRuntimeSpec, 'entry'>;
}

export interface LiatirScriptRunRequest {
  script: LiatirPythonScript;
  workspaceId: string;
  runId: string;
  inputs: Record<string, JsonValue>;
  metadata?: Record<string, JsonValue>;
}

export interface LiatirScriptsAPI {
  run(request: LiatirScriptRunRequest): Promise<{ jobId: string }>;
}

export const LIATIR_SCRIPT_STEP_PREFIX = 'script:';
export const LIATIR_SCRIPT_INPUT_TYPES = ['string', 'number', 'boolean', 'file'] as const;
export const LIATIR_SCRIPT_OUTPUT_TYPES = ['string', 'number', 'boolean', 'file', 'json', 'stats'] as const;
/** Starting code for a new script: valid as is, with no inputs and no outputs declared. */
export const LIATIR_PYTHON_SCRIPT_TEMPLATE = `def main(ctx):
    # Inputs and outputs are validated by Liatir's Python SDK.
    # Read an input by its name, e.g. ctx.input["my_variable"].

    # Write your code here...

    # Return your outputs by name, e.g. {"my_result": 42}.
    return {}
`;

/** A contract field name: usable as a Python dictionary key and a pipeline port. */
export const LIATIR_SCRIPT_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The mandatory contract checked before a Script is saved or run; the Python SDK checks values. */
export function validateLiatirScript(script: LiatirPythonScript): void {
  if (!script || script.language !== 'python' || typeof script.id !== 'string' || !script.id.trim()
    || typeof script.name !== 'string' || !script.name.trim()
    || typeof script.code !== 'string' || !script.code.trim()) {
    throw new Error('A Python script needs a name and source code.');
  }
  const contracts = [
    ['input', script.inputSchema, LIATIR_SCRIPT_INPUT_TYPES],
    ['output', script.outputSchema, LIATIR_SCRIPT_OUTPUT_TYPES],
  ] as const;
  for (const [kind, schema, allowed] of contracts) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error(`Declare the ${kind} contract (an empty one is allowed).`);
    }
    for (const [name, field] of Object.entries(schema)) {
      if (!LIATIR_SCRIPT_FIELD_NAME.test(name) || !field || !allowed.some((type) => type === field.type)) {
        throw new Error(`Invalid ${kind} field "${name}".`);
      }
    }
  }
  if (!script.python || typeof script.python !== 'object') {
    throw new Error('Declare the Python packages (an empty list is allowed).');
  }
  // Package names only: options such as an alternative index would change where code comes from.
  for (const requirement of script.python.requirements ?? []) {
    if (typeof requirement !== 'string' || !requirement.trim() || requirement.trim().startsWith('-')) {
      throw new Error(`Invalid Python package "${requirement}". Write one package name per line, such as pandas or numpy>=1.26.`);
    }
  }
}
