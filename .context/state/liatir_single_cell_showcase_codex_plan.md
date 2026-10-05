# Liatir Scientific Showcase — Single-Cell Foundation Models

## Goal

Use **Liatir itself** to execute a reproducible scientific showcase answering:

> **How useful are zero-shot single-cell foundation-model embeddings compared with established baselines when biological quality, batch robustness, and local computational cost are considered together?**

This is not only an implementation task. **Complete the study end-to-end and produce real numerical results and reproducible artifacts.** Do not stop after writing code or a plan.

Work in the existing `Liatir/liatir-app` architecture. Reuse Liatir Runtime Boxes, Jobs, Results, provenance, pipelines, viewers, and telemetry where they already exist. Do not create parallel infrastructure unless the existing system cannot support the requirement.

---

## Models and baselines

Evaluate the following representations.

### Foundation models
- **Geneformer V1 10M**
- **scGPT whole-human**
- **UCE 4-layer**

Use the existing signed Liatir Runtime Boxes wherever possible.

### Baselines
- **HVG + PCA**
- **Harmony**
- **scVI**

Treat scVI separately in the interpretation because it is trained on the evaluation dataset rather than used as a zero-shot pretrained representation.

All methods must feed into the same downstream evaluation code.

---

## Datasets

Use exactly these two primary public datasets.

### 1. PBMC 12k

Use the dataset exposed by `scvi.data.pbmc_dataset()` or the canonical upstream equivalent if that loader changes.

Purpose:
- cell-type representation quality;
- cross-batch robustness;
- manageable local benchmark size.

Expected scale: roughly 12k cells and two batches.

### 2. scIB Pancreas

Use the standard public **scIB pancreas integration benchmark** dataset with cell-type labels and multiple batches / sequencing technologies.

Purpose:
- stronger batch-integration test;
- preservation of biological identity across heterogeneous technologies.

Record the exact upstream source, version, URL/accession, file checksum, cell count, gene count, labels used, and batch field in the dataset manifest.

Do not silently substitute another dataset. If an upstream source has moved, use the canonical successor and document the change.

---

## Preprocessing and fairness

Create one shared preprocessing path per dataset and reuse it wherever model requirements permit.

Requirements:

- preserve raw counts;
- record every filtering threshold;
- use deterministic random seeds;
- record gene identifier type and any mapping performed;
- never remove cells differently for one method merely to improve its score;
- where a model requires different gene identifiers or input formatting, record the exact transformation;
- evaluate methods on the largest common valid cell set where possible;
- explicitly report exclusions or incompatibilities.

Avoid data leakage. Any supervised downstream classifier must use a fixed stratified train/test split created once per dataset and reused across representations.

Foundation models must be evaluated **zero-shot**: do not fine-tune them on the benchmark datasets.

---

## Evaluation

For every dataset × method combination, generate an embedding and evaluate it with the same analysis pipeline.

### Biological / representation metrics

At minimum compute:

- **ARI** for clustering vs. known cell labels;
- **NMI** for clustering vs. known cell labels;
- **cell-type silhouette score**;
- **kNN cell-type classification macro-F1** using the shared fixed split;
- **logistic-regression cell-type classification macro-F1** using the shared fixed split.

### Batch metrics

Where the dataset contains meaningful batch labels, compute:

- **batch silhouette / ASW-batch**;
- **graph connectivity** by biological label;
- at least one established neighborhood-mixing metric available through `scib-metrics`, `scIB`, or an equivalent maintained implementation.

Do not invent an opaque combined “winner score”. Keep the individual metrics visible.

### Computational metrics

For every run record:

- wall-clock runtime;
- peak process RAM / RSS;
- peak GPU or Metal memory where measurable;
- CPU/GPU/Metal execution target;
- model/runtime disk footprint;
- embedding dimensions and output size;
- host hardware and OS;
- Runtime Box/model version and immutable identifier.

If a metric cannot be measured reliably on a platform, store `null` plus a reason instead of guessing.

---

## Execution strategy

1. Inspect the current Liatir architecture and existing single-cell / Runtime Box paths.
2. Implement the benchmark as a **first-class Liatir showcase**, not a detached research script.
3. Make the smallest PBMC end-to-end path work first.
4. Run and debug **PCA + one foundation model** until real results are produced.
5. Add Harmony, scVI, Geneformer, scGPT, and UCE.
6. Run the complete PBMC benchmark.
7. Run the complete pancreas benchmark.
8. Add result visualization and export.
9. Run validation / reproduction checks.
10. Finish only after the study has produced real result artifacts.

Do not silently skip a model because it is difficult to run.

If a model is genuinely impossible on the available host:
- diagnose the exact cause;
- preserve logs;
- record the failed configuration in the result manifest;
- continue the other runs;
- clearly mark the missing result as a blocker rather than synthesizing a value.

---

## Liatir showcase

Add a discoverable showcase/workflow inside Liatir that a user can run without writing code.

The UI does not need to be elaborate, but it must allow a user to:

1. select PBMC or Pancreas;
2. select methods to run;
3. launch the benchmark;
4. see progress through normal Liatir Jobs/Results;
5. inspect final biological and compute metrics;
6. view at least:
   - UMAPs colored by cell type;
   - UMAPs colored by batch;
   - method comparison table;
   - biological-performance vs. runtime plot;
   - biological-performance vs. peak-memory plot;
7. export the complete result bundle.

Use existing Liatir viewers/components where practical.

---

## Required artifacts

Store benchmark-specific work under a clearly named repository directory such as:

```text
showcases/single-cell-foundation-benchmark/
```

The final run must produce an artifact layout equivalent to:

```text
protocol.md
datasets/
  manifest.json
runs/
  <dataset>/
    <method>/
      config.json
      environment.json
      metrics.json
      telemetry.json
      provenance.json
      logs/
results/
  summary.csv
  summary.json
  biological_metrics.csv
  batch_metrics.csv
  compute_metrics.csv
  figures/
report/
  results.md
  limitations.md
  reproduction.md
```

`summary.csv` and `summary.json` must contain one row/object per dataset × method and be sufficient for independent downstream analysis.

Keep raw/generated large matrices out of Git when inappropriate; reference them through reproducible paths/checksums.

---

## Scientific integrity rules

- Do not optimize preprocessing separately for a preferred model.
- Do not cherry-pick favorable metrics.
- Do not claim that a method is “better” unless the measured results support the specific statement.
- Separate **observations** from **interpretation**.
- Record failures and negative results.
- Do not fabricate missing measurements.
- Preserve exact versions, seeds, dataset provenance, model provenance, and hardware information.
- Make the benchmark rerunnable from the documented inputs.

The goal is a credible reproducible showcase, not a predetermined conclusion.

---

## Completion criteria

The task is complete only when:

- both datasets have been processed;
- every feasible method has actually run;
- real numerical biological, batch, and compute results exist;
- failures, if any, are documented with logs and causes;
- `summary.csv` and `summary.json` are complete;
- figures have been generated;
- the Liatir showcase can launch and display the benchmark;
- reproduction instructions have been tested;
- repository tests relevant to the changed areas pass;
- [report/results.md](../../showcases/single-cell-foundation-benchmark/report/results.md) summarizes the measurements **without overstating conclusions**.

At the end, provide a concise execution summary containing:

1. commit(s) created;
2. datasets and exact versions used;
3. methods successfully completed;
4. failed/blocked runs and causes;
5. paths to `summary.csv`, `summary.json`, figures, and report;
6. headline numerical results only — no speculative scientific interpretation.
