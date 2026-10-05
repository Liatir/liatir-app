# Single-cell representation study, protocol 2

Scientific parameters frozen before inspecting scores, seed 23. Six methods on the two datasets in the
authoritative plan. No model or metric is selected using its observed score.
The original Mac resource regime below remains historical. On 2026-10-05 the
user explicitly approved a PC resource amendment: local NVIDIA CUDA scGPT,
six numerical threads and model batches of 16, a 16 GiB process-family ceiling,
6 GiB minimum WSL available memory, 8 GiB minimum disk headroom, unchanged
256 MiB maximum host swap growth and a 6 GiB whole-GPU memory ceiling. The
Windows-owned WSL cgroup refuses swap and is capped at 16 GiB. Scientific inputs,
seeds, model weights, tokenization and evaluation definitions are unchanged.
Use the explicit NVIDIA option in Liatir; it never changes resources automatically.
A bounded real-data diagnostic must verify CUDA, memory headroom, batch behavior
and interruption/resume before the full new PC calculation. Reused Mac stages
retain their own original limits and measurements; they are not rerun or relabeled.
CPU partial checkpoints cannot be merged into a CUDA checkpoint with a different
identity. Preserve those attempts and their costs separately from the new GPU run.

Protocol 2 changes execution resources after two macOS watchdog panics during the
initial Metal attempts: CPU only, one thread, model batch size one. No biological
scores existed at the time of this change. The old attempts are retained as failures.

- **PBMC:** `scvi.data.pbmc_dataset()` from scvi-tools 1.3.3, the canonical
  10x PBMC8k + PBMC4k data and original scVI annotations. The loader's supplied
  3,346-gene subset is retained, including its historical gene-selection limitation.
- **Pancreas:** the scIB integration benchmark distributed by the official scvi-tools
  reference-mapping tutorial as Figshare file 24539828, downloaded through
  `https://api.figshare.com/v2/file/download/24539828`. The newer scverse URL
  `https://exampledata.scverse.org/scvi-tools/pancreas.h5ad` returned HTTP 403 on
  2026-10-04; the original official tutorial source is retained, not a new dataset.
  Original tutorial revision: `scverse/scvi-tutorials@c67d87491a6dd0fcc9429c2038b225507c5f3ed2`.
  SHA-256: `97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c`.
  Use `layers['counts']`,
  `obs['celltype']`, and `obs['tech']`. Do not reconstruct counts from logged values.
  This source layer contains 23,809,035 non-integer entries at tolerance 1e-4;
  preserve them unchanged. It is upstream count/quantification data, not uniformly
  integer UMI counts. This limits count-model assumptions and is reported explicitly.
  After the first full pancreas attempt rejected these known fractional values,
  the production input guard gained an explicit canonical-source attestation:
  source SHA-256, supplied layer and prepared-file SHA-256 must match before
  accepting fractions. Default arbitrary-file rejection remains. This changes
  validation only; rank encoding, quantile bins and the source values are unchanged.
- Keep the original count inputs checksummed. Remove only cells with zero total
  counts or missing labels/batches. No added mitochondrial or gene-count threshold.
  Store exact exclusions. Stable row-plus-barcode IDs distinguish repeated barcodes.
- Gene symbols come from source annotations. PBMC Ensembl IDs come from the 10x
  source; pancreas uses exact unique symbol matches from GENCODE human v47 basic,
  GRCh38. Unmapped or ambiguous genes are not guessed. Model vocabulary selection
  is recorded; it is not a scoring-based filter.
- Split once per dataset: stratified 80% train / 20% test, seed 23. Supervised
  classifiers see labels only in the training partition. This is a transductive
  representation study: unsupervised preprocessing and scVI may use all cells.
- **HVG + PCA:** normalize to 10,000 counts, log1p, select 2,000 highly variable
  genes using Scanpy `seurat` flavor with batch-aware selection, scale with clipping
  at 10, 50 principal components, ARPACK, seed 23.
- **Harmony:** the same HVG/PCA computation followed by harmonypy 0.0.10,
  batch covariate, seed 23, 10 maximum Harmony iterations, other library defaults.
- **scVI:** the same selected genes' raw counts, batch covariate, negative-binomial
  likelihood, 2 layers, 128 hidden units, 30 latent dimensions, 100 epochs,
  batch size 128, deterministic CPU training, no early stopping. Save trained weights.
  To respect the memory budget, raw counts are read only for the selected scVI
  columns; PCA/Harmony do not retain an unused raw-count copy. The selected genes,
  normalized values and reference PCA coordinates must match the original path.
- **Geneformer V1 10M, scGPT whole-human, UCE 4-layer:** the production
  Liatir inference scripts inside their individually verified signed Runtime Boxes.
  No fine-tuning. Global seeds 23; scGPT's unchanged production tokenizer samples
  overlong cells using a generator seeded with each zero-based input cell index.
  Cell batch size one; CPU only, one numerical thread. The signed box identity still
  names its distributed target; the actual measured execution target is CPU.
  Model transformations and immutable identities accompany every run.
  Geneformer's production runner now calls the loaded model's encoder directly,
  avoiding the unused vocabulary-prediction tensor. The stability check compares
  its first cell's hidden states with the original full model and requires exact
  equality before proceeding; tokenization and pooling are unchanged.
- Evaluate the largest intersection of valid cells across successfully completed
  requested methods; preserve original order and fixed split. Export all exclusions.
- Cluster with k-means, K equal to the supplied label count, 20 initializations,
  seed 23. Report ARI and NMI without resolution or parameter searches.
- Report exact Euclidean cell-label silhouette and global batch silhouette.
  ASW-batch is the equally weighted mean across eligible biological labels of
  `mean(1 - abs(silhouette(batch)))`, excluding labels with fewer than two batches.
- Classification: Euclidean 15-neighbor uniform-vote kNN; logistic regression with
  C=1, maximum 2,000 iterations, training-only feature standardization. Macro-F1
  weights labels equally; report convergence warnings, never suppress them.
- Batch neighborhood mixing: scib-metrics 0.5.7 normalized iLISI, 90 Euclidean
  neighbors, perplexity 30. Graph connectivity: mean largest strongly connected
  component fraction per label in the directed 15-neighbor graph.
- UMAP: all common cells, Euclidean geometry, 15 neighbors, min_dist 0.3, seed 23.
  Generate both cell-label and batch-color plots. Do not compute scores on UMAP.
- Measure representation wall time (imports, preprocessing, weights, inference or
  training, serialization), OS process peak RSS, runtime/model disk footprint and
  compact embedding dimensions/bytes. Evaluation and UMAP time are separate.
  Downloads and environment preparation are not part of representation time.
  Report Metal peak as null: PyTorch exposes current allocation, not a reliable peak.
- An independent process monitors each computation every 250 ms: process-tree RSS
  at most 2 GiB, host available memory at least 2 GiB, free disk at least 4 GiB,
  swap growth at most 256 MiB. It terminates that computation and records the reason
  on a breach. This is an operating safeguard, not a scientific filtering rule.
  Guarded time includes monitoring overhead; process peak telemetry remains the OS
  worker high-water mark. scikit-learn pairwise working memory is capped at 64 MiB.
  Before loading UCE, read only its checkpoint archive's storage sizes. The pinned
  loader materializes every tensor without memory mapping; refuse if these alone
  exceed the process budget. This follows an observed guard stop during UCE loading.
- A stability diagnostic uses the first eight retained cells of each label and is
  explicitly marked as such. It never replaces the full-dataset result. Completed
  method checkpoints may be reused only with matching code, protocol, source-count
  checksum, embedding checksum and fixed classification split. Their original times
  and provenance remain attached; new execution is not claimed for reused stages.
- One run per configuration. This study provides observations, not uncertainty
  estimates or a combined winner score. Record failures, package versions, exact
  source/data hashes and hardware. Public pretraining overlap is not ruled out.

Primary specifications: [scVI PBMC loader](https://github.com/scverse/scvi-tools/blob/1.3.3/src/scvi/data/_built_in_data/_pbmc.py),
[canonical pancreas](https://docs.scvi-tools.org/en/latest/tutorials/notebooks/multimodal/scarches_scvi_tools.html),
[scib-metrics](https://scib-metrics.readthedocs.io/en/stable/api.html).
