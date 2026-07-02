import { describe, expect, it } from 'vitest';
import {
  GENEFORMER_V1_10M_MODEL_ID,
  SCFOUNDATION_100M_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  getLocalAIModelMetadata,
} from '../../frontend/src/lib/ai/model-registry';
import { artifactSpecForModelId } from '../../frontend/src/lib/ai/model-artifacts';

const BATCH5_MODEL_IDS = [
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  GENEFORMER_V1_10M_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  SCFOUNDATION_100M_MODEL_ID,
];

describe('Batch 5 single-cell foundation model contract', () => {
  it('registers Batch 5 candidates as preview models with explicit capabilities', () => {
    for (const id of BATCH5_MODEL_IDS) {
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

  it('keeps preview models paired with isolated future runtime families without enabling preload', () => {
    const runtimeFamilies = new Set<string>();

    for (const id of BATCH5_MODEL_IDS) {
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
});
