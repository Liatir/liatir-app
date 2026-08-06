import type { LiatirPlugin, PluginInputFieldDef, PluginOutputFieldDef } from '$lib/stores/lia-plugins.svelte';
import type {
  InputFieldSchema,
  OutputFieldSchema,
  PipelineStepDefinition,
  PipelineRegistryEntry,
} from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { runLiatirPlugin } from '$lib/utils/plugin-run';
import { savePluginResultFiles } from '$lib/utils/plugin-files';
import type { JsonValue } from '@liatir/core';

export const LIA_PLUGIN_STEP_PREFIX = 'plugin:';
export const LEGACY_LIA_PLUGIN_STEP_PREFIX = 'module:';

/** Pipeline step id for an imported .lia plugin. */
export function pluginStepId(pluginId: string): string {
  return `${LIA_PLUGIN_STEP_PREFIX}${pluginId}`;
}

/** A .lia plugin's input schema is already InputFieldSchema-shaped. */
function mapInputs(schema: Record<string, PluginInputFieldDef>): Record<string, InputFieldSchema> {
  const out: Record<string, InputFieldSchema> = {};
  for (const [k, f] of Object.entries(schema)) {
    out[k] = { type: f.type, label: f.label, required: f.required, default: f.default, accept: f.accept };
  }
  return out;
}

/** Map a .lia plugin output field to a pipeline OutputFieldSchema. */
function mapOutputs(schema: Record<string, PluginOutputFieldDef>): Record<string, OutputFieldSchema> {
  const out: Record<string, OutputFieldSchema> = {};
  for (const [k, f] of Object.entries(schema)) {
    const type: OutputFieldSchema['type'] =
      f.type === 'file' || f.type === 'number' || f.type === 'json' || f.type === 'stats'
        ? f.type
        : 'string';
    out[k] = { type, label: f.label, ext: f.ext ?? f.accept, description: f.description, format: f.format };
  }
  return out;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

/** Build the pipeline step definition (form + handles) for an imported .lia plugin. */
export function pluginToDefinition(plugin: LiatirPlugin): PipelineStepDefinition {
  const isWasm = plugin.runtime === 'wasm';
  const runtimeLabel = plugin.runtime === 'python' ? 'Python plugin' : isWasm ? 'WASM custom tool (sandboxed)' : 'Liatir plugin';
  return {
    id: pluginStepId(plugin.id),
    type: isWasm ? 'wasm-plugin' : 'lia-plugin',
    label: plugin.name,
    description: plugin.description || runtimeLabel,
    category: isWasm ? 'Custom Tools' : 'Plugins',
    inputSchema: mapInputs(plugin.inputSchema),
    outputSchema: mapOutputs(plugin.outputSchema),
  };
}

/**
 * Full pipeline registry entry for a .lia plugin: its definition plus a `run` that
 * executes it (Node or WASM) via the shared runner and maps the result back to
 * the pipeline's StepResult — file outputs become RunOutputFiles (for chaining),
 * numeric outputs become connectable metrics.
 */
export function pluginToRegistryEntry(plugin: LiatirPlugin): PipelineRegistryEntry {
  return {
    definition: pluginToDefinition(plugin),
    run: async (inputs, _outputDir, onLog) => {
      const out = await runLiatirPlugin(plugin, inputs, (_stream, line) => onLog(line));
      if (out.exitCode !== 0) {
        throw new Error(out.stderr.join('\n') || `Plugin "${plugin.name}" exited with code ${out.exitCode}`);
      }

      const result = out.result;
      const metrics: Record<string, number> = {};
      const values: Record<string, JsonValue> = {};
      const outputFiles = await savePluginResultFiles(plugin.name, plugin.outputSchema, result, crypto.randomUUID());

      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        for (const [key, field] of Object.entries(plugin.outputSchema)) {
          const v = obj[key];
          if (field.type === 'number' && typeof v === 'number') {
            metrics[key] = v;
            values[key] = v;
          } else if (field.type !== 'file' && isJsonValue(v)) {
            values[key] = v;
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
        values: Object.keys(values).length > 0 ? values : undefined,
      };
    },
  };
}
