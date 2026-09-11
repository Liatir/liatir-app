import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MHC_CLASS_I_PEPTIDE_LENGTHS,
  MHCFLURRY_CLASS1_PRESENTATION_METADATA,
  MHCFLURRY_CLASS1_PRESENTATION_RELEASE_CANDIDATE_METADATA,
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
  MHCFLURRY_EPITOPE_TOOL_ID,
  NEOANTIGEN_PRIORITIZATION_TOOL_ID,
  ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE,
  PVACTOOLS_RUNTIME_COMPONENT_ID,
  PVACTOOLS_RUNTIME_ID,
  PVACTOOLS_RELEASE_CANDIDATE_METADATA,
  PVACTOOLS_TOOL_RUNTIME_METADATA,
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

  it('checks vendored vcfpy only after adding its reviewed source directory', () => {
    for (const targetId of ['macos-aarch64-cpu', 'linux-x86_64-cpu']) {
      const scroll = JSON.parse(readFileSync(resolve(
        `runtime-boxes/scrolls/pvactools-pvacseq/${targetId}/scroll.json`,
      ), 'utf8'));
      expect(scroll.selfTest.imports).not.toContain('vcfpy');
      expect(scroll.selfTest.code.indexOf("source/vcfpy-sdist"))
        .toBeLessThan(scroll.selfTest.code.indexOf('import vcfpy'));
      expect(scroll.selfTest.code).toContain("assert vcfpy.__version__ == '0.13.8'");
    }
  });

  it('installs and self-tests legacy Python modules required by the reviewed wheels', () => {
    for (const targetId of ['macos-aarch64-cpu', 'linux-x86_64-cpu']) {
      const directory = resolve(`runtime-boxes/scrolls/pvactools-pvacseq/${targetId}`);
      const manifest = readFileSync(resolve(directory, 'pixi.toml'), 'utf8');
      const scroll = JSON.parse(readFileSync(resolve(directory, 'scroll.json'), 'utf8'));
      expect(manifest).toContain('python-wget = "3.2.*"');
      expect(manifest).toContain('setuptools = "80.9.0.*"');
      expect(manifest).not.toMatch(/^wget\s*=/m);
      expect(scroll.selfTest.imports).toContain('wget');
      expect(scroll.selfTest.imports).toContain('pkg_resources');
    }
  });

  it('keeps the pVACseq anchor tables while pruning the unexposed pVACview application', () => {
    const anchorTables = [
      ...[8, 9, 10, 11].map((length) => `Normalized_anchor_predictions_${length}_mer.tsv`),
      ...[8, 9, 10, 11].map((length) => `mouse_anchor_predictions_${length}_mer.tsv`),
    ];
    const resultSupportFiles = [
      'anchor_and_helper_functions.R',
      'app.R',
      'custom_ui.R',
      'input_processing_functions.R',
      'neofox_ui.R',
      'server.R',
      'styling.R',
      'ui.R',
      'www/anchor.jpg',
      'www/pVACview_logo.png',
      'www/pVACview_logo_mini.png',
    ];
    for (const targetId of ['macos-aarch64-cpu', 'linux-x86_64-cpu']) {
      const scroll = JSON.parse(readFileSync(resolve(
        `runtime-boxes/scrolls/pvactools-pvacseq/${targetId}/scroll.json`,
      ), 'utf8'));
      const dataDirectory = 'source/pvactools-wheel/pvactools/tools/pvacview/data';
      expect(scroll.prunePaths).not.toContain(
        'source/pvactools-wheel/pvactools/tools/pvacview',
      );
      expect(scroll.prunePaths).toContain(
        'source/pvactools-wheel/pvactools/tools/pvacview/run.py',
      );
      for (const table of anchorTables) {
        expect(scroll.prunePaths).not.toContain(`${dataDirectory}/${table}`);
        expect(scroll.selfTest.files).toContain(`${dataDirectory}/${table}`);
      }
      const pvacviewDirectory = 'source/pvactools-wheel/pvactools/tools/pvacview';
      for (const file of resultSupportFiles) {
        expect(scroll.prunePaths).not.toContain(`${pvacviewDirectory}/${file}`);
        expect(scroll.selfTest.files).toContain(`${pvacviewDirectory}/${file}`);
      }
    }
  });

  it('uses the reviewed absolute and relative tolerances for pVACseq score parity', () => {
    const validator = readFileSync(resolve('scripts/validate-pvactools-runtime.mjs'), 'utf8');
    expect(validator).toContain('const ABSOLUTE_TOLERANCE = 0.001;');
    expect(validator).toContain('const RELATIVE_TOLERANCE = 0.001;');
    expect(validator).toContain(
      'ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(right)',
    );
    expect(validator).toContain(
      'tolerances: { absolute: ABSOLUTE_TOLERANCE, relative: RELATIVE_TOLERANCE }',
    );
  });

  it('exposes only the published MHCflurry and pVACseq targets', () => {
    expect(MHCFLURRY_CLASS1_PRESENTATION_METADATA).toMatchObject({
      id: MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
      source: 'runtime-box',
      localOnly: true,
      capabilities: ['mhc-class-i-epitope-prediction'],
      modalities: ['protein'],
      install: {
        runtimeId: 'oncology-mhcflurry-class1-presentation-2-2-1',
        modelCacheSubdir: 'model-cache/mhcflurry-class1-presentation',
        runtimeBox: { boxId: 'mhcflurry-class1-presentation', publishedTargets: [
          {
            target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
            hostEnvironments: ['native'],
            minRamGb: 8,
          },
          {
            target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
            hostEnvironments: ['native', 'windows-wsl2'],
            minRamGb: 8,
          },
        ] },
      },
    });
    expect(MHCFLURRY_CLASS1_PRESENTATION_RELEASE_CANDIDATE_METADATA.install.runtimeBox.publishedTargets)
      .toEqual([
        {
          target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
          hostEnvironments: ['native'],
          minRamGb: 8,
        },
        {
          target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
          hostEnvironments: ['native', 'windows-wsl2'],
          minRamGb: 8,
        },
      ]);
    expect(PVACTOOLS_TOOL_RUNTIME_METADATA.install.runtimeBox.publishedTargets).toEqual([
      {
        target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
        hostEnvironments: ['native'],
        minRamGb: 8,
      },
      {
        target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
        hostEnvironments: ['native', 'windows-wsl2'],
        minRamGb: 8,
      },
    ]);
    expect(PVACTOOLS_RELEASE_CANDIDATE_METADATA).toBe(PVACTOOLS_TOOL_RUNTIME_METADATA);
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
