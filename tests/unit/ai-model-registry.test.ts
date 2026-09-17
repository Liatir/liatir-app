/** Contract tests for the Runtime Box-only product AI Model catalog. */
import { describe, expect, it } from 'vitest';
import {
  GENEFORMER_V1_10M_MODEL_ID,
  RUNTIME_BOX_AI_MODEL_REGISTRY,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
  getRuntimeBoxAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';
import { BOLTZ_2_MODEL_ID } from '@liatir/core';

const EXPECTED_MODEL_IDS = [
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  GENEFORMER_V1_10M_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  BOLTZ_2_MODEL_ID,
];

describe('AI model registry contracts', () => {
  it('exposes exactly the published Runtime Box models', () => {
    expect(RUNTIME_BOX_AI_MODEL_REGISTRY.map((model) => model.id)).toEqual(EXPECTED_MODEL_IDS);
  });

  it('keeps IDs unique and every product model Runtime Box-installable', () => {
    const ids = new Set<string>();
    for (const model of RUNTIME_BOX_AI_MODEL_REGISTRY) {
      expect(model.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(ids.has(model.id), `duplicate model id: ${model.id}`).toBe(false);
      ids.add(model.id);
      expect(model.source).toBe('runtime-box');
      expect(model.install.method).toBe('runtime-box');
      expect(model.install.runtimeBox.publishedTargets.length).toBeGreaterThan(0);
      expect(model.install.runtimeId).toBeTruthy();
      expect(model.install.modelCacheSubdir).toBeTruthy();
      if (model.id === MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID) {
        expect(model.capabilities).toEqual(['mhc-class-i-epitope-prediction']);
        expect(model.modalities).toContain('protein');
      } else if (model.id === BOLTZ_2_MODEL_ID) {
        expect(model.capabilities).toEqual(['protein-structure-prediction', 'protein-binding']);
        expect(model.modalities).toContain('ligand');
      } else {
        expect(model.capabilities).toEqual(['single-cell-embedding']);
        expect(model.modalities).toContain('single-cell');
      }
    }
  });

  it('requires public and official documentation for every product model', () => {
    for (const model of RUNTIME_BOX_AI_MODEL_REGISTRY) {
      expect(model.documentation?.liatirPath).toMatch(/^\/ai\/models\/[a-z0-9-]+$/);
      expect(model.documentation?.officialUrl).toMatch(/^https:\/\//);
    }
  });

  it('records separate UCE code and model-asset licenses with attribution', () => {
    const uce = getRuntimeBoxAIModelMetadata(UCE_4LAYER_MODEL_ID);
    expect(uce?.license?.name).toBe('MIT code / CC BY 4.0 model assets');
    expect(uce?.license?.components?.map((component) => component.spdxId)).toEqual([
      'MIT',
      'CC-BY-4.0',
    ]);
    for (const component of uce?.license?.components ?? []) {
      expect(component.url).toMatch(/^https:\/\//);
      expect(component.sourceUrl).toMatch(/^https:\/\//);
      expect(component.attribution?.trim()).toBeTruthy();
    }
  });
});
