/**
 * Plain-language explanations of AI Models and their inputs.
 *
 * Liatir is for non-technical users first, and that principle has to survive contact with the AI
 * screens — where the vocabulary ("embedding", "masked-LM", "recycling steps") is otherwise
 * impenetrable to a biologist who simply wants to annotate their cells.
 *
 * So every capability and every input field has a sentence here that says what it *does*, in terms
 * of the user's work rather than the model's architecture. Note the honesty in some of these: the
 * MSA-server help says the sequence leaves the machine, and the majority-voting help admits it can
 * hide rare populations. A help text that only sells the feature would be worse than none.
 */
import type { LiatirAIModelRecord } from '@liatir/core';

/** What a model *does*, in one sentence, for each capability it declares. */
const CAPABILITY_HELP: Record<string, string> = {
  'cell-annotation': 'labels cells in a single-cell dataset using known reference cell types.',
  'single-cell-embedding': 'turns cells into numeric vectors that can be compared, clustered, or visualized.',
  'batch-correction': 'helps align related single-cell datasets when technical batch effects make them hard to compare.',
  'perturbation-prediction': 'estimates how cells or gene programs may change after a simulated perturbation.',
  'gene-network-inference': 'helps inspect relationships between genes or regulatory programs.',
  'sequence-embedding': 'turns DNA, RNA, or protein sequences into numeric vectors that other tools can compare or plot.',
  'regulatory-prediction': 'predicts or scores regulatory activity from genomic sequence windows.',
  'variant-effect-scoring': 'compares reference and alternate sequence windows to estimate how much a variant changes model representation.',
  embedding: 'creates numeric vectors that capture similarity between biological inputs.',
  'protein-structure-prediction': 'predicts a 3D protein structure from an amino-acid sequence.',
  'protein-binding': 'can include ligand or binding-related outputs when the backend supports them.',
  'text-generation': 'generates text from a prompt.',
  summarization: 'condenses longer text or results into a shorter explanation.',
  classification: 'assigns labels or classes to inputs.',
};

/**
 * Per-input help, keyed by the field name a tool form uses. Several entries state the *file format*
 * and where the data must live inside it (e.g. gene symbols in `var_names`) — because a wrong
 * column is the single most common reason a single-cell run fails, and it is much cheaper to say so
 * up front than to let the model reject the file.
 */
export const AI_MODEL_INPUT_HELP: Record<string, string> = {
  runInput: 'Inputs are the files, sequences, and settings sent to this AI Model for one run.',
  annDataFile: 'A `.h5ad` single-cell dataset. The model reads the cell expression matrix and returns predicted cell-type labels.',
  uceAnnDataFile: 'A `.h5ad` single-cell dataset for UCE. The `.X` matrix should contain scRNA-seq counts and `var_names` should contain gene symbols.',
  geneformerAnnDataFile: 'A human `.h5ad` single-cell dataset with raw counts in `.X`. Put Ensembl gene IDs in `var["ensembl_id"]`, or use Ensembl IDs as `var_names`.',
  scgptAnnDataFile: 'A human `.h5ad` single-cell dataset with raw counts in `.X`. Put gene symbols in `var["gene_name"]`, `var["feature_name"]`, or `var_names`.',
  uceSpecies: 'The organism used to match genes against UCE protein-embedding assets. Choose the species that matches the AnnData file.',
  uceBatchSize: 'Number of cells processed together. Lower values use less memory; higher values can be faster on supported accelerators.',
  uceCsvRows: 'How many cells to export to the lightweight CSV preview. The full model-specific embedding matrix is stored in the output AnnData file.',
  celltypistModel: 'The CellTypist reference model used for annotation. Different references are trained for different tissues or immune panels.',
  majorityVoting: 'Smooths CellTypist labels using nearby cells. It can make labels more stable, but may hide small rare populations.',
  molecule: 'The kind of biological sequence in the input. This tells the embedding model how to interpret the letters.',
  maxTokens: 'Maximum sequence length sent to the model. Shorter values run faster; longer values preserve more sequence context.',
  fastaFile: 'A FASTA file from Data. Use this when you want to run the model on one or more saved sequences. If both file and inline sequence are provided, the file is used.',
  inlineSequence: 'A pasted sequence used only when no file is selected. Useful for quick tests or one short sequence.',
  regulatoryReference: 'A FASTA sequence used as the genomic context for regulatory prediction. Long-context models pad short sequences with N.',
  regulatoryInlineSequence: 'A pasted DNA sequence used only when no FASTA file is selected. Useful for quick checks with short examples.',
  variantVcf: 'An optional VCF file. When provided, Liatir compares reference and alternate windows for each selected variant.',
  outputHead: 'The model output group to read. Use Human for human-trained targets and Mouse only when the model includes mouse outputs.',
  targetIndex: 'The numeric output track to inspect. Each model has many tracks; index 0 is a safe first test.',
  windowStart: 'The 1-based genomic coordinate of the first base in the provided reference window. Use 1 for demo sequences.',
  maxVariants: 'Maximum variants to score from the VCF. Smaller values keep heavy models practical during testing.',
  proteinFasta: 'A FASTA file containing protein amino-acid sequences. If both file and inline protein sequence are provided, the file is used.',
  inlineProteinSequence: 'A pasted amino-acid sequence used only when no protein FASTA file is selected.',
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

/**
 * Builds the description panel shown for a model: what it is, what it does in plain terms, what it
 * needs, and — for a preview model — why its controls are disabled.
 *
 * Every section is optional and dropped when empty, so the panel never shows a heading with nothing
 * under it. The output is markdown, joined by blank lines.
 */
export function aiModelInfo(model: LiatirAIModelRecord): string {
  // Unknown capabilities are filtered out rather than rendered as a gap, so adding a capability to
  // the registry without a help sentence degrades quietly instead of showing "undefined".
  const capabilityHelp = model.capabilities
    .map((capability) => CAPABILITY_HELP[capability])
    .filter(Boolean);
  const modalities = model.modalities.length > 0
    ? `Works with: ${model.modalities.join(', ')} data.`
    : null;
  const local = model.localOnly
    ? model.releaseStage === 'preview'
      ? 'Planned as a local runtime after its managed model box is validated.'
      : 'Runs locally on this computer after installation.'
    : null;
  const stage = model.releaseStage === 'preview'
    ? 'Status: preview. Install and run controls are disabled until the runtime and model assets are validated.'
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
    stage,
    local,
    runtime,
    hardware,
  ].filter(Boolean).join('\n\n');
}
