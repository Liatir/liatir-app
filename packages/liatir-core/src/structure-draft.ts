import { parseLiatirComplexSpecDraftJson } from './complex-spec.js';
import {
  BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID,
  BOLTZ_2_MODEL_ID,
  PROTEIN_LIGAND_AFFINITY_TOOL_ID,
  isLiatirStructureModelId,
  type LiatirStructureModelId,
  type LiatirStructureMsaSelection,
} from './structure-simulation.js';

export type LiatirStructureToolId =
  | typeof BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID
  | typeof PROTEIN_LIGAND_AFFINITY_TOOL_ID;

/** A draft owns unfinished text; execution inputs are a separate immutable snapshot. */
export interface LiatirStructureToolDraft {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  toolId: LiatirStructureToolId;
  label: string;
  modelId: LiatirStructureModelId;
  specJson: string;
  advancedJson: string;
  advanced: boolean;
  msa: LiatirStructureMsaSelection;
  seed: string;
  modelCount: string;
  executionRunId: string | null;
}

export function createLiatirStructureToolDraft(input: {
  id: string;
  workspaceId: string;
  toolId: LiatirStructureToolId;
}): LiatirStructureToolDraft {
  const affinity = input.toolId === PROTEIN_LIGAND_AFFINITY_TOOL_ID;
  return {
    schemaVersion: 1, ...input,
    label: affinity ? 'New affinity prediction' : 'New structure prediction',
    modelId: BOLTZ_2_MODEL_ID,
    specJson: JSON.stringify({
      schemaVersion: 1, kind: 'liatir-complex-spec',
      entities: [
        { id: 'protein', type: 'protein', sequence: '' },
        ...(affinity ? [{ id: 'ligand', type: 'ligand', smiles: '' }] : []),
      ],
    }),
    advancedJson: '', advanced: false,
    msa: { singleSequenceEntityIds: [], lowerAccuracyAccepted: false },
    seed: '17', modelCount: '1', executionRunId: null,
  };
}

/** Storage is untrusted. Reject malformed records without erasing their original bytes. */
export function parseLiatirStructureToolDraft(value: unknown): LiatirStructureToolDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (draft.schemaVersion !== 1 || typeof draft.id !== 'string' || !draft.id
    || typeof draft.workspaceId !== 'string' || !draft.workspaceId
    || ![BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID, PROTEIN_LIGAND_AFFINITY_TOOL_ID].includes(draft.toolId as LiatirStructureToolId)
    || typeof draft.modelId !== 'string' || !isLiatirStructureModelId(draft.modelId)
    || typeof draft.label !== 'string' || typeof draft.specJson !== 'string'
    || !parseLiatirComplexSpecDraftJson(draft.specJson).spec
    || typeof draft.advancedJson !== 'string' || typeof draft.advanced !== 'boolean'
    || typeof draft.seed !== 'string' || typeof draft.modelCount !== 'string'
    || (draft.executionRunId !== null && typeof draft.executionRunId !== 'string')) return null;
  if (!draft.msa || typeof draft.msa !== 'object' || Array.isArray(draft.msa)) return null;
  const msa = draft.msa as Record<string, unknown>;
  if (!Array.isArray(msa.singleSequenceEntityIds)
    || !msa.singleSequenceEntityIds.every((id) => typeof id === 'string')
    || typeof msa.lowerAccuracyAccepted !== 'boolean') return null;
  return value as LiatirStructureToolDraft;
}
