/**
 * Contract tests for the single-cell foundation models.
 *
 * They enforce that a model still being validated stays a *preview*: visible in the catalogue, honestly labelled,
 * and not installable. A model that has not been checked end to end must not be reachable by a user who would take
 * its output as scientific fact — so "cannot be installed before its runtime box is validated" is asserted rather
 * than left to discipline.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GENEFORMER_V1_10M_MODEL_ID,
  SCFOUNDATION_100M_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  getLocalAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';
import { artifactSpecForModelId } from '../../frontend/src/lib/ai/model-artifacts';
import { installSvelteRuneStubs } from './support/svelte-runes';

const rootDir = resolve(import.meta.dirname, '../..');

const DEFERRED_BATCH5_MODEL_IDS = [SCFOUNDATION_100M_MODEL_ID];
const publishedMacosArm64MetalTargets = (minRamGb: number) => [{
  target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
  hostEnvironments: ['native'],
  minRamGb,
}];
const publishedGeneformerTargets = () => [
  ...publishedMacosArm64MetalTargets(8),
  {
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    hostEnvironments: ['native'],
    minRamGb: 8,
  },
  {
    target: {
      platform: 'linux',
      arch: 'x86_64',
      accelerator: 'cuda',
      cudaVersion: '12.4',
    },
    hostEnvironments: ['native'],
    minRamGb: 8,
    minNvidiaDriverVersion: '550.54.14',
  },
];

installSvelteRuneStubs();

describe('Batch 5 single-cell foundation model contract', () => {
  it('keeps deferred Batch 5 candidates as preview models with explicit capabilities', () => {
    for (const id of DEFERRED_BATCH5_MODEL_IDS) {
      const model = getLocalAIModelMetadata(id);

      expect(model, `${id} missing model metadata`).toBeTruthy();
      expect(model?.category).toBe('Single-cell Foundation Models');
      expect(model?.releaseStage).toBe('preview');
      expect(model?.modalities).toContain('single-cell');
      expect(model?.capabilities).toContain('single-cell-embedding');
      expect(model?.documentation?.officialUrl, `${id} missing official source`).toMatch(/^https:\/\//);
      expect(model?.license?.verifiedAt, `${id} missing license verification date`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  it('uses the live signed Runtime Box distribution for Geneformer', () => {
    const model = getLocalAIModelMetadata(GENEFORMER_V1_10M_MODEL_ID);
    const spec = artifactSpecForModelId(GENEFORMER_V1_10M_MODEL_ID);
    const recipe = JSON.parse(readFileSync(
      resolve(rootDir, 'runtime-boxes/recipes/geneformer-v1-10m-macos-arm64-metal/recipe.json'),
      'utf8',
    )) as {
      modelId: string;
      runtimeId: string;
      assets: Array<{ relativePath: string; sizeBytes: number; sha256: string; url: string }>;
    };

    expect(model, 'Geneformer missing model metadata').toBeTruthy();
    expect(model?.releaseStage).toBeUndefined();
    expect(model?.capabilities).toEqual(['single-cell-embedding']);
    expect(model?.license?.spdxId).toBe('Apache-2.0');
    expect(model?.license?.verifiedAt).toBe('2026-07-11');
    expect(model?.source).toBe('runtime-box');
    expect(model?.install?.method).toBe('runtime-box');
    expect(model?.install?.runtimeId).toBe('single-cell-foundation-geneformer-v1-10m');
    expect(model?.install?.modelCacheSubdir).toBe('model-cache/geneformer-v1-10m');
    expect(model?.install?.runtimeBox).toEqual({
      boxId: 'geneformer-v1-10m',
      channel: 'beta',
      registryBaseUrl: 'https://models.liatir.com/v1',
      publishedTargets: publishedGeneformerTargets(),
    });
    expect(model?.install?.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(model?.install?.files).toBeUndefined();
    expect(recipe.modelId).toBe(GENEFORMER_V1_10M_MODEL_ID);
    expect(recipe.runtimeId).toBe(model?.install?.runtimeId);
    expect(recipe.assets.map((file) => file.relativePath).sort()).toEqual([
      'model-cache/geneformer-v1-10m/dictionaries/ensembl_mapping_dict_gc30M.pkl',
      'model-cache/geneformer-v1-10m/dictionaries/gene_median_dictionary_gc30M.pkl',
      'model-cache/geneformer-v1-10m/dictionaries/token_dictionary_gc30M.pkl',
      'model-cache/geneformer-v1-10m/model/config.json',
      'model-cache/geneformer-v1-10m/model/model.safetensors',
    ]);
    for (const file of recipe.assets) {
      expect(file.sizeBytes, `${file.relativePath} missing byte size`).toBeGreaterThan(0);
      expect(file.sha256, `${file.relativePath} missing SHA-256`).toMatch(/^[a-f0-9]{64}$/);
      expect(file.url).toContain(model?.install?.revision);
    }
    expect(model?.install?.hostRequirements).toMatchObject({
      os: ['macos', 'linux'],
      arch: ['aarch64', 'x86_64'],
    });
    expect(model?.install?.hostRequirements?.python).toBeUndefined();
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-geneformer');
    expect(spec?.preloadKind).toBe('managed-files');
    expect(spec?.modelFile).toBe('model/model.safetensors');
  });

  it('uses the live signed Runtime Box distribution for scGPT', () => {
    const model = getLocalAIModelMetadata(SCGPT_WHOLE_HUMAN_MODEL_ID);
    const spec = artifactSpecForModelId(SCGPT_WHOLE_HUMAN_MODEL_ID);
    const recipe = JSON.parse(readFileSync(
      resolve(rootDir, 'runtime-boxes/recipes/scgpt-whole-human-macos-arm64-metal/recipe.json'),
      'utf8',
    )) as {
      modelId: string;
      runtimeId: string;
      sourceRevision: string;
      assets: Array<{ relativePath: string; sizeBytes: number; sha256: string }>;
    };

    expect(model, 'scGPT missing model metadata').toBeTruthy();
    expect(model?.releaseStage).toBeUndefined();
    expect(model?.source).toBe('runtime-box');
    expect(model?.install?.method).toBe('runtime-box');
    expect(model?.install?.runtimeId).toBe('single-cell-foundation-scgpt-whole-human');
    expect(model?.install?.modelCacheSubdir).toBe('model-cache/scgpt-whole-human');
    expect(model?.install?.runtimeBox).toEqual({
      boxId: 'scgpt-whole-human',
      channel: 'beta',
      registryBaseUrl: 'https://models.liatir.com/v1',
      publishedTargets: publishedMacosArm64MetalTargets(16),
    });
    expect(recipe.modelId).toBe(SCGPT_WHOLE_HUMAN_MODEL_ID);
    expect(recipe.runtimeId).toBe(model?.install?.runtimeId);
    expect(recipe.sourceRevision).toBe(model?.install?.revision);
    expect(recipe.assets.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      'model-cache/scgpt-whole-human/args.json',
      'model-cache/scgpt-whole-human/best_model.pt',
      'model-cache/scgpt-whole-human/vocab.json',
    ]));
    for (const file of recipe.assets) {
      expect(file.sizeBytes, `${file.relativePath} missing byte size`).toBeGreaterThan(0);
      expect(file.sha256, `${file.relativePath} missing SHA-256`).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(model?.install?.hostRequirements).toMatchObject({
      os: ['macos'],
      arch: ['aarch64'],
    });
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-scgpt');
    expect(spec?.preloadKind).toBe('managed-files');
    expect(spec?.modelFile).toBe('best_model.pt');
  });

  it('keeps deferred models paired with isolated future runtime families without enabling preload', () => {
    const runtimeFamilies = new Set<string>();

    for (const id of DEFERRED_BATCH5_MODEL_IDS) {
      const model = getLocalAIModelMetadata(id);
      const spec = artifactSpecForModelId(id);

      expect(model?.install, `${id} must not be installable before its runtime box is validated`).toBeUndefined();
      expect(spec, `${id} missing artifact spec`).toBeTruthy();
      expect(spec?.preloadKind).toBe('none');
      expect(spec?.runtimeFamily.startsWith('single-cell-foundation-')).toBe(true);
      expect(runtimeFamilies.has(spec?.runtimeFamily ?? ''), `${id} shares a runtime family unexpectedly`).toBe(false);
      runtimeFamilies.add(spec?.runtimeFamily ?? '');
    }
  });

  it('uses one signed Runtime Box installation path for UCE', () => {
    const model = getLocalAIModelMetadata(UCE_4LAYER_MODEL_ID);
    const spec = artifactSpecForModelId(UCE_4LAYER_MODEL_ID);
    const recipe = JSON.parse(readFileSync(
      resolve(rootDir, 'runtime-boxes/recipes/uce-4layer-macos-arm64-metal/recipe.json'),
      'utf8',
    )) as {
      boxId: string;
      modelId: string;
      runtimeId: string;
      sourceRevision: string;
      pythonVersion: string;
      uvVersion: string;
      assets: Array<{ relativePath: string; sizeBytes: number; sha256: string }>;
      assetArchives: Array<{ relativePath: string; format: string; destination: string }>;
      localFiles: Array<{ relativePath: string; sha256: string }>;
      selfTest: { files: string[]; pythonCode: string };
    };

    expect(model, 'UCE missing model metadata').toBeTruthy();
    expect(model?.category).toBe('Single-cell Foundation Models');
    expect(model?.releaseStage).toBeUndefined();
    expect(model?.source).toBe('runtime-box');
    expect(model?.install?.method).toBe('runtime-box');
    expect(model?.install?.runtimeId).toBe('single-cell-foundation-uce');
    expect(model?.install?.modelCacheSubdir).toBe('model-cache/uce');
    expect(model?.install?.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(model?.install?.runtimeBox).toEqual({
      boxId: 'uce-4layer',
      channel: 'beta',
      registryBaseUrl: 'https://models.liatir.com/v1',
      publishedTargets: publishedMacosArm64MetalTargets(16),
    });
    expect(model?.install?.files).toBeUndefined();
    expect(model?.install?.runtimeSources).toBeUndefined();
    expect(model?.install?.hostRequirements).toMatchObject({
      os: ['macos'],
      arch: ['aarch64'],
    });
    expect(model?.install?.hostRequirements?.python).toBeUndefined();
    expect(model?.diskSizeBytes).toBe(10_142_871_337);
    expect(model?.license?.components?.map((component) => component.spdxId)).toEqual([
      'MIT',
      'CC-BY-4.0',
    ]);
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-uce');
    expect(spec?.preloadKind).toBe('managed-files');
    expect(spec?.modelFile).toBe('model_files/4layer_model.torch');
    expect(existsSync(resolve(rootDir, 'frontend/src/lib/ai/preloaders/uce-managed-files.ts'))).toBe(false);
    expect(recipe).toMatchObject({
      boxId: 'uce-4layer',
      modelId: UCE_4LAYER_MODEL_ID,
      runtimeId: 'single-cell-foundation-uce',
      sourceRevision: model?.install?.revision,
      pythonVersion: '3.11.9',
      uvVersion: '0.11.28',
    });
    expect(recipe.assets.map((asset) => asset.relativePath)).toEqual(expect.arrayContaining([
      '.sources/uce-source.zip',
      'model-cache/uce/model_files/4layer_model.torch',
      'model-cache/uce/model_files/all_tokens.torch',
      'model-cache/uce/model_files/protein_embeddings.tar.gz',
      'model-cache/uce/model_files/species_chrom.csv',
      'model-cache/uce/model_files/species_offsets.pkl',
    ]));
    for (const asset of recipe.assets) {
      expect(asset.sizeBytes, `${asset.relativePath} missing byte size`).toBeGreaterThan(0);
      expect(asset.sha256, `${asset.relativePath} missing SHA-256`).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(recipe.assetArchives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relativePath: 'model-cache/uce/model_files/protein_embeddings.tar.gz',
        format: 'tar.gz',
        destination: 'model-cache/uce/model_files',
      }),
    ]));
    expect(recipe.localFiles).toContainEqual(expect.objectContaining({
      relativePath: 'THIRD_PARTY_NOTICES/UCE-4LAYER.md',
      sha256: '821f57cc6e42d5a896d7e4391bd6d6a54fa263aaa1fc6735bfe70f92ae1fc390',
    }));
    expect(recipe.selfTest.files.filter((file) => file.includes('/protein_embeddings/'))).toHaveLength(8);
    expect(recipe.selfTest.files).toEqual(expect.arrayContaining([
      'source/UCE/data_proc/gene_embeddings.py',
      'source/UCE/model_files/new_species_protein_embeddings.csv',
    ]));
    expect(recipe.selfTest.pythonCode).toContain("checkpoint['pe_embedding.weight']");
    expect(recipe.selfTest.pythonCode).toContain('assert tuple(tokens.shape) == (145469, 5120)');
  });

  it('registers the installable single-cell embedding AI Models for pipelines', async () => {
    const registrySource = readFileSync(
      resolve(rootDir, 'frontend/src/lib/tools/pipeline-registry.ts'),
      'utf8',
    );
    const { singleCellEmbeddingDefinition } = await import(
      '../../frontend/src/lib/tools/ai/single-cell-embedding'
    );

    expect(registrySource).toContain("'ai-single-cell-embedding'");
    expect(registrySource).toContain('singleCellEmbeddingDefinition');
    expect(registrySource).toContain('runSingleCellEmbeddingStep');
    expect(singleCellEmbeddingDefinition.supportedModelIds).toEqual([
      UCE_4LAYER_MODEL_ID,
      GENEFORMER_V1_10M_MODEL_ID,
      SCGPT_WHOLE_HUMAN_MODEL_ID,
    ]);
    expect(singleCellEmbeddingDefinition.id).toBe('ai-single-cell-embedding');
    expect(singleCellEmbeddingDefinition.inputSchema.batchSize.connectable).toBe(false);
    expect(singleCellEmbeddingDefinition.inputSchema.maxCsvRows.connectable).toBe(false);
    expect(singleCellEmbeddingDefinition.outputSchema.embeddedAnnData).toMatchObject({
      type: 'file',
      label: 'Embedded AnnData',
      ext: ['h5ad'],
    });
    expect(singleCellEmbeddingDefinition.outputSchema.intermediateFiles).toBeTruthy();
  });

  it('validates UCE through the shipped product runner without a copied Python implementation', () => {
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const validatorSource = readFileSync(
      resolve(rootDir, 'scripts/validate-uce-runtime.mjs'),
      'utf8',
    );

    expect(packageJson.scripts['runtime-box:validate:uce']).toBe(
      'node scripts/validate-uce-runtime.mjs',
    );
    expect(validatorSource).toContain(
      'frontend/src/lib/tools/ai/python-scripts/uce-embedding.ts',
    );
    expect(validatorSource).toContain(
      "const prefix = 'export const UCE_EMBEDDING_SCRIPT = String.raw`'",
    );
    expect(validatorSource).not.toMatch(/^export const UCE_EMBEDDING_SCRIPT/m);
  });

  it('runs Geneformer parity through the recipe interpreter without POSIX-only paths', () => {
    const validatorSource = readFileSync(
      resolve(rootDir, 'scripts/validate-geneformer-parity.mjs'),
      'utf8',
    );
    const harnessSource = readFileSync(
      resolve(rootDir, 'scripts/ai-validation/geneformer-parity.py'),
      'utf8',
    );

    expect(validatorSource).toContain("...RECIPE.pythonEntryPoint.split('/')");
    expect(validatorSource).toContain("'--accelerator', RECIPE.target.accelerator");
    expect(harnessSource).toContain('Path(sys.executable)');
    expect(harnessSource).toContain('if args.accelerator == "cuda":');
    expect(harnessSource).toContain('elif args.accelerator != "cpu":');
    expect(harnessSource).not.toContain('CUDA_TARGET_ID =');
  });
});
