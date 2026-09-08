# Runtime Box ownership boundary

Decided during the Scrollcase extraction; it is the standing division of
ownership between Liatir and the external builder, and every Runtime Box change
is read against it.

## Decision

Scrollcase is an independent Apache-2.0 tool distributed through npm. It owns
the generic box contract, pixi/conda-pack build pipeline, signing envelope and
verification implementation. This repository consumes an exact published
version; it does not contain or develop Scrollcase source.

Liatir owns Runtime Box recipes, model-specific scientific validation,
runner/cost policy, evidence, its private signer adapter and key custody,
Registry/R2 distribution, trust roots, the Rust/Tauri installer, and product
Jobs/Results/provenance. Scrollcase is a build-time tool and never a runtime
dependency of the installed desktop application.

## What was rejected

Keeping the generic builder in-tree. The in-tree `scrollcase` copy was removed
in commit `6b4934e`, because a builder that is developed and consumed in the
same repository cannot prove that the product does not depend on it at runtime.

## Records

- [Scrollcase extraction](../history/scrollcase-extraction-plan.md) — how the
  tool was made independent.
- [Liatir adoption](../history/scrollcase-p5-liatir-adoption.md) — how this
  repository moved onto the published package and retired the local builder.
