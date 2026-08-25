import { describe, expect, it } from 'vitest';

import {
  resolveSnpSiftFilterExpression,
  SNPSIFT_FILTER_PRESETS,
} from '../../frontend/src/lib/tools/variants/snpsift';

describe('SnpSift Filter presets', () => {
  it('resolves biological presets to ANN expressions', () => {
    expect(resolveSnpSiftFilterExpression('high-impact')).toMatchObject({
      expression: "ANN[*].IMPACT = 'HIGH'",
      preset: { requiresAnn: true },
    });
    expect(resolveSnpSiftFilterExpression('high-or-moderate-impact').expression)
      .toContain("ANN[*].IMPACT = 'MODERATE'");
    expect(resolveSnpSiftFilterExpression('missense').expression).toContain('missense_variant');
    expect(resolveSnpSiftFilterExpression('stop-gained').expression).toContain('stop_gained');
    expect(SNPSIFT_FILTER_PRESETS.filter((preset) => preset.requiresAnn)).toHaveLength(4);
  });

  it('validates quality and advanced expressions before execution', () => {
    expect(resolveSnpSiftFilterExpression('minimum-quality', { minimumQuality: 42.5 }).expression)
      .toBe('QUAL >= 42.5');
    expect(() => resolveSnpSiftFilterExpression('minimum-quality', { minimumQuality: -1 }))
      .toThrow('zero or a positive number');
    expect(resolveSnpSiftFilterExpression('custom', {
      customExpression: '  (QUAL >= 30) & (DP >= 10)  ',
    }).expression).toBe('(QUAL >= 30) & (DP >= 10)');
    expect(() => resolveSnpSiftFilterExpression('custom', { customExpression: '   ' }))
      .toThrow('Enter a SnpSift Filter expression');
    expect(() => resolveSnpSiftFilterExpression('custom', { customExpression: 'QUAL > 1\nDP > 2' }))
      .toThrow('invalid or too long');
  });
});
