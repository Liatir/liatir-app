import type { JsonValue, LiatirAIProvenance, LiatirAIToolDefinition } from '@liatir/core';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { CELLTYPIST_MODEL_ID } from '$lib/ai/model-registry';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { CELLTYPIST_ANNOTATE_SCRIPT } from './python-scripts';
import { liatir } from '$lib/api';

export const celltypistAnnotateDefinition: LiatirAIToolDefinition = {
  id: 'ai-celltypist-annotate',
  type: 'ai-tool',
  label: 'CellTypist Annotation',
  description: 'Annotate single-cell h5ad/AnnData inputs with a managed local CellTypist runtime.',
  category: 'AI Tools',
  inputSchema: {
    modelId: {
      type: 'string',
      label: 'AI Model',
      required: true,
    },
    inputFile: {
      type: 'file',
      label: 'AnnData file',
      required: true,
      accept: ['h5ad'],
    },
    celltypistModel: {
      type: 'string',
      label: 'CellTypist model',
      required: true,
      default: 'Immune_All_Low.pkl',
    },
    majorityVoting: {
      type: 'boolean',
      label: 'Majority voting',
      required: false,
      default: false,
    },
  },
  outputSchema: {
    labelsCsv: { type: 'file', label: 'Cell labels', ext: ['csv'] },
    summaryJson: { type: 'file', label: 'Annotation summary', ext: ['json'] },
    cellCount: { type: 'number', label: 'Cells', format: 'integer' },
    labelCount: { type: 'number', label: 'Labels', format: 'integer' },
    topLabelFraction: { type: 'number', label: 'Top label fraction', format: 'percent' },
    provenance: { type: 'json', label: 'Provenance' },
  },
  modelInputKey: 'modelId',
  supportedCapabilities: ['cell-annotation', 'classification'],
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function parsePythonJson<T>(stdout: string): T {
  const text = stdout.trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].startsWith('{')) continue;
      try {
        return JSON.parse(lines[i]) as T;
      } catch {
        // Keep scanning for the final JSON payload.
      }
    }
  }
  throw new Error('CellTypist did not return JSON output.');
}

async function fileArtifact(label: string, path: string, ext: string, fieldKey: string): Promise<RunOutputFile> {
  let size: number | undefined;
  const api = liatir();
  if (api) {
    try { size = await api.invoke('lia_file_size', { path }) as number; } catch { /* ok */ }
  }
  return { label, path, ext, size, fieldKey };
}

export async function runCelltypistAnnotateStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
): Promise<{
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
}> {
  await aiModelsStore.init();
  const modelId = inputs.modelId?.trim();
  if (!modelId) throw new Error('AI Model is required.');
  const model = aiModelsStore.byId(modelId);
  if (!model) throw new Error(`Unknown AI Model: ${modelId}`);
  if (model.id !== CELLTYPIST_MODEL_ID) throw new Error('CellTypist Annotation requires the CellTypist AI Model.');
  if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
  if (!inputs.inputFile) throw new Error('AnnData file is required.');

  const cachePath = cachePathForModel(model);
  onLog(`ai-tool ${celltypistAnnotateDefinition.id}`);
  onLog(`model ${model.id} (${model.runtime.kind})`);
  onLog(`input ${basename(inputs.inputFile)}`);

  const result = await runAIPython(
    model,
    CELLTYPIST_ANNOTATE_SCRIPT,
    {
      inputFile: inputs.inputFile,
      outputDir,
      runtimePath: model.runtimePath ?? model.localPath ?? null,
      modelCacheDir: cachePath,
      celltypistModel: inputs.celltypistModel || 'Immune_All_Low.pkl',
      majorityVoting: inputs.majorityVoting === 'true',
    },
    { timeoutSeconds: 7200 },
  );

  if (!result.ok) {
    throw new Error(result.stderr || `CellTypist exited with code ${result.exitCode}`);
  }
  if (result.stderr.trim()) onLog(result.stderr.trim());

  const parsed = parsePythonJson<{
    labelsPath: string;
    summaryPath: string;
    summary: {
      cellCount: number;
      labelCount: number;
      labelColumn: string;
      topLabel: string | null;
      topCount: number;
      topFraction: number;
      counts: Record<string, number>;
      model: string;
      majorityVoting: boolean;
      preprocessing: string;
    };
  }>(result.stdout);

  const provenance: LiatirAIProvenance = {
    toolId: celltypistAnnotateDefinition.id,
    toolLabel: celltypistAnnotateDefinition.label,
    modelId: model.id,
    modelName: model.name,
    modelVersion: model.version ?? null,
    runtimeKind: model.runtime.kind,
    runtimeName: model.runtime.name,
    runtimeVersion: model.runtime.version ?? null,
    localOnly: model.localOnly,
    inputSummary: {
      inputFile: basename(inputs.inputFile),
      celltypistModel: parsed.summary.model,
      majorityVoting: parsed.summary.majorityVoting,
      preprocessing: parsed.summary.preprocessing,
    },
    generatedAt: new Date().toISOString(),
  };

  const outputFiles = [
    await fileArtifact('CellTypist labels', parsed.labelsPath, 'csv', 'labelsCsv'),
    await fileArtifact('CellTypist summary', parsed.summaryPath, 'json', 'summaryJson'),
  ];

  return {
    outputFiles,
    output: {
      sections: [
        {
          type: 'stats',
          cols: 3,
          items: [
            { label: 'Cells', value: parsed.summary.cellCount },
            { label: 'Labels', value: parsed.summary.labelCount },
            { label: 'Top label', value: parsed.summary.topLabel ?? 'None' },
          ],
        },
        {
          type: 'table',
          label: 'Top labels',
          headers: ['Label', 'Cells'],
          rows: Object.entries(parsed.summary.counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20),
        },
        {
          type: 'single-cell-viewer',
          label: 'Cell label distribution',
          description: 'Lightweight preview. Full Vitessce rendering is handled by a modular viewer runtime.',
          config: {
            title: 'CellTypist labels',
            source: parsed.labelsPath,
            labelCounts: parsed.summary.counts,
          },
          height: 340,
        },
        {
          type: 'table',
          label: 'Provenance',
          headers: ['Field', 'Value'],
          rows: [
            ['AI Model', model.name],
            ['Runtime', `${model.runtime.name} (${model.runtime.kind})`],
            ['CellTypist model', parsed.summary.model],
            ['Preprocessing', parsed.summary.preprocessing],
            ['Input', basename(inputs.inputFile)],
          ],
        },
      ],
    },
    metrics: {
      cellCount: parsed.summary.cellCount,
      labelCount: parsed.summary.labelCount,
      topLabelFraction: parsed.summary.topFraction,
    },
    values: {
      cellCount: parsed.summary.cellCount,
      labelCount: parsed.summary.labelCount,
      topLabelFraction: parsed.summary.topFraction,
      provenance: provenance as unknown as JsonValue,
    },
  };
}
