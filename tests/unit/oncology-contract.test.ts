import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MHC_CLASS_I_PEPTIDE_LENGTHS,
  MHCFLURRY_CLASS1_PRESENTATION_METADATA,
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
  MHCFLURRY_EPITOPE_TOOL_ID,
  NEOANTIGEN_PRIORITIZATION_TOOL_ID,
  ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE,
  PVACTOOLS_RUNTIME_COMPONENT_ID,
  PVACTOOLS_RUNTIME_ID,
  parseMhcClassIAlleles,
  parseMhcClassIPeptideLengths,
} from '../../packages/liatir-core/src';

describe('Phase 2 oncology contract', () => {
  it('keeps model, runtime, and tool identities stable and distinct', () => {
    expect(MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID).toBe('openvax-mhcflurry-class1-presentation');
    expect(MHCFLURRY_EPITOPE_TOOL_ID).toBe('ai-mhc-class-i-epitope-prediction');
    expect(PVACTOOLS_RUNTIME_COMPONENT_ID).toBe('griffithlab-pvactools-pvacseq');
    expect(PVACTOOLS_RUNTIME_ID).toBe('oncology-pvactools-pvacseq-7-1-2');
    expect(NEOANTIGEN_PRIORITIZATION_TOOL_ID).toBe('neoantigen-prioritization');
    expect(new Set([
      MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
      MHCFLURRY_EPITOPE_TOOL_ID,
      PVACTOOLS_RUNTIME_COMPONENT_ID,
      PVACTOOLS_RUNTIME_ID,
      NEOANTIGEN_PRIORITIZATION_TOOL_ID,
    ]).size).toBe(5);
  });

  it('keeps reviewed MHCflurry metadata unexposed until an exact target is published', () => {
    expect(MHCFLURRY_CLASS1_PRESENTATION_METADATA).toMatchObject({
      id: MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
      source: 'runtime-box',
      localOnly: true,
      capabilities: ['mhc-class-i-epitope-prediction'],
      modalities: ['protein'],
      install: {
        runtimeId: 'oncology-mhcflurry-class1-presentation-2-2-1',
        modelCacheSubdir: 'model-cache/mhcflurry-class1-presentation',
        runtimeBox: { boxId: 'mhcflurry-class1-presentation', publishedTargets: [] },
      },
    });
  });

  it('normalizes, deduplicates, and bounds HLA Class I alleles', () => {
    expect(parseMhcClassIAlleles('HLA-A*02:01, HLA-B*07:02;HLA-A*02:01'))
      .toEqual(['HLA-A*02:01', 'HLA-B*07:02']);
    expect(() => parseMhcClassIAlleles('')).toThrow('At least one HLA Class I allele');
    expect(() => parseMhcClassIAlleles('A*02:01')).toThrow('Invalid HLA Class I allele');
    expect(() => parseMhcClassIAlleles('HLA-DRA*01:01')).toThrow('Invalid HLA Class I allele');
    expect(() => parseMhcClassIAlleles(
      Array.from({ length: 13 }, (_, index) => `HLA-A*${String(index + 1).padStart(2, '0')}:01`).join(','),
    )).toThrow('At most 12');
  });

  it('accepts only whole peptide lengths supported by the Phase 2 boxes', () => {
    expect(parseMhcClassIPeptideLengths('11, 8;9,8')).toEqual([8, 9, 11]);
    expect(MHC_CLASS_I_PEPTIDE_LENGTHS).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    for (const invalid of ['', '7', '16', '9.5', 'nine']) {
      expect(() => parseMhcClassIPeptideLengths(invalid), invalid).toThrow();
    }
  });

  it('describes outputs as experimental candidates rather than medical conclusions', () => {
    expect(ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE).toContain('experimental candidates');
    expect(ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE).toContain('not a validated vaccine');
    expect(ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE).toContain('diagnostic');
  });

  it('keeps direct-run UI state separate from pipeline jobs and records reproducible provenance', () => {
    const mhcPage = readFileSync(resolve('frontend/src/lib/components/ai/MhcFlurryModelPage.svelte'), 'utf8');
    const pvacPage = readFileSync(resolve('frontend/src/routes/tools/oncology/neoantigen-prioritization/+page.svelte'), 'utf8');
    const mhcTool = readFileSync(resolve('frontend/src/lib/tools/ai/mhcflurry-epitope.ts'), 'utf8');
    const pvacTool = readFileSync(resolve('frontend/src/lib/tools/oncology/neoantigen-prioritization.ts'), 'utf8');
    const toolsPage = readFileSync(resolve('frontend/src/routes/tools/+page.svelte'), 'utf8');

    expect(mhcPage).toContain("metadataString(job, 'runKind') === 'ai-model-direct'");
    expect(pvacPage).toContain("metadataString(job, 'runKind') === 'tool-runtime-direct'");
    expect(mhcTool).toContain('topCount: parsed.summary.requestedTopCount');
    expect(mhcTool).toContain('executionEvidence: provenance');
    expect(mhcTool).toContain("['Runtime Box archive SHA-256', activation.release.archive.sha256]");
    expect(pvacTool).toContain('proximalInspection: parsed.summary.proximalInputInspection');
    for (const parameter of ['passOnly', 'topCount', 'threads']) {
      expect(pvacTool).toContain(`${parameter}: parsed.summary.`);
    }
    expect(pvacTool).toContain("['Runtime Box archive SHA-256', activation.release.archive.sha256]");
    expect(toolsPage).toContain('runtime.install.runtimeBox.publishedTargets.length > 0');
    expect(toolsPage).toContain("href: '/tools/oncology/neoantigen-prioritization'");
    expect(toolsPage).toContain("status: pvactoolsPublished ? 'available' : 'soon'");
  });
});
