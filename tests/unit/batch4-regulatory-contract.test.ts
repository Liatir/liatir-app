/**
 * Contract tests for the regulatory genomics models.
 *
 * They keep the registry and the artifact specs in agreement — above all on the context window, which is the
 * number of base pairs a model consumes at once. Get it wrong and nothing crashes: the model is simply fed the
 * wrong span of sequence and returns predictions that are quietly meaningless, which for a scientific tool is the
 * worst possible failure.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LiatirAIModelRecord } from '@liatir/core';
import {
  BASENJI2_REGULATORY_MODEL_ID,
  BORZOI_K562_RNA_MODEL_ID,
  ENFORMER_REGULATORY_MODEL_ID,
  getLocalAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';
import { requireRegulatoryArtifactForModel } from '../../frontend/src/lib/ai/model-artifacts';
import { REGULATORY_PREDICTION_SCRIPT } from '../../frontend/src/lib/tools/ai/python-scripts/regulatory-prediction';
import { installSvelteRuneStubs } from './support/svelte-runes';

const rootDir = resolve(import.meta.dirname, '../..');
const pythonEnvPath = resolve(rootDir, 'src-tauri/src/bridge/python_env.rs');

const REGULATORY_MODEL_IDS = [
  ENFORMER_REGULATORY_MODEL_ID,
  BASENJI2_REGULATORY_MODEL_ID,
  BORZOI_K562_RNA_MODEL_ID,
] as const;

installSvelteRuneStubs();

function installedModel(id: string): LiatirAIModelRecord {
  const metadata = getLocalAIModelMetadata(id);
  if (!metadata) throw new Error(`Missing test model metadata: ${id}`);
  return {
    ...metadata,
    status: 'installed',
    enabled: true,
    runtimePath: `/tmp/liatir-test/${id}/runtime`,
    cachePath: `/tmp/liatir-test/${id}/cache`,
  };
}

describe('Batch 4 regulatory model contracts', () => {
  it('keeps regulatory model artifacts synchronized with registry context windows', () => {
    const expectedWindows = new Map<string, number>([
      [ENFORMER_REGULATORY_MODEL_ID, 393_216],
      [BASENJI2_REGULATORY_MODEL_ID, 131_072],
      [BORZOI_K562_RNA_MODEL_ID, 393_216],
    ]);

    for (const id of REGULATORY_MODEL_IDS) {
      const model = installedModel(id);
      const artifact = requireRegulatoryArtifactForModel(model);

      expect(model.contextWindow, `${id} registry contextWindow drifted`).toBe(expectedWindows.get(id));
      expect(artifact.contextWindow, `${id} artifact contextWindow drifted`).toBe(expectedWindows.get(id));
      expect(model.contextWindow, `${id} registry/artifact contextWindow mismatch`).toBe(artifact.contextWindow);
    }
  });

  it('keeps heavy regulatory models in isolated runtime boxes', () => {
    const runtimeIds = new Set<string>();
    const cacheDirs = new Set<string>();

    for (const id of REGULATORY_MODEL_IDS) {
      const model = installedModel(id);
      const packages = model.install?.runtimePackages ?? [];
      const packageNames = new Set(packages.map((pkg) => pkg.package));

      expect(model.install?.method, `${id} should be managed by Liatir`).toBe('managed-runtime');
      expect(model.install?.runtimeId, `${id} missing runtime box`).toMatch(/^regulatory-/);
      expect(model.install?.modelCacheSubdir, `${id} missing model cache box`).toMatch(/^model-cache\//);
      expect(model.install?.hostRequirements?.python?.minVersion, `${id} missing Python floor`).toBe('3.10');
      expect(packageNames.has('tensorflow'), `${id} missing TensorFlow runtime package`).toBe(true);
      expect(packageNames.has('urllib3'), `${id} missing urllib3 runtime package`).toBe(true);

      runtimeIds.add(model.install?.runtimeId ?? '');
      cacheDirs.add(model.install?.modelCacheSubdir ?? '');
    }

    expect(runtimeIds.size, 'regulatory model runtimes should remain isolated by model family').toBe(REGULATORY_MODEL_IDS.length);
    expect(cacheDirs.size, 'regulatory model caches should remain isolated by model family').toBe(REGULATORY_MODEL_IDS.length);
  });

  it('exposes VCF.GZ and BED-producing outputs in the AI Tool contract', async () => {
    const { regulatoryPredictionDefinition } = await import('../../frontend/src/lib/tools/ai/regulatory-prediction');

    expect(regulatoryPredictionDefinition.supportedModelIds).toEqual([...REGULATORY_MODEL_IDS]);
    expect(regulatoryPredictionDefinition.inputSchema.variantFile.accept).toContain('vcf.gz');
    expect(regulatoryPredictionDefinition.outputSchema.signalBed.ext).toContain('bed');
    expect(regulatoryPredictionDefinition.outputSchema.variantScoresBed.ext).toContain('bed');
    expect(regulatoryPredictionDefinition.outputSchema.provenance.type).toBe('json');
  });

  it('finalizes regulatory prediction output into artifacts, metrics, provenance, and a genome viewer', async () => {
    const {
      finalizeRegulatoryPredictionResult,
      regulatoryPredictionDefinition,
    } = await import('../../frontend/src/lib/tools/ai/regulatory-prediction');
    const model = installedModel(BORZOI_K562_RNA_MODEL_ID);
    const logs: string[] = [];
    const stdout = JSON.stringify({
      signalCsvPath: '/tmp/liatir-test/regulatory-prediction-signal.csv',
      signalBedPath: '/tmp/liatir-test/regulatory-prediction-signal.bed',
      variantCsvPath: '/tmp/liatir-test/regulatory-variant-scores.csv',
      variantBedPath: '/tmp/liatir-test/regulatory-variant-scores.bed',
      summaryPath: '/tmp/liatir-test/regulatory-prediction-summary.json',
      summary: {
        backend: 'borzoi-mini',
        modelSource: 'model0_best.h5',
        referenceName: 'chr1',
        referenceLength: 500,
        windowStart: 1,
        contextWindow: 393216,
        outputHead: 'human',
        targetIndex: 0,
        binCount: 2,
        meanSignal: 0.25,
        maxSignal: 0.4,
        variantCount: 1,
        topVariant: {
          variantId: 'chr1:4:A>T',
          chrom: 'chr1',
          pos: 4,
          ref: 'A',
          alt: 'T',
          meanDelta: 0.125,
          maxAbsDelta: 0.2,
          refMatch: true,
        },
        warnings: ['Reference sequence is shorter than the model context window.'],
      },
      signalPreview: [
        { binIndex: 0, chrom: 'chr1', start: 0, end: 250, value: 0.1 },
        { binIndex: 1, chrom: 'chr1', start: 250, end: 500, value: 0.4 },
      ],
      variantPreview: [
        {
          variantId: 'chr1:4:A>T',
          chrom: 'chr1',
          pos: 4,
          ref: 'A',
          alt: 'T',
          meanDelta: 0.125,
          maxAbsDelta: 0.2,
          refMatch: true,
        },
      ],
    });

    const result = await finalizeRegulatoryPredictionResult(
      model,
      {
        referenceFile: '/tmp/liatir-test/demo.fa',
        sequence: '',
        variantFile: '/tmp/liatir-test/demo.vcf.gz',
        referenceName: 'chr1',
        windowStart: '1',
      },
      { ok: true, stdout, stderr: '', exitCode: 0, durationMs: 42 },
      (line) => logs.push(line),
    );

    expect(logs).toEqual([]);
    expect(result.outputFiles.map((file) => file.fieldKey)).toEqual([
      'signalCsv',
      'signalBed',
      'summaryJson',
      'variantScoresCsv',
      'variantScoresBed',
    ]);
    expect(result.metrics).toMatchObject({ binCount: 2, variantCount: 1, topScore: 0.125, warningCount: 1 });
    expect(result.values.provenance).toMatchObject({
      modelId: BORZOI_K562_RNA_MODEL_ID,
      toolId: regulatoryPredictionDefinition.id,
      parameters: {
        backend: 'borzoi-mini',
        contextWindow: 393216,
      },
    });

    const genomeViewer = result.output.sections.find((section) => section.type === 'genome-viewer');
    expect(genomeViewer).toMatchObject({
      type: 'genome-viewer',
      assembly: { refName: 'chr1' },
      tracks: [
        { name: 'Regulatory signal', kind: 'bed' },
        { name: 'Variant regulatory delta', kind: 'bed' },
      ],
    });
  });

  it('keeps the Python regulatory runner compatible with compressed VCF and dynamic model input lengths', () => {
    expect(REGULATORY_PREDICTION_SCRIPT).toContain('import gzip');
    expect(REGULATORY_PREDICTION_SCRIPT).toContain('gzip.open(path, "rt"');
    expect(REGULATORY_PREDICTION_SCRIPT).toContain('def model_input_length(model):');
    expect(REGULATORY_PREDICTION_SCRIPT).toContain('requestedContextWindow');
  });

  it('keeps Python runtime bootstrap packages needed by TensorFlow model boxes', () => {
    const runtimeSource = readFileSync(pythonEnvPath, 'utf8');

    expect(runtimeSource).toContain('"setuptools>=68,<81"');
    expect(runtimeSource).toContain('"wheel>=0.41,<1"');
    expect(runtimeSource).toContain('"packaging>=23,<26"');
  });
});
