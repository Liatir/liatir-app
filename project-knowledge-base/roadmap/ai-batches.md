# AI Model Integration Ledger

This ledger records the current product boundary for AI Models and AI Tools.
The canonical Runtime Box build and publication evidence remains in
[Runtime Box CI foundation](./runtime-box-ci-foundation.md).

## Product rule

Liatir is a cross-platform product, so an AI Model is not release-ready merely
because one Runtime Box exists. Each model must cover every native product
target on which its license, upstream framework, and hardware requirements make
execution reasonably possible. Missing implementation work is not a platform
exception.

An exception requires a recorded upstream or infrastructure blocker, its exact
evidence, and honest product compatibility messaging. CPU and accelerator
support are evaluated separately: a model may legitimately support CPU on all
desktop operating systems while supporting CUDA only on Linux, for example, if
the upstream framework cannot provide native Windows CUDA or macOS Metal.

Before a model is classified as release-ready it therefore needs:

- legally redistributable code, weights, and supporting assets;
- signed and published Runtime Boxes for every feasible native target;
- reviewed scientific and product-lifecycle evidence on every such target;
- an explicit unsupported-target record for every genuine exception.

There is no legacy installer or mock-model exception. During pre-release
development a partially expanded Runtime Box model may remain in the catalog so
that completed targets can be tested, but the support debt must stay visible and
must close before the model is treated as generally available.

## Current product catalog

| AI Model | AI Tool | Published native support | Cross-platform state |
| --- | --- | --- | --- |
| Geneformer V1 10M | Single-cell Embedding | macOS arm64 Metal; Linux x86_64 CPU/CUDA 12.4; Windows x86_64 CPU | Current native matrix complete; Windows CUDA remains a documented runner blocker |
| scGPT Whole-human | Single-cell Embedding | macOS arm64 Metal | Pre-release support debt: Linux CPU/CUDA and Windows CPU remain to be built and validated; Windows CUDA follows the shared blocker policy |
| UCE 4-layer | Single-cell Embedding | macOS arm64 Metal | Pre-release support debt: Linux CPU/CUDA and Windows CPU remain to be built and validated; Windows CUDA follows the shared blocker policy |

CUDA is validated only on Linux. The Windows CUDA 12.4 recipe is buildable but
unvalidated, unpublished, unsupported, and absent from product target
selection.

## Removed experimental integrations

On 2026-07-22 the pre-release product was cut over to Runtime Box-only AI Model
delivery. The following implementation families were removed from the catalog,
frontend, pipeline registry, direct-run finalizer, scripts, tests, and public
documentation:

- the built-in mock model and Mock Inference Tool;
- CellTypist and its annotation Tool;
- Nucleotide Transformer and ESM-2 sequence embedding paths;
- Nucleotide Transformer variant-effect scoring;
- Enformer, Basenji2, and Borzoi predictive-genomics paths;
- Boltz-2 and Chai structure-prediction paths;
- the scFoundation preview entry.

Their earlier batch implementation status is historical engineering work, not a
current product capability. A removed family can return only as a new,
independently reviewed Runtime Box program; old local-build or direct-download
code must not be restored.

## Candidate portability and license assessment

This is a planning classification, not publication evidence. Exact upstream
revisions, weight terms, native dependency locks, and scientific validation
must be reviewed again when a candidate Runtime Box program starts.

| Model family | Current license assessment | Practical target assessment | Decision |
| --- | --- | --- | --- |
| Geneformer | Apache-2.0 model repository; accepted Runtime Box legal audits | Current macOS Metal, Linux CPU/CUDA, and Windows CPU matrix is validated | Keep and maintain |
| scGPT | MIT code repository; the reviewed upstream revision distributes the selected checkpoint without separate checkpoint terms | PyTorch and the current wrapper can select CPU, MPS, or CUDA; native target recipes and evidence are still missing outside macOS | Expand the current model |
| UCE | MIT code; selected Figshare model assets are CC BY 4.0 and require attribution | CPU portability is expected; CUDA selection and all non-macOS native packages require validation; the box has a large disk footprint | Expand the current model |
| ESM-2 8M | MIT model repository and weights | PyTorch makes CPU on all three operating systems, macOS MPS, and Linux/Windows CUDA plausible, subject to native validation | Strong future candidate |
| Boltz-2 | Upstream states that code and weights are MIT and permits commercial use | Upstream supports CPU/non-CUDA execution, although slowly, and optional CUDA; native dependencies still require validation on each operating system | Strong future candidate |
| CellTypist | MIT code; explicit redistribution terms for the separately downloaded model files were not established by the current review | CPU execution appears portable | Hold until the model-asset license is explicit |
| Enformer, Basenji2, Borzoi | Permissive code repositories; exact coverage of distributed weights still needs a model-asset audit | TensorFlow supports desktop CPU broadly, but not official macOS GPU and not native Windows GPU after TensorFlow 2.10 | Conditional: audit assets, then target CPU on all operating systems and Linux CUDA only |
| Nucleotide Transformer 50M/500M | CC BY-NC-SA 4.0 model terms | Technically portable through PyTorch/Transformers | Exclude from the general product catalog unless Liatir deliberately accepts non-commercial restrictions or obtains permission |
| scFoundation | Apache-2.0 code but separate non-commercial research terms for model weights | Technical portability does not remove the license restriction | Exclude from the general product catalog unless permission is obtained |
| Chai-1 | Apache-2.0 code and weights with commercial use allowed | Official runtime requires Linux, CUDA, and a bfloat16-capable GPU | Exclude from the universal native desktop catalog until a validated cross-platform port exists |

## Current completion criteria

For each additional model:

1. verify code, dependency, model-weight, and asset redistribution rights;
2. pin recipe inputs and a hash-locked dependency set;
3. build and self-test on an exact approved target;
4. pass model-specific scientific validation;
5. sign through the protected KMS path;
6. publish immutable bytes and promote a reviewed channel record;
7. pass native install, inference, Jobs, Results, provenance, replacement,
   rollback, removal, and cleanup gates;
8. retain reviewed evidence and update the honest support matrix;
9. add the model to `packages/liatir-core` only after the preceding evidence is
   complete.

The immediate model-distribution priority is to close scGPT and UCE target
parity across every feasible native target. No additional family should enter
the pre-release catalog ahead of that work. Cross-version Runtime Box update,
persisted anti-replay state, and the common execution spine defined in
[Scientific AI Workbench](./scientific-ai-workbench.md) remain required product
work in parallel with that model-expansion sequence.
