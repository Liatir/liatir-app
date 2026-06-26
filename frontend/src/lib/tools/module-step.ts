import type { LiatirModule, FieldDef } from '$lib/stores/modules.svelte';
import type {
  InputFieldSchema,
  OutputFieldSchema,
  PipelineStepDefinition,
  PipelineRegistryEntry,
  RunOutputFile,
} from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { runLiatirModule } from '$lib/utils/module-run';

/** Pipeline step id for an imported module — namespaced to avoid clashing with native tools. */
export function moduleStepId(moduleId: string): string {
  return `module:${moduleId}`;
}

/** A module's input schema is already InputFieldSchema-shaped. */
function mapInputs(schema: Record<string, FieldDef>): Record<string, InputFieldSchema> {
  const out: Record<string, InputFieldSchema> = {};
  for (const [k, f] of Object.entries(schema)) {
    out[k] = { type: f.type, label: f.label, required: f.required, default: f.default, accept: f.accept };
  }
  return out;
}

/** Map a module output field to a pipeline OutputFieldSchema (booleans surface as strings). */
function mapOutputs(schema: Record<string, FieldDef>): Record<string, OutputFieldSchema> {
  const out: Record<string, OutputFieldSchema> = {};
  for (const [k, f] of Object.entries(schema)) {
    const type: OutputFieldSchema['type'] = f.type === 'file' ? 'file' : f.type === 'number' ? 'number' : 'string';
    out[k] = { type, label: f.label, ext: f.accept, description: f.description };
  }
  return out;
}

/** Build the pipeline step definition (form + handles) for an imported module. */
export function moduleToDefinition(mod: LiatirModule): PipelineStepDefinition {
  return {
    id: moduleStepId(mod.id),
    type: mod.runtime === 'wasm' ? 'wasm-plugin' : 'lia-module',
    label: mod.name,
    description: mod.description || (mod.runtime === 'wasm' ? 'WASM custom tool (sandboxed)' : 'Liatir module'),
    category: mod.runtime === 'wasm' ? 'Custom Tools' : 'Modules',
    inputSchema: mapInputs(mod.inputSchema),
    outputSchema: mapOutputs(mod.outputSchema),
  };
}

/**
 * Full pipeline registry entry for a module: its definition plus a `run` that
 * executes it (Node or WASM) via the shared runner and maps the result back to
 * the pipeline's StepResult — file outputs become RunOutputFiles (for chaining),
 * numeric outputs become connectable metrics.
 */
export function moduleToRegistryEntry(mod: LiatirModule): PipelineRegistryEntry {
  return {
    definition: moduleToDefinition(mod),
    run: async (inputs, _outputDir, onLog) => {
      const out = await runLiatirModule(mod, inputs, (_stream, line) => onLog(line));
      if (out.exitCode !== 0) {
        throw new Error(out.stderr.join('\n') || `Module "${mod.name}" exited with code ${out.exitCode}`);
      }

      const result = out.result;
      const outputFiles: RunOutputFile[] = [];
      const metrics: Record<string, number> = {};

      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        for (const [key, field] of Object.entries(mod.outputSchema)) {
          const v = obj[key];
          if (field.type === 'file' && typeof v === 'string' && v.length > 0) {
            outputFiles.push({ label: field.label ?? key, path: v, ext: v.split('.').pop() ?? '' });
          } else if (field.type === 'number' && typeof v === 'number') {
            metrics[key] = v;
          }
        }
      }

      const output: ToolOutput = {
        sections: [{ type: 'text', label: 'Result', content: JSON.stringify(result, null, 2), mono: true }],
      };

      return {
        outputFiles,
        output,
        metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
      };
    },
  };
}
