import type { Edge, Node } from '@xyflow/svelte';

export const SINGLE_CELL_LIGHTHOUSE_PRESET_ID = 'single-cell-embedding-viewer-v1';

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

export const pipelinePresets: PipelinePreset[] = [singleCellLighthousePreset];
