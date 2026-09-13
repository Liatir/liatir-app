import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOLTZ_2_MODEL_ID,
  BOLTZ_2_RELEASE_CANDIDATE_METADATA,
  LIATIR_TOOL_RUNTIME_CATALOG,
  OPENMM_RELEASE_CANDIDATE_METADATA,
  OPENMM_RUNTIME_COMPONENT_ID,
  PROTENIX_MINI_DEFAULT_MODEL_ID,
  PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA,
  PROTENIX_BASE_V1_MODEL_ID,
  PROTENIX_BASE_V1_RELEASE_CANDIDATE_METADATA,
  PROTENIX_V2_MODEL_ID,
  PROTENIX_V2_RELEASE_CANDIDATE_METADATA,
  RUNTIME_BOX_AI_MODEL_REGISTRY,
} from '@liatir/core';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

describe('Phase 3 Runtime Box candidate boundary', () => {
  it('prepares separate Protenix checkpoints without treating unhashed candidates as releases', () => {
    const root = resolve(import.meta.dirname, '../..');
    const candidates = ['protenix-v2', 'protenix-mini-default-v0-5-0'].map((box) =>
      JSON.parse(readFileSync(resolve(root, 'runtime-boxes/scrolls', box, 'candidate-inputs.json'), 'utf8')));
    expect(candidates.map((item) => item.modelName)).toEqual(['protenix-v2', 'protenix_mini_default_v0.5.0']);
    expect(new Set(candidates.map((item) => item.runtimeId)).size).toBe(2);
    for (const candidate of candidates) {
      expect(candidate.sourceRevision).toBe('2475421477ab414b571149ad4a875c390ff8a35d');
      expect(candidate.esmEnabled).toBe(false);
      expect(candidate.additionalCheckpoints).toEqual([]);
      expect(candidate.checkpoint.sha256).toBeNull();
      expect(candidate.checkpoint.relativePath).toBe(`checkpoint/${candidate.modelName}.pt`);
      expect(candidate.inference.loadStrict).toBe(true);
      expect(candidate.releaseStatus).toMatch(/^blocked-/);
    }
    expect(candidates[1].useTemplate).toBe(false);
    expect(candidates[1].inference).toEqual({ recycles: 4, diffusionSteps: 5, loadStrict: true });
  });

  // Windows reaches OpenMM through WSL2 on the Linux payload, so there is no native Windows target.
  it.each([
    'macos-aarch64-cpu', 'linux-x86_64-cpu', 'linux-x86_64-cuda12.9',
  ])('keeps the OpenMM %s payload reproducible and its validation data intact', (target) => {
    const root = resolve(import.meta.dirname, '../..');
    const directory = resolve(root, 'runtime-boxes/scrolls/openmm', target);
    const scroll = JSON.parse(readFileSync(resolve(directory, 'scroll.json'), 'utf8'));
    const manifest = readFileSync(resolve(directory, 'pixi.toml'), 'utf8');
    const lock = readFileSync(resolve(directory, 'pixi.lock'), 'utf8');
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(scroll.scrollId).toBe(`openmm-${target}`);
    expect(scroll.labels.model).toBe(OPENMM_RUNTIME_COMPONENT_ID);
    expect(manifest).toContain('pytorch = { version = "2.10.0.*", build = "cpu_*" }');
    expect(lock).toMatch(/pytorch-2\.10\.0-cpu_/);
    expect(lock).not.toMatch(/pytorch-\d[^\n]*-(?:cuda|gpu)_/);
    for (const local of scroll.localFiles) {
      expect(hash(readFileSync(resolve(root, local.sourcePath))), local.sourcePath).toBe(local.sha256);
    }
    for (const fixture of ['test-ala-3.pdb', 'test-aa.pdb']) {
      const path = `source/openmmforcefields/openmmforcefields/data/${fixture}`;
      expect(scroll.selfTest.files).toContain(path);
      expect(scroll.prunePaths.some((pruned: string) => path === pruned || path.startsWith(`${pruned}/`))).toBe(false);
    }
    expect(scroll.selfTest.files).toContain(`${scroll.cacheSubdir}/openff-gnn-am1bcc-1.0.0.pt`);
    const audit = JSON.parse(readFileSync(resolve(root, scroll.condaDependencyLicenseAudit), 'utf8'));
    expect(audit.targetId).toBe(target);
    expect(audit.packages.find((item: { name: string }) => item.name === 'pytorch').version).toBe('2.10.0');
  });

  it('keeps every unvalidated Phase 3 component out of normal product catalogs', () => {
    const productModels = RUNTIME_BOX_AI_MODEL_REGISTRY.map((model) => model.id);
    expect(productModels).not.toContain(BOLTZ_2_MODEL_ID);
    expect(productModels).not.toContain(PROTENIX_BASE_V1_MODEL_ID);
    expect(productModels).not.toContain(PROTENIX_V2_MODEL_ID);
    expect(productModels).not.toContain(PROTENIX_MINI_DEFAULT_MODEL_ID);
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).not.toContain(OPENMM_RUNTIME_COMPONENT_ID);
  });

  it('resolves each exact component only in the non-distributable release-candidate build', () => {
    expect(resolveRuntimeBoxReleaseCandidate(BOLTZ_2_MODEL_ID)).toEqual({
      kind: 'ai-model', metadata: BOLTZ_2_RELEASE_CANDIDATE_METADATA,
    });
    expect(resolveRuntimeBoxReleaseCandidate(PROTENIX_BASE_V1_MODEL_ID)).toEqual({
      kind: 'ai-model', metadata: PROTENIX_BASE_V1_RELEASE_CANDIDATE_METADATA,
    });
    expect(resolveRuntimeBoxReleaseCandidate(PROTENIX_V2_MODEL_ID)).toEqual({
      kind: 'ai-model', metadata: PROTENIX_V2_RELEASE_CANDIDATE_METADATA,
    });
    expect(resolveRuntimeBoxReleaseCandidate(PROTENIX_MINI_DEFAULT_MODEL_ID)).toEqual({
      kind: 'ai-model', metadata: PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA,
    });
    expect(resolveRuntimeBoxReleaseCandidate(OPENMM_RUNTIME_COMPONENT_ID)).toEqual({
      kind: 'tool-runtime', metadata: OPENMM_RELEASE_CANDIDATE_METADATA,
    });
  });

  it('keeps the exact Mini Default model separate and free of ESM dependencies', () => {
    expect(PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA.id)
      .toBe('bytedance-protenix-mini-default-v0-5-0');
    expect(PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA.parameters).toBe(134_060_000);
    expect(JSON.stringify(PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA.install.runtimePackages))
      .not.toMatch(/esm/i);
    expect(PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA.install.runtimeId)
      .not.toBe(PROTENIX_V2_RELEASE_CANDIDATE_METADATA.install.runtimeId);
  });

  it('requires measured evidence before publishing VRAM claims', () => {
    for (const candidate of [
      BOLTZ_2_RELEASE_CANDIDATE_METADATA,
      PROTENIX_BASE_V1_RELEASE_CANDIDATE_METADATA,
      PROTENIX_V2_RELEASE_CANDIDATE_METADATA,
      PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA,
    ]) {
      expect(candidate.hardware?.minVramGb).toBeUndefined();
      expect(candidate.hardware?.recommendedVramGb).toBeUndefined();
      expect(candidate.hardware?.notes).toMatch(/measurement|measurements/);
    }
  });
});
