import type { LiatirAIModelRecord } from '@liatir/core';

const CAPABILITY_HELP: Record<string, string> = {
  'cell-annotation': 'labels cells in a single-cell dataset using known reference cell types.',
  'sequence-embedding': 'turns DNA, RNA, or protein sequences into numeric vectors that other tools can compare or plot.',
  embedding: 'creates numeric vectors that capture similarity between biological inputs.',
  'protein-structure-prediction': 'predicts a 3D protein structure from an amino-acid sequence.',
  'protein-binding': 'can include ligand or binding-related outputs when the backend supports them.',
  'text-generation': 'generates text from a prompt.',
  summarization: 'condenses longer text or results into a shorter explanation.',
  classification: 'assigns labels or classes to inputs.',
};

export const AI_MODEL_INPUT_HELP: Record<string, string> = {
  runInput: 'Inputs are the files, sequences, and settings sent to this AI Model for one run.',
  annDataFile: 'A `.h5ad` single-cell dataset. The model reads the cell expression matrix and returns predicted cell-type labels.',
  celltypistModel: 'The CellTypist reference model used for annotation. Different references are trained for different tissues or immune panels.',
  majorityVoting: 'Smooths CellTypist labels using nearby cells. It can make labels more stable, but may hide small rare populations.',
  molecule: 'The kind of biological sequence in the input. This tells the embedding model how to interpret the letters.',
  maxTokens: 'Maximum sequence length sent to the model. Shorter values run faster; longer values preserve more sequence context.',
  fastaFile: 'A FASTA file from Data. Use this when you want to run the model on one or more saved sequences.',
  inlineSequence: 'A pasted sequence used instead of a file. Useful for quick tests or one short sequence.',
  proteinFasta: 'A FASTA file containing protein amino-acid sequences. Structure models use this as the main input.',
  inlineProteinSequence: 'A pasted amino-acid sequence used instead of a protein FASTA file.',
  ligandSmiles: 'A text formula for a small molecule ligand. Use it when testing protein-ligand binding from a SMILES string.',
  ligandCcd: 'A three-letter Chemical Component Dictionary code for a known ligand. Use either CCD or SMILES, not both.',
  accelerator: 'Choose CPU for compatibility or GPU when supported. GPU can be much faster, but depends on the model and machine.',
  outputFormat: 'The structure file format to write. mmCIF is preferred for modern structure data; PDB is older but widely supported.',
  recyclingSteps: 'How many refinement passes the structure model performs. More passes can improve quality but take longer.',
  diffusionSamples: 'How many candidate structures to sample. More samples can improve the chance of a good result but increase runtime.',
  useMsaServer: 'Uses an online MSA service to find related sequences. This can improve structure prediction, but sends sequence data to the service.',
  predictAffinity: 'Requests binding or affinity outputs when a ligand is provided and the backend supports it.',
  usePotentials: 'Enables extra physical guidance during prediction. It may help some complexes but can change runtime and behavior.',
  noKernels: 'Disables custom CUDA kernels. Use this when GPU kernels are incompatible with the current machine.',
  prompt: 'The instruction sent to the model. It tells the model what kind of answer to produce.',
  context: 'Optional extra text or data the model can use while answering the prompt.',
};

export function aiModelInfo(model: LiatirAIModelRecord): string {
  const capabilityHelp = model.capabilities
    .map((capability) => CAPABILITY_HELP[capability])
    .filter(Boolean);
  const modalities = model.modalities.length > 0
    ? `Works with: ${model.modalities.join(', ')} data.`
    : null;
  const local = model.localOnly
    ? 'Runs locally on this computer after installation.'
    : null;
  const runtime = `Runtime: ${model.runtime.name}${model.runtime.version ? ` ${model.runtime.version}` : ''}.`;
  const hardware = model.hardware?.notes
    ? `Hardware note: ${model.hardware.notes}`
    : model.hardware?.recommendedRamGb != null
      ? `Recommended memory: ${model.hardware.recommendedRamGb} GB RAM.`
      : null;

  return [
    `**${model.name}**`,
    model.description,
    capabilityHelp.length > 0 ? `In simple terms: ${capabilityHelp.join(' ')}` : null,
    modalities,
    local,
    runtime,
    hardware,
  ].filter(Boolean).join('\n\n');
}
