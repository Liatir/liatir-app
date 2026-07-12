import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GENEFORMER_V1_10M_MODEL_ID,
  SCFOUNDATION_100M_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  getLocalAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';
import { artifactSpecForModelId } from '../../frontend/src/lib/ai/model-artifacts';

const rootDir = resolve(import.meta.dirname, '../..');

const PREVIEW_BATCH5_MODEL_IDS = [
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  SCFOUNDATION_100M_MODEL_ID,
];

describe('Batch 5 single-cell foundation model contract', () => {
  it('keeps deferred Batch 5 candidates as preview models with explicit capabilities', () => {
    for (const id of PREVIEW_BATCH5_MODEL_IDS) {
      const model = getLocalAIModelMetadata(id);

      expect(model, `${id} missing model metadata`).toBeTruthy();
      expect(model?.category).toBe('Single-cell Foundation Models');
      expect(model?.releaseStage).toBe('preview');
      expect(model?.modalities).toContain('single-cell');
      expect(model?.capabilities).toContain('single-cell-embedding');
      expect(model?.documentation?.officialUrl, `${id} missing official source`).toMatch(/^https:\/\//);
      expect(model?.license?.verifiedAt, `${id} missing license verification date`).toBe('2026-07-02');
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
      os: ['macos'],
      arch: ['aarch64'],
    });
    expect(model?.install?.hostRequirements?.python).toBeUndefined();
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-geneformer');
    expect(spec?.preloadKind).toBe('managed-files');
    expect(spec?.modelFile).toBe('model/model.safetensors');
  });

  it('keeps preview models paired with isolated future runtime families without enabling preload', () => {
    const runtimeFamilies = new Set<string>();

    for (const id of PREVIEW_BATCH5_MODEL_IDS) {
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

  it('enables UCE as the first installable Batch 5 runtime box', () => {
    const model = getLocalAIModelMetadata(UCE_4LAYER_MODEL_ID);
    const spec = artifactSpecForModelId(UCE_4LAYER_MODEL_ID);

    expect(model, 'UCE missing model metadata').toBeTruthy();
    expect(model?.category).toBe('Single-cell Foundation Models');
    expect(model?.releaseStage).toBeUndefined();
    expect(model?.install?.method).toBe('managed-runtime');
    expect(model?.install?.runtimeId).toBe('single-cell-foundation-uce');
    expect(model?.install?.modelCacheSubdir).toBe('model-cache/uce');
    expect(model?.install?.runtimeSources?.[0]?.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(model?.install?.files?.map((file) => file.relativePath).sort()).toEqual([
      'model_files/4layer_model.torch',
      'model_files/all_tokens.torch',
      'model_files/protein_embeddings.tar.gz',
      'model_files/species_chrom.csv',
      'model_files/species_offsets.pkl',
    ]);
    expect(model?.install?.hostRequirements?.python?.maxVersionExclusive).toBe('3.12');
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-uce');
    expect(spec?.preloadKind).toBe('uce-managed-files');
  });

  it('registers the UCE single-cell embedding AI Tool for pipelines', () => {
    const registrySource = readFileSync(
      resolve(rootDir, 'frontend/src/lib/tools/pipeline-registry.ts'),
      'utf8',
    );
    const toolSource = readFileSync(
      resolve(rootDir, 'frontend/src/lib/tools/ai/single-cell-embedding.ts'),
      'utf8',
    );

    expect(registrySource).toContain("'ai-single-cell-embedding'");
    expect(registrySource).toContain('singleCellEmbeddingDefinition');
    expect(registrySource).toContain('runSingleCellEmbeddingStep');
    expect(toolSource).toContain(
      'supportedModelIds: [UCE_4LAYER_MODEL_ID, GENEFORMER_V1_10M_MODEL_ID]',
    );
    expect(toolSource).toContain("id: 'ai-single-cell-embedding'");
    expect(toolSource).toContain('batchSize');
    expect(toolSource).toContain('maxCsvRows');
    expect(toolSource.match(/connectable: false/g)?.length).toBeGreaterThanOrEqual(2);
    expect(toolSource).toContain("embeddedAnnData: { type: 'file', label: 'Embedded AnnData', ext: ['h5ad'] }");
    expect(toolSource).toContain('intermediateFiles');
    expect(toolSource).toContain('GENEFORMER_EMBEDDING_SCRIPT');
  });
});
