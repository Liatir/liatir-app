/**
 * A fake AI Tool that exercises the whole AI plumbing without loading any model weights.
 *
 * Everything around an AI run — model selection, logs, structured output, provenance, how the result
 * lands in Results, how it behaves as a pipeline node — is the same regardless of which model runs.
 * This tool lets all of that be developed and tested in milliseconds, instead of waiting minutes for
 * a multi-gigabyte model to load just to check that a log line appears in the right place.
 *
 * It is not a fallback and never stands in for a real model: it is only ever visible inside the dev
 * sandbox (see `MOCK_AI_MODEL_ID` in the models store), and every result it produces is stamped
 * `mock: true` so it can never be mistaken for genuine scientific output.
 */
import type { JsonValue } from '@liatir/core';
import type { PipelineStepDefinition } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';

/** The same definition shape a real AI Tool uses — that is the point. */
export const mockAIInferenceDefinition: PipelineStepDefinition = {
  id: 'ai-mock-inference',
  type: 'ai-tool',
  label: 'Mock AI Inference',
  description: 'Validate AI Tool model selection, logs, outputs, and provenance without loading model weights.',
  category: 'AI Tools',
  inputSchema: {
    modelId: {
      type: 'string',
      label: 'AI Model',
      required: true,
    },
    prompt: {
      type: 'string',
      label: 'Prompt',
      required: true,
      default: 'Summarize the upstream result.',
    },
    context: {
      type: 'string',
      label: 'Context',
      required: false,
    },
  },
  outputSchema: {
    response: { type: 'string', label: 'Response' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

/**
 * Deterministic response, derived only from the inputs. Not random, so a test can assert on it — and
 * the "Mock AI response" prefix means the output is never mistakable for a real model's answer.
 */
function makeResponse(prompt: string, context: string): string {
  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
  const normalizedContext = context.replace(/\s+/g, ' ').trim();
  const contextSuffix = normalizedContext ? ` Context chars: ${normalizedContext.length}.` : '';
  return `Mock AI response: ${normalizedPrompt || 'No prompt provided.'}${contextSuffix}`;
}

/**
 * Runs the mock step.
 *
 * The validation below is the substance of this tool: it applies the *same* checks a real AI Tool
 * does — the model must exist, be enabled, and be in a runnable state — so a bug in that logic is
 * caught here rather than after a long model load.
 */
export async function runMockAIInferenceStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (line: string) => void
): Promise<{
  outputFiles: [];
  output: ToolOutput;
  values: Record<string, JsonValue>;
}> {
  await aiModelsStore.init();

  const modelId = inputs.modelId?.trim();
  if (!modelId) throw new Error('AI Model is required.');
  const model = aiModelsStore.byId(modelId);
  if (!model) throw new Error(`Unknown AI Model: ${modelId}`);
  // Deliberately accepts `available` as well as `installed`: this tool never loads weights, so it can
  // validate the selection flow even for a model the user has not installed.
  if (model.enabled === false || (model.status !== 'installed' && model.status !== 'available')) {
    throw new Error(`AI Model is not runnable: ${model.name}`);
  }

  const prompt = inputs.prompt?.trim() || '';
  if (!prompt) throw new Error('Prompt is required.');

  const context = inputs.context?.trim() || '';
  const response = makeResponse(prompt, context);
  // Full provenance, exactly as a real AI Tool records it — so the provenance path itself is what is
  // being exercised. `mock: true` is the one field a real run never carries.
  const provenance: Record<string, JsonValue> = {
    toolId: mockAIInferenceDefinition.id,
    toolLabel: mockAIInferenceDefinition.label,
    modelId: model.id,
    modelName: model.name,
    modelVersion: model.version ?? null,
    runtimeKind: model.runtime.kind,
    runtimeName: model.runtime.name,
    localOnly: model.localOnly,
    mock: true,
    inputChars: prompt.length + context.length,
    generatedAt: new Date().toISOString(),
  };

  onLog(`ai-tool ${mockAIInferenceDefinition.id}`);
  onLog(`model ${model.id} (${model.runtime.kind})`);
  onLog('mock runtime completed without loading model weights');

  return {
    outputFiles: [],
    output: {
      sections: [
        { type: 'text', label: 'Response', content: response, mono: false },
        {
          type: 'table',
          label: 'Provenance',
          headers: ['Field', 'Value'],
          rows: [
            ['AI Model', model.name],
            ['Model ID', model.id],
            ['Runtime', `${model.runtime.name} (${model.runtime.kind})`],
            ['Local only', model.localOnly ? 'yes' : 'no'],
            ['Mock run', 'yes'],
          ],
        },
      ],
    },
    values: { response, provenance },
  };
}
