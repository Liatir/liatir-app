import type { JsonValue } from '@liatir/core';
import type { PipelineStepDefinition } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { MOCK_AI_MODEL_ID } from '$lib/ai/model-registry';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';

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
      default: MOCK_AI_MODEL_ID,
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

function makeResponse(prompt: string, context: string): string {
  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
  const normalizedContext = context.replace(/\s+/g, ' ').trim();
  const contextSuffix = normalizedContext ? ` Context chars: ${normalizedContext.length}.` : '';
  return `Mock AI response: ${normalizedPrompt || 'No prompt provided.'}${contextSuffix}`;
}

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

  const modelId = inputs.modelId?.trim() || aiModelsStore.defaultModelId || MOCK_AI_MODEL_ID;
  const model = aiModelsStore.byId(modelId);
  if (!model) throw new Error(`Unknown AI Model: ${modelId}`);
  if (model.enabled === false || (model.status !== 'installed' && model.status !== 'available')) {
    throw new Error(`AI Model is not runnable: ${model.name}`);
  }

  const prompt = inputs.prompt?.trim() || '';
  if (!prompt) throw new Error('Prompt is required.');

  const context = inputs.context?.trim() || '';
  const response = makeResponse(prompt, context);
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
