# Reproduce the study in Liatir

Use Liatir's visual interface to run both datasets, inspect the results and export
the study.

## Prepare the study

Choose a workspace for the study. Through **AI Models**, make the available
Geneformer V1 10M, scGPT whole-human and UCE 4-layer models ready to use. Liatir
prepares PCA, Harmony and scVI as part of the study and handles the initial
software and dataset downloads. Once the required resources are installed and
cached, analysis runs locally.

The published study used Geneformer **1.0.0-beta.2**, scGPT **0.2.5-beta.2** and
UCE **1.0.0-beta.2**. Compare the versions recorded with your results against these
versions when interpreting a new run.

## Run both complete datasets

1. Open the single-cell study in **Tools** and select the PBMC dataset.
2. Include the six study methods: PCA, Harmony, scVI, Geneformer, scGPT and UCE.
3. Choose the complete dataset rather than the small-sample stability check. Use
   an execution setting supported by your computer and installed models.
4. Start the study. Follow its progress and any diagnostics in **Jobs**.
5. When it finishes, inspect the measurements and figures in **Results** and export
   the study.
6. Repeat for Pancreas with the same scientific settings.

The full comparison uses **11,990 PBMC cells** and **16,382 Pancreas cells**. The
small-sample stability check is a diagnostic rather than the published comparison.
The study presets follow the fixed preparation and classification split in the
[protocol](../protocol.md).

An unavailable model or an exceeded resource limit is recorded with its reason
and missing scores. A blocked UCE configuration is not a measured biological
result. Each dataset retains its own saved study and execution history.

## Inspect and compare

In **Results**, consider cell-type preservation and batch mixing alongside the
figures, runtime, memory and diagnostics. These describe different properties;
keep the individual measurements visible rather than treating one score or picture
as an overall ranking.

Compare your run with the [published results](results.md) and read the
[limitations](limitations.md). A new execution records its own hardware, model
versions and settings. Repeating the study does not guarantee identical timings,
and the original Mac and PC measurements do not establish a same-computer speed
ranking.

## Continue saved work

Use Liatir's saved-study options to continue a study already in your workspace.
The app checks that the recorded inputs, settings and saved results still match
before reusing completed work. Reused measurements preserve their original
execution history.

The complete Zenodo bundle preserves the original two-dataset scientific record;
it is not a single study that can be imported and resumed in one action.

## Original artifacts and citation

Download the complete approximately **1.8 GB** reproducibility archive from
[10.5281/zenodo.23187931](https://doi.org/10.5281/zenodo.23187931).
It retains the original data, saved results, figures and evidence. Use the record's
citation metadata when citing those artifacts.

GitHub tracks the protocol, source, small result tables, figures and validation
records. Large data and the complete archive remain outside Git. The original
completed study's [validation evidence](reproduction-validation.md) is retained
alongside the instructions for running the study in the app.
