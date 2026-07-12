/**
 * Contract tests for the AI model registry.
 *
 * The registry is a hand-written table, and everything downstream trusts it: models are keyed by id in the
 * store, on disk, in job metadata and in saved Results. A duplicate or malformed id would therefore not fail
 * loudly — it would quietly make two models share one install directory, or make a saved run unreadable.
 *
 * These assertions are cheap and catch that at the moment the entry is added, rather than after it has shipped.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAI1_MODEL_ID,
  LOCAL_AI_MODEL_REGISTRY,
  MOCK_AI_MODEL_ID,
  VISIBLE_LOCAL_AI_MODEL_REGISTRY,
  getLocalAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';

describe('AI model registry contracts', () => {
  it('keeps model ids unique and category metadata explicit', () => {
    const ids = new Set<string>();

    for (const model of VISIBLE_LOCAL_AI_MODEL_REGISTRY) {
      expect(model.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(ids.has(model.id), `duplicate model id: ${model.id}`).toBe(false);
      ids.add(model.id);

      expect(model.category?.trim(), `${model.id} missing category`).toBeTruthy();
      expect(model.name).not.toMatch(/plugin/i);
      expect(model.description).not.toMatch(/AI plugin/i);
      expect(model.capabilities.length, `${model.id} missing capabilities`).toBeGreaterThan(0);
      expect(model.modalities.length, `${model.id} missing modalities`).toBeGreaterThan(0);
    }
  });

  it('keeps the mock model registered last and marked as an internal fixture', () => {
    const mock = VISIBLE_LOCAL_AI_MODEL_REGISTRY.at(-1);

    expect(mock?.id).toBe(MOCK_AI_MODEL_ID);
    expect(mock?.category).toBe('Development Fixtures');
    expect(mock?.tags ?? []).toContain('development');
  });

  it('requires public documentation links for user-facing AI Models', () => {
    for (const model of VISIBLE_LOCAL_AI_MODEL_REGISTRY) {
      if (model.id === MOCK_AI_MODEL_ID) {
        expect(model.documentation).toBeUndefined();
        continue;
      }

      expect(
        model.documentation?.liatirPath,
        `${model.id} missing Liatir documentation path`,
      ).toMatch(/^\/ai\/models\/[a-z0-9-]+$/);
      expect(
        model.documentation?.officialUrl,
        `${model.id} missing official documentation URL`,
      ).toMatch(/^https:\/\//);
    }
  });

  it('keeps preview AI Models documented but not installable or runnable', () => {
    const previews = VISIBLE_LOCAL_AI_MODEL_REGISTRY.filter(
      (model) => model.releaseStage === 'preview',
    );

    expect(previews.length).toBeGreaterThan(0);
    for (const model of previews) {
      expect(model.install, `${model.id} preview model must not expose install controls`).toBeUndefined();
      expect(model.documentation?.liatirPath, `${model.id} preview model missing docs`).toBeTruthy();
      expect(model.tags ?? []).toContain('preview');
    }
  });

  it('keeps deferred models implemented but hidden from user-facing catalog surfaces', () => {
    const chai = getLocalAIModelMetadata(CHAI1_MODEL_ID);

    expect(chai, 'Chai work should remain in the registry for future re-enable').toBeTruthy();
    expect(chai?.catalogVisibility).toBe('hidden');
    expect(chai?.catalogHiddenReason?.trim()).toBeTruthy();
    expect(VISIBLE_LOCAL_AI_MODEL_REGISTRY.some((model) => model.id === CHAI1_MODEL_ID)).toBe(false);
  });
});
