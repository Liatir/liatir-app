import { describe, expect, it } from 'vitest';
import {
  getLastSegmentsStringFromPath,
  sanitizeLocalPathsForDisplay,
} from '../../frontend/src/lib/utils';

describe('local path display helpers', () => {
  it('returns only the requested trailing path segments', () => {
    expect(getLastSegmentsStringFromPath('/Users/lorenzo/data/demo/sample.h5ad', 2)).toBe('demo/sample.h5ad');
    expect(getLastSegmentsStringFromPath('C:\\Users\\lab\\data\\variants.vcf', 2)).toBe('data/variants.vcf');
  });

  it('sanitizes absolute local paths inside log text', () => {
    const sanitized = sanitizeLocalPathsForDisplay(
      'Failed while reading /Users/lorenzo/Library/Application Support/app.liatir.app/.liatir/.main/data/demo/sample.h5ad',
      2,
    );

    expect(sanitized).toContain('demo/sample.h5ad');
    expect(sanitized).not.toContain('/Users/lorenzo/Library');
  });
});
