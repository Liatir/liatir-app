/** The no-code study's shared launch contract. Heavy dependencies remain optional. */
import { GENEFORMER_V1_10M_MODEL_ID, SCGPT_WHOLE_HUMAN_MODEL_ID, UCE_4LAYER_MODEL_ID } from './ai-catalog.js';
export const LIATIR_SINGLE_CELL_STUDY_ID = 'single-cell-foundation-benchmark';
/** Cautious local execution after a host resource failure; never relaxed automatically. */
export const LIATIR_SINGLE_CELL_STUDY_LIMITS = {
  maxRssBytes: 2 * 1024 ** 3,
  minAvailableBytes: 2 * 1024 ** 3,
  minDiskBytes: 4 * 1024 ** 3,
  maxSwapGrowthBytes: 256 * 1024 ** 2,
} as const;
export const LIATIR_SINGLE_CELL_STUDY_DATASETS = [
  { id: 'pbmc', label: 'PBMC 12k', description: 'Blood immune cells from two experimental batches.' },
  { id: 'pancreas', label: 'scIB Pancreas', description: 'Pancreatic cells measured with different sequencing technologies.' },
] as const;
export const LIATIR_SINGLE_CELL_STUDY_METHODS = [
  { id: 'pca', label: 'HVG + PCA', modelId: null },
  { id: 'geneformer', label: 'Geneformer V1 10M', modelId: GENEFORMER_V1_10M_MODEL_ID },
  { id: 'harmony', label: 'Harmony', modelId: null },
  { id: 'scvi', label: 'scVI', modelId: null },
  { id: 'scgpt', label: 'scGPT whole-human', modelId: SCGPT_WHOLE_HUMAN_MODEL_ID },
  { id: 'uce', label: 'UCE 4-layer', modelId: UCE_4LAYER_MODEL_ID },
] as const;
export type LiatirSingleCellStudyDataset = typeof LIATIR_SINGLE_CELL_STUDY_DATASETS[number]['id'];
export type LiatirSingleCellStudyMethod = typeof LIATIR_SINGLE_CELL_STUDY_METHODS[number]['id'];
export interface LiatirSingleCellStudyRequest {
  dataset: LiatirSingleCellStudyDataset;
  methods: LiatirSingleCellStudyMethod[];
  /** A small stability check, visibly separate from the complete scientific study. */
  stabilityCheck?: boolean;
  /** Reuse only verified completed stages of this workspace's previous run. */
  resumeFromRunId?: string;
}
