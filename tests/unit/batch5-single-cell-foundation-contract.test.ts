/**
 * Contract tests for the single-cell foundation models.
 *
 * They enforce that the three product models use published, signed Runtime Box distributions and
 * remain connected to the shared Single-cell Embedding AI Tool.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GENEFORMER_V1_10M_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  getRuntimeBoxAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';
import { artifactSpecForModelId } from '../../frontend/src/lib/ai/model-artifacts';
import { installSvelteRuneStubs } from './support/svelte-runes';

const rootDir = resolve(import.meta.dirname, '../..');

const publishedMacosArm64MetalTargets = (minRamGb: number) => [{
  target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
  hostEnvironments: ['native'],
  minRamGb,
}];
// Geneformer ships no CPU box: measured CPU throughput is ~160 ms per cell. All three published
// targets are here: Apple silicon Metal, Linux CUDA 12.9 and native Windows CUDA 12.8.
// scGPT publishes Apple silicon Metal and Linux x86_64 CPU; Windows and the NVIDIA targets are
// built and not yet published.
const publishedScgptTargets = () => [
  ...publishedMacosArm64MetalTargets(16),
  {
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    hostEnvironments: ['native'],
    minRamGb: 16,
  },
  {
    target: { platform: 'windows', arch: 'x86_64', accelerator: 'cpu' },
    hostEnvironments: ['native'],
    minRamGb: 16,
  },
  {
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' },
    hostEnvironments: ['native'],
    minRamGb: 16,
    minNvidiaDriverVersion: '525.60.13',
  },
];
const publishedGeneformerTargets = () => [
  ...publishedMacosArm64MetalTargets(8),
  {
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' },
    hostEnvironments: ['native'],
    minRamGb: 16,
    minNvidiaDriverVersion: '525.60.13',
  },
  {
    target: { platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.8' },
    hostEnvironments: ['native'],
    minRamGb: 16,
    minNvidiaDriverVersion: '527.41',
  },
];

installSvelteRuneStubs();

describe('Batch 5 single-cell foundation model contract', () => {
  it('uses the live signed Runtime Box distribution for Geneformer', () => {
    const model = getRuntimeBoxAIModelMetadata(GENEFORMER_V1_10M_MODEL_ID);
    const spec = artifactSpecForModelId(GENEFORMER_V1_10M_MODEL_ID);
    const recipe = JSON.parse(readFileSync(
      resolve(rootDir, 'runtime-boxes/scrolls/geneformer-v1-10m/macos-aarch64-metal/scroll.json'),
      'utf8',
    )) as {
      modelId: string;
      runtimeId: string;
      assets: Array<{ relativePath: string; sizeBytes: number; sha256: string; url: string }>;
    };

    expect(model, 'Geneformer missing model metadata').toBeTruthy();
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
      os: ['macos', 'linux', 'windows'],
      arch: ['aarch64', 'x86_64'],
    });
    // No CPU box ships for this model, so the product must not advertise CPU support.
    expect(model?.hardware?.cpu).toBe(false);
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-geneformer');
    expect(spec?.modelFile).toBe('model/model.safetensors');
  });

  it('uses the live signed Runtime Box distribution for scGPT', () => {
    const model = getRuntimeBoxAIModelMetadata(SCGPT_WHOLE_HUMAN_MODEL_ID);
    const spec = artifactSpecForModelId(SCGPT_WHOLE_HUMAN_MODEL_ID);
    const scroll = JSON.parse(readFileSync(
      resolve(rootDir, 'runtime-boxes/scrolls/scgpt-whole-human/macos-aarch64-metal/scroll.json'),
      'utf8',
    )) as {
      modelId: string;
      runtimeId: string;
      sourceRevision: string;
      assets: Array<{ relativePath: string; sizeBytes: number; sha256: string }>;
    };

    expect(model, 'scGPT missing model metadata').toBeTruthy();
    expect(model?.source).toBe('runtime-box');
    expect(model?.install?.method).toBe('runtime-box');
    expect(model?.install?.runtimeId).toBe('single-cell-foundation-scgpt-whole-human');
    expect(model?.install?.modelCacheSubdir).toBe('model-cache/scgpt-whole-human');
    expect(model?.install?.runtimeBox).toEqual({
      boxId: 'scgpt-whole-human',
      channel: 'beta',
      registryBaseUrl: 'https://models.liatir.com/v1',
      publishedTargets: publishedScgptTargets(),
    });
    expect(scroll.modelId).toBe(SCGPT_WHOLE_HUMAN_MODEL_ID);
    expect(scroll.runtimeId).toBe(model?.install?.runtimeId);
    expect(scroll.sourceRevision).toBe(model?.install?.revision);
    expect(scroll.assets.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      'model-cache/scgpt-whole-human/args.json',
      'model-cache/scgpt-whole-human/best_model.pt',
      'model-cache/scgpt-whole-human/vocab.json',
    ]));
    for (const file of scroll.assets) {
      expect(file.sizeBytes, `${file.relativePath} missing byte size`).toBeGreaterThan(0);
      expect(file.sha256, `${file.relativePath} missing SHA-256`).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(model?.install?.hostRequirements).toMatchObject({
      os: ['macos', 'linux', 'windows'],
      arch: ['aarch64', 'x86_64'],
    });
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-scgpt');
    expect(spec?.modelFile).toBe('best_model.pt');
  });

  it('uses one signed Runtime Box installation path for UCE', () => {
    const model = getRuntimeBoxAIModelMetadata(UCE_4LAYER_MODEL_ID);
    const spec = artifactSpecForModelId(UCE_4LAYER_MODEL_ID);
    const recipe = JSON.parse(readFileSync(
      resolve(rootDir, 'runtime-boxes/scrolls/uce-4layer/macos-aarch64-metal/scroll.json'),
      'utf8',
    )) as {
      boxId: string;
      modelId: string;
      runtimeId: string;
      sourceRevision: string;
      pythonVersion: string;
      pixiVersion: string;
      uvVersion?: string;
      assets: Array<{ relativePath: string; sizeBytes: number; sha256: string }>;
      assetArchives: Array<{ relativePath: string; format: string; destination: string }>;
      uncompressedPaths: string[];
      prunePaths: string[];
      localFiles: Array<{ relativePath: string; sha256: string }>;
      selfTest: { files: string[]; pythonCode: string };
    };

    expect(model, 'UCE missing model metadata').toBeTruthy();
    expect(model?.category).toBe('Single-cell Foundation Models');
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
    expect(model?.install?.hostRequirements).toMatchObject({
      os: ['macos'],
      arch: ['aarch64'],
    });
    expect(model?.diskSizeBytes).toBe(10_142_864_860);
    expect(model?.license?.components?.map((component) => component.spdxId)).toEqual([
      'MIT',
      'CC-BY-4.0',
    ]);
    expect(spec?.runtimeFamily).toBe('single-cell-foundation-uce');
    expect(spec?.modelFile).toBe('model_files/4layer_model.torch');
    expect(existsSync(resolve(rootDir, 'frontend/src/lib/ai/preloaders/uce-managed-files.ts'))).toBe(false);
    expect(recipe).toMatchObject({
      boxId: 'uce-4layer',
      modelId: UCE_4LAYER_MODEL_ID,
      runtimeId: 'single-cell-foundation-uce',
      sourceRevision: model?.install?.revision,
      pythonVersion: '3.11.15',
      pixiVersion: '0.73.0',
    });
    expect(recipe.uvVersion).toBeUndefined();
    // The packed conda prefix must arrive whole. scGPT's macOS box failed its scientific
    // forward because an inherited prune list removed locked sympy, which PyTorch 2.8 imports
    // lazily, so no target may prune inside venv/.
    expect(recipe.prunePaths.filter((path) => path.startsWith('venv/'))).toEqual([]);
    // Protein embeddings are float tensors that arrive inside a tar.gz. Deflating them a second
    // time costs build minutes and returns nothing, so the tree the archive expands into is
    // declared already-compressed.
    expect(recipe.uncompressedPaths).toEqual(['model-cache/uce/model_files/protein_embeddings']);
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

  it('keeps scGPT and UCE validation recipe-driven and cross-platform', () => {
    const scgptValidator = readFileSync(
      resolve(rootDir, 'scripts/validate-scgpt-runtime.mjs'),
      'utf8',
    );
    const uceValidator = readFileSync(
      resolve(rootDir, 'scripts/validate-uce-runtime.mjs'),
      'utf8',
    );
    const validatorContext = readFileSync(
      resolve(rootDir, 'scripts/runtime-box/validator-context.mjs'),
      'utf8',
    );

    for (const validator of [scgptValidator, uceValidator]) {
      expect(validator).toContain('loadRuntimeBoxValidatorContext');
    }
    expect(validatorContext).toContain('LIATIR_RUNTIME_BOX_RECIPE_ID');
    expect(validatorContext).toContain('LIATIR_RUNTIME_BOX_TARGET_ID');
    expect(validatorContext).toContain("...recipe.pythonEntryPoint.split('/')");
    expect(scgptValidator).not.toContain("run('unzip'");
    expect(scgptValidator).not.toContain('macos-aarch64-metal.zip');
    expect(uceValidator).not.toContain("run('/usr/bin/time'");
    expect(uceValidator).not.toContain("join(RUNTIME_DIR, 'venv/bin/python')");
  });

  it('makes scGPT and UCE explicit accelerator requests fail closed', () => {
    const scgptRunner = readFileSync(
      resolve(rootDir, 'frontend/src/lib/tools/ai/python-scripts/scgpt-embedding.ts'),
      'utf8',
    );
    const uceRunner = readFileSync(
      resolve(rootDir, 'frontend/src/lib/tools/ai/python-scripts/uce-embedding.ts'),
      'utf8',
    );

    for (const runner of [scgptRunner, uceRunner]) {
      expect(runner).toContain('requested_accelerator');
      expect(runner).toContain('"auto", "cpu", "mps", "cuda"');
      expect(runner).toContain('requested_accelerator == "cuda"');
      expect(runner).toContain('torch.cuda.is_available()');
      expect(runner).toContain('requested_accelerator == "mps"');
      expect(runner).toContain('torch.backends.mps.is_available()');
    }
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
