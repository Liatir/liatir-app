import type {
  LiatirAIModelRecord,
  LiatirAIToolDefinition,
  LiatirFieldOption,
  LiatirStepDefinition,
} from '@liatir/core';

function asAITool(definition: LiatirStepDefinition | null | undefined): LiatirAIToolDefinition | null {
  return definition?.type === 'ai-tool'
    ? definition as LiatirAIToolDefinition
    : null;
}

/** Keep the pipeline editor and external execution contracts on the same model compatibility rule. */
export function compatibleRunnableAIModels(
  definition: LiatirStepDefinition | null | undefined,
  runnableModels: LiatirAIModelRecord[],
): LiatirAIModelRecord[] {
  const aiTool = asAITool(definition);
  if (!aiTool) return [];
  const supportedModelIds = aiTool.supportedModelIds ?? [];
  const supportedCapabilities = aiTool.supportedCapabilities ?? [];
  return runnableModels.filter((model) => {
    if (supportedModelIds.length > 0) return supportedModelIds.includes(model.id);
    return supportedCapabilities.length === 0 || supportedCapabilities.some(
      (capability) => model.capabilities.includes(capability),
    );
  });
}

/** Return null for ordinary fields and a possibly-empty closed option list for an AI Model input. */
export function aiModelInputOptions(
  definition: LiatirStepDefinition | null | undefined,
  fieldKey: string,
  runnableModels: LiatirAIModelRecord[],
): LiatirFieldOption[] | null {
  const aiTool = asAITool(definition);
  if (!aiTool?.modelInputKey || fieldKey !== aiTool.modelInputKey) return null;
  return compatibleRunnableAIModels(aiTool, runnableModels).map((model) => ({
    value: model.id,
    label: model.name,
    description: [
      model.version ? `Version ${model.version}` : null,
      model.runtime.name,
      model.modalities.join(', '),
    ].filter(Boolean).join(' · '),
  }));
}
