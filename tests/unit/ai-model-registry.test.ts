import { describe, expect, it } from 'vitest';
import {
  LOCAL_AI_MODEL_REGISTRY,
  MOCK_AI_MODEL_ID,
} from '../../frontend/src/lib/ai/model-registry';

describe('AI model registry contracts', () => {
  it('keeps model ids unique and category metadata explicit', () => {
    const ids = new Set<string>();

    for (const model of LOCAL_AI_MODEL_REGISTRY) {
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
    const mock = LOCAL_AI_MODEL_REGISTRY.at(-1);

    expect(mock?.id).toBe(MOCK_AI_MODEL_ID);
    expect(mock?.category).toBe('Development Fixtures');
    expect(mock?.tags ?? []).toContain('development');
  });
});
