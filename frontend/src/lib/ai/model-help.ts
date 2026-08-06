/**
 * Plain-language explanations for the Runtime Box AI Models and their shared tool inputs.
 */
import type { LiatirAIModelRecord } from '@liatir/core';

/** What a model *does*, in one sentence, for each capability it declares. */
const CAPABILITY_HELP: Record<string, string> = {
  'single-cell-embedding': 'turns cells into numeric vectors that can be compared, clustered, or visualized.',
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
};

/**
 * Builds the description panel shown for a model: what it is, what it does in plain terms, what it
 * needs, and which signed runtime contains it.
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
    ? 'Runs locally on this computer after its signed Runtime Box is installed.'
    : null;
  const runtime = `Runtime: ${model.runtime.name}${model.runtime.version ? ` ${model.runtime.version}` : ''}.`;
  const hardware = model.hardware?.notes
    ? `Hardware note: ${model.hardware.notes}`
    : model.hardware?.recommendedRamGb != null
      ? `Recommended memory: ${model.hardware.recommendedRamGb} GB RAM.`
      : null;
  const licenseComponents = model.license?.components
    ?.map((component) => `${component.scope === 'source-code' ? 'Code' : component.scope === 'model-assets' ? 'Model assets' : 'Runtime'}: ${component.name}.`)
    .join(' ');
  const license = model.license
    ? `License: ${licenseComponents || model.license.name}.`
    : null;

  return [
    `**${model.name}**`,
    model.description,
    capabilityHelp.length > 0 ? `In simple terms: ${capabilityHelp.join(' ')}` : null,
    modalities,
    local,
    runtime,
    hardware,
    license,
  ].filter(Boolean).join('\n\n');
}
