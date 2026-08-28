import type { Edge, Node } from '@xyflow/svelte';
import {
  LIATIR_TOOL_RUNTIME_CATALOG,
  NEOANTIGEN_PRIORITIZATION_TOOL_ID,
  PVACTOOLS_RUNTIME_COMPONENT_ID,
} from '@liatir/core';

export const SINGLE_CELL_LIGHTHOUSE_PRESET_ID = 'single-cell-embedding-viewer-v1';
export const TUMOR_NEOANTIGEN_PRESET_ID = 'tumor-variants-neoantigen-candidates-v1';

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  outcome: string;
  instantiate: (idFactory?: () => string) => { nodes: Node[]; edges: Edge[] };
}

/**
 * The first no-code workbench preset. It intentionally leaves only the two scientific choices blank:
 * the user's AnnData file and an installed compatible AI Model. Everything else is wired to the
 * product defaults, including the reusable AnnData and preview handoff to the viewer.
 */
export const singleCellLighthousePreset: PipelinePreset = {
  id: SINGLE_CELL_LIGHTHOUSE_PRESET_ID,
  name: 'Single-cell embedding and preview',
  description: 'Validate an AnnData dataset, create local cell embeddings, and open the result in the Single-cell Viewer.',
  outcome: 'Embedded AnnData, reusable preview CSV, provenance, and an inspectable viewer Result.',
  instantiate(idFactory = () => crypto.randomUUID()) {
    const embeddingNodeId = idFactory();
    const viewerNodeId = idFactory();
    const noteNodeId = idFactory();
    return {
      nodes: [
        {
          id: embeddingNodeId,
          type: 'tool',
          position: { x: 80, y: 120 },
          data: {
            stepId: 'ai-single-cell-embedding',
            label: 'Create cell embeddings',
            inputs: {
              modelId: '',
              inputFile: '',
              species: 'human',
              batchSize: '25',
              maxCsvRows: '500',
            },
          },
        },
        {
          id: viewerNodeId,
          type: 'tool',
          position: { x: 500, y: 120 },
          data: {
            stepId: 'viewer-single-cell',
            label: 'Inspect embeddings',
            inputs: {
              inputFile: `@pipe:${embeddingNodeId}:embeddedAnnData`,
              previewFile: `@pipe:${embeddingNodeId}:embeddingPreviewCsv`,
              embeddingKey: '',
            },
          },
        },
        {
          id: noteNodeId,
          type: 'note',
          position: { x: 80, y: 20 },
          data: {
            text: 'Choose a validated AnnData file and an installed AI Model, then run. Liatir keeps the input immutable and registers the embedded AnnData for reuse.',
            width: 700,
            color: 'emerald',
          },
        },
      ],
      edges: [{
        id: idFactory(),
        source: embeddingNodeId,
        sourceHandle: 'output',
        target: viewerNodeId,
        targetHandle: 'input',
        selectable: false,
      }],
    };
  },
};

/** A one-step outcome preset whose runtime becomes visible only after its first signed release. */
export const tumorNeoantigenPreset: PipelinePreset = {
  id: TUMOR_NEOANTIGEN_PRESET_ID,
  name: 'Tumor variants to neoantigen candidates',
  description: 'Validate a VEP-annotated tumor VCF and prioritize local MHC Class I candidates.',
  outcome: 'Filtered and aggregated pVACseq reports, metrics, candidate FASTA, and offline provenance.',
  instantiate(idFactory = () => crypto.randomUUID()) {
    const toolNodeId = idFactory();
    const noteNodeId = idFactory();
    return {
      nodes: [
        {
          id: toolNodeId,
          type: 'tool',
          position: { x: 100, y: 130 },
          data: {
            stepId: NEOANTIGEN_PRIORITIZATION_TOOL_ID,
            label: 'Prioritize neoantigen candidates',
            inputs: {
              inputVcf: '',
              tumorSample: '',
              normalSample: '',
              alleles: '',
              proximalVcf: '',
              peptideLengths: '8,9,10,11',
              passOnly: 'false',
              topCount: '100',
              threads: '1',
            },
          },
        },
        {
          id: noteNodeId,
          type: 'note',
          position: { x: 100, y: 20 },
          data: {
            text: 'Choose a VEP-annotated tumor VCF, its tumor sample, and HLA Class I alleles. The result contains experimental candidates, not a validated vaccine or therapy.',
            width: 760,
            color: 'rose',
          },
        },
      ],
      edges: [],
    };
  },
};

const pvactoolsPublished = LIATIR_TOOL_RUNTIME_CATALOG.some(
  (runtime) => runtime.id === PVACTOOLS_RUNTIME_COMPONENT_ID
    && runtime.install.runtimeBox.publishedTargets.length > 0,
);

export const pipelinePresets: PipelinePreset[] = [
  singleCellLighthousePreset,
  ...(pvactoolsPublished ? [tumorNeoantigenPreset] : []),
];
