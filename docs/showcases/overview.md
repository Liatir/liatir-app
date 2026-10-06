---
title: Liatir Scientific Showcases
description: Scientific studies carried out with Liatir, with measured results, limitations, provenance and reproducibility artifacts.
---

# Liatir Scientific Showcases

Scientific Showcases document studies carried out with Liatir. Each study starts
with a scientific question and reports its methods, measured results, computational
costs and limitations. Failed or unavailable configurations remain part of the
record.

The documentation gives a readable account of each study. The repository holds
the technical package: protocol, source, results, figures and validation evidence.
Large data and reproducibility archives are distributed separately, with their
artifact record linked from the study.

## Single-cell foundation models vs established baselines

[Read the study](/showcases/single-cell-foundation-benchmark)

Do pretrained models preserve cell types and mix experimental batches better
than established methods? This study compares Geneformer and scGPT with PCA,
Harmony and scVI on two human single-cell datasets: PBMC and Pancreas. UCE was
requested but remained blocked, with both causes retained.

The measured results did **not** show a uniform advantage for pretrained
representations. scGPT was competitive on PBMC, while established approaches
remained particularly strong on Pancreas. Two datasets and one random seed do
not establish general superiority.

- [Technical study package](https://github.com/Liatir/liatir-app/tree/main/showcases/single-cell-foundation-benchmark)
- [Complete reproducibility artifacts: Zenodo DOI](https://doi.org/10.5281/zenodo.23187931)

## Reading a showcase

Read the limitations alongside the results. A figure is an aid to inspection;
the underlying measurements and their definitions are the evidence. Resource
limits, hardware, missing results and the scope of each verification are reported
so readers can judge what the study supports and reproduce the saved analysis.
