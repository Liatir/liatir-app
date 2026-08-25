import type { PipelineStepDefinition } from '$lib/types/pipeline';

export type SnpSiftFilterPresetId =
  | 'high-impact'
  | 'high-or-moderate-impact'
  | 'missense'
  | 'stop-gained'
  | 'minimum-quality'
  | 'custom';

export interface SnpSiftFilterPreset {
  id: SnpSiftFilterPresetId;
  label: string;
  description: string;
  requiresAnn: boolean;
}

export const SNPSIFT_FILTER_PRESETS: SnpSiftFilterPreset[] = [
  {
    id: 'high-impact',
    label: 'High impact',
    description: 'Keep variants annotated by SnpEff as having a high biological effect.',
    requiresAnn: true,
  },
  {
    id: 'high-or-moderate-impact',
    label: 'High or moderate',
    description: 'Keep variants annotated as high or moderate impact.',
    requiresAnn: true,
  },
  {
    id: 'missense',
    label: 'Missense',
    description: 'Keep variants that change one amino acid in a protein.',
    requiresAnn: true,
  },
  {
    id: 'stop-gained',
    label: 'Stop gained',
    description: 'Keep variants that introduce an early protein stop signal.',
    requiresAnn: true,
  },
  {
    id: 'minimum-quality',
    label: 'Minimum quality',
    description: 'Keep variants whose VCF quality score reaches the chosen threshold.',
    requiresAnn: false,
  },
  {
    id: 'custom',
    label: 'Advanced expression',
    description: 'Use a SnpSift Filter expression directly.',
    requiresAnn: false,
  },
];

export interface ResolveSnpSiftFilterOptions {
  minimumQuality?: number | string;
  customExpression?: string;
}

/** Turn a friendly preset into the exact immutable expression recorded with the run. */
export function resolveSnpSiftFilterExpression(
  presetId: string,
  options: ResolveSnpSiftFilterOptions = {},
): { expression: string; preset: SnpSiftFilterPreset } {
  const preset = SNPSIFT_FILTER_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error(`Unknown SnpSift Filter preset: ${presetId}`);

  switch (preset.id) {
    case 'high-impact':
      return { preset, expression: "ANN[*].IMPACT = 'HIGH'" };
    case 'high-or-moderate-impact':
      return { preset, expression: "(ANN[*].IMPACT = 'HIGH') | (ANN[*].IMPACT = 'MODERATE')" };
    case 'missense':
      return { preset, expression: "ANN[*].EFFECT has 'missense_variant'" };
    case 'stop-gained':
      return { preset, expression: "ANN[*].EFFECT has 'stop_gained'" };
    case 'minimum-quality': { 
      const minimumQuality = Number(options.minimumQuality ?? 30);
      if (!Number.isFinite(minimumQuality) || minimumQuality < 0) {
        throw new Error('Minimum quality must be zero or a positive number.');
      }
      return { preset, expression: `QUAL >= ${minimumQuality}` };
    }
    case 'custom': { 
      const expression = options.customExpression?.trim() ?? '';
      if (!expression) throw new Error('Enter a SnpSift Filter expression.');
      if (expression.length > 4096 || /[\0\r\n]/.test(expression)) {
        throw new Error('The SnpSift Filter expression is invalid or too long.');
      }
      return { preset, expression };
    }
  }
}

export const snpSiftFilterDefinition: PipelineStepDefinition = {
  id: 'snpsift-filter',
  type: 'native-tool',
  label: 'SnpSift Filter',
  description: 'Keep selected variants from a VCF using readable presets or an advanced expression.',
  category: 'Variant Calling',
  inputSchema: {
    inputFile: {
      type: 'file',
      label: 'VCF file',
      required: true,
      accept: ['vcf', 'vcf.gz'],
    },
    preset: {
      type: 'string',
      label: 'Filter preset',
      required: true,
      default: 'high-impact',
      options: SNPSIFT_FILTER_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.label,
        description: preset.description,
      })),
    },
    minimumQuality: {
      type: 'number',
      label: 'Minimum quality',
      required: false,
      default: 30,
      connectable: false,
    },
    expression: {
      type: 'string',
      label: 'Advanced expression',
      required: false,
      default: '',
      connectable: false,
    },
  },
  outputSchema: {
    filteredVcf: { type: 'file', label: 'Filtered VCF', ext: ['vcf'] },
  },
};
