/**
 * Architecture tests: they assert how the AI code is *organised*, not what it computes.
 *
 * The rules they defend are the ones that erode quietly. Nothing breaks the day someone merges every model's
 * Python into one file, or adds a model to the registry without an artifact spec — it breaks weeks later, and
 * by then the structure is gone. These tests read the source tree itself and fail the build the moment that
 * happens, which is the only way a structural rule survives contact with a growing codebase.
 *
 * A failure here is not a bug in the code under test; it means the code drifted away from the architecture.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_MODEL_ARTIFACT_SPECS } from '../../frontend/src/lib/ai/model-artifacts';
import { LOCAL_AI_MODEL_REGISTRY, MOCK_AI_MODEL_ID } from '../../frontend/src/lib/ai/model-registry';
import { VIEWER_RUNTIME_REGISTRY } from '../../frontend/src/lib/viewers/runtime-registry';

const rootDir = resolve(import.meta.dirname, '../..');
const aiToolsDir = resolve(rootDir, 'frontend/src/lib/tools/ai');
const aiLibDir = resolve(rootDir, 'frontend/src/lib/ai');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(fullPath);
    return [fullPath];
  });
}

describe('AI modularity boundaries', () => {
  it('keeps every registered AI Model paired with an artifact/runtime-family spec', () => {
    const artifactIds = new Set(AI_MODEL_ARTIFACT_SPECS.map((spec) => spec.modelId));

    for (const model of LOCAL_AI_MODEL_REGISTRY) {
      expect(artifactIds.has(model.id), `${model.id} missing artifact spec`).toBe(true);
    }
  });

  it('requires managed runtimes to declare isolated runtime and cache locations', () => {
    for (const model of LOCAL_AI_MODEL_REGISTRY) {
      if (model.id === MOCK_AI_MODEL_ID
        || (model.install?.method !== 'managed-runtime' && model.install?.method !== 'runtime-box')) continue;

      expect(model.install.runtimeId, `${model.id} missing runtimeId`).toMatch(/^[a-z0-9][a-z0-9-_]+$/);
      expect(model.install.modelCacheSubdir, `${model.id} missing modelCacheSubdir`).toBeTruthy();
      expect(model.install.runtimePackages?.length, `${model.id} missing runtimePackages`).toBeGreaterThan(0);
    }
  });

  it('only shares a runtimeId when package and host requirements are identical', () => {
    const byRuntime = new Map<string, string>();

    for (const model of LOCAL_AI_MODEL_REGISTRY) {
      const runtimeId = model.install?.runtimeId;
      if (!runtimeId) continue;

      const signature = JSON.stringify({
        packages: model.install?.runtimePackages ?? [],
        hostRequirements: model.install?.hostRequirements ?? null,
      });
      const previous = byRuntime.get(runtimeId);
      if (previous) {
        expect(signature, `${runtimeId} is shared by incompatible model specs`).toBe(previous);
      } else {
        byRuntime.set(runtimeId, signature);
      }
    }
  });

  it('keeps AI Python scripts split by tool instead of one shared monolith', () => {
    const legacyMonolith = resolve(aiToolsDir, 'python-scripts.ts');
    const scriptsDir = resolve(aiToolsDir, 'python-scripts');
    const files = filesUnder(scriptsDir).filter((file) => file.endsWith('.ts'));

    expect(existsSync(legacyMonolith)).toBe(false);
    expect(files.map((file) => file.replace(`${scriptsDir}/`, '')).sort()).toEqual([
      'celltypist-annotate.ts',
      'geneformer-embedding.ts',
      'genomic-variant-effect.ts',
      'index.ts',
      'protein-structure.ts',
      'regulatory-prediction.ts',
      'sequence-embedding.ts',
      'uce-embedding.ts',
    ]);
    for (const file of files) {
      expect(statSync(file).size, `${file} should stay focused`).toBeLessThan(24_000);
    }
  });

  it('centralizes upstream model identifiers outside AI Tool implementations', () => {
    const forbidden = [/InstaDeepAI\//, /facebook\/esm2_t6_8M_UR50D/];
    const allowedFiles = new Set([
      resolve(aiLibDir, 'model-artifacts.ts'),
      resolve(aiLibDir, 'model-registry.ts'),
    ]);

    for (const file of filesUnder(aiToolsDir).concat(filesUnder(aiLibDir))) {
      if (!file.endsWith('.ts') || allowedFiles.has(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${file} contains duplicated upstream model id`).toBe(false);
      }
    }
  });
});

describe('viewer runtime modularity boundaries', () => {
  it('keeps heavy viewer runtimes installable through explicit runtime boxes', () => {
    const ids = new Set<string>();

    for (const runtime of VIEWER_RUNTIME_REGISTRY) {
      expect(runtime.id).toMatch(/^viewer-[a-z0-9-]+$/);
      expect(ids.has(runtime.id), `duplicate viewer runtime id: ${runtime.id}`).toBe(false);
      ids.add(runtime.id);

      if (runtime.install.kind === 'managed-script') {
        expect(runtime.install.entryFile, `${runtime.id} missing entryFile`).toBeTruthy();
        expect(runtime.install.files?.length, `${runtime.id} missing managed files`).toBeGreaterThan(0);
        for (const file of runtime.install.files ?? []) {
          expect(file.relativePath, `${runtime.id} managed file must stay relative`).not.toMatch(/^[/\\]|[a-zA-Z]:\\/);
        }
      }
    }
  });
});
