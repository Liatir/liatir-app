# Predictive Genomics Research Notes

Predictive genomics is not a current Liatir product capability. The earlier
Nucleotide Transformer, Enformer, Basenji2, and Borzoi integrations and their AI
Tools were removed during the Runtime Box-only cutover on 2026-07-22.

This page retains only the scientific requirements for a possible future
program. It must not be used as evidence that any predictive-genomics model is
installable or supported.

## Required future contract

A future variant-effect or regulatory-prediction Tool must make these inputs
explicit:

- reference assembly and FASTA identity;
- sequence window and coordinate convention;
- VCF reference/alternate allele validation;
- model output head and target meaning;
- preprocessing and padding behavior;
- bounded variant counts and memory/runtime expectations.

Its outputs should include typed score tables, BED tracks where scientifically
valid, JSON summaries, warnings, Jobs, Results, and exact provenance.

## Runtime Box entry gate

No candidate may enter the product catalog until it has:

1. reviewed redistribution rights for source, dependencies, and weights;
2. an exact target-specific recipe and dependency lock;
3. a model-specific scientific validator with a bounded golden fixture;
4. signed immutable publication and channel promotion;
5. native install, run, Result, provenance, replacement, rollback, removal, and
   cleanup evidence;
6. an honest support matrix.

The previous experimental implementations do not satisfy this gate and must not
be restored as a shortcut.
