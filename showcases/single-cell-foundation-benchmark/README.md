# Single-cell foundation models vs established baselines

This is a first-party Liatir workflow comparing six ways of representing a cell's
gene expression. The completed study did **not** show a uniform advantage for
pretrained representations: scGPT was competitive on PBMC, while established
approaches remained particularly strong on Pancreas. Two datasets and one seed
do not establish general superiority. The authoritative scope is the repository's
single-cell showcase plan. [protocol.md](protocol.md) specifies the fixed scientific
parameters.

[Read the Scientific Showcase](https://liatir.com/showcases/single-cell-foundation-benchmark)
· [All showcases](../README.md)
· [Complete reproducibility archive and citation](https://doi.org/10.5281/zenodo.23187931)

## Study navigation

| Find | Tracked material |
| --- | --- |
| Protocol and methods | [Frozen protocol](protocol.md) |
| Datasets and provenance | [Source manifest](datasets/manifest.json), [prepared dataset records](datasets/), [per-method provenance and environments](runs/) |
| Results | [Measured report](report/results.md), [full-precision CSV](results/summary.csv), [JSON](results/summary.json), [compute measurements](results/compute_metrics.csv) |
| Figures | [All 22 validated figures](results/figures/) |
| Interpretation and limitations | [Report](report/results.md#interpretation-and-verification-boundaries), [limitations](report/limitations.md) |
| Reproduction | [Reproducing the study in Liatir](report/reproduction.md) |
| Validation and failed attempts | [Tested outcomes](report/reproduction-validation.md), [completion receipt](validation/completed-study/completion.json), [completion evidence](validation/completed-study/), [historical attempts](validation/) |
| Large artifact download and citation | [Zenodo DOI](https://doi.org/10.5281/zenodo.23187931) |

## Source and artifact bundle

GitHub tracks source, protocol, dataset/provenance manifests, small scientific
tables, figures and validation records. Prepared matrices, embeddings, model
weights and transfer archives stay outside Git. The designated download and
citation record for the complete approximately 1.8 GB reproducibility archive is
[Zenodo](https://doi.org/10.5281/zenodo.23187931).

The original inner `single-cell-study.zip` is a different artifact from the
complete external archive: it is 405,019,914 bytes, with SHA-256
`184475f893e7f23efd24d095dccaccac8deefb79a525c0c7aa3d55a193f06de3`,
as recorded in the unchanged completion evidence. That hash must not be used to
identify the larger Zenodo download. See [reproduction in Liatir](report/reproduction.md)
for the visual study workflow and continuing saved work.

## Run in Liatir

Use the [Liatir reproduction guide](report/reproduction.md) for the main stages:

1. Choose a workspace and make the required models available through **AI Models**.
2. In **Tools**, open the single-cell study, choose one of the two datasets and
   include the six study methods. Use the complete dataset and an execution setting
   supported by your computer.
3. Start the study, follow progress in **Jobs**, then inspect and export it through
   **Results**. Repeat for the other dataset.

The small stability check is a diagnostic rather than the full scientific comparison.
Each study belongs to its workspace and retains its own execution history.
Saved work is reused only after the app verifies the recorded inputs and results.

**Scientific results:** both complete datasets have measurements: PBMC 11,990
cells × 3,346 genes and pancreas 16,382 cells × 19,093 genes. PCA, Geneformer,
Harmony, scVI and scGPT completed for each dataset. UCE remains an explicit
blocker: its checkpoint exceeded the original Mac budget, and no signed Linux
target is published for this PC. Increasing PC RAM does not provide that target.
The twelve-row [CSV](results/summary.csv), [JSON](results/summary.json),
[figures](results/figures/) and [report](report/results.md) expose all outcomes.

Nine completed Mac representations were reused byte for byte. Only unfinished
pancreas scGPT inference ran again, inside the actual compiled Linux Liatir app
in WSL2, with its window on a virtual display. Its new CUDA run took
515.536567396 seconds, using six numerical threads and groups of sixteen cells.
Both datasets passed independent metric reproduction and exact original-source
count checks. Native Results, charts and export passed; the corrected relevant
UI matrix passed all three suites (48 ordinary native cases, plus index and
restart checks). This is development-app verification, not a Windows release gate.

The updated scGPT worker saves each complete batch to a checked local database.
Real signed-model interruption/resume, changed-identity refusal and exact
resumed/uninterrupted GPU equality passed before full inference. The Windows
supervisor held WSL alive across chat interruption; the complete GPU database
now retains all 16,382 cells. Earlier Mac interrupted logs and the PC's separate
2,066-cell CPU checkpoint remain historical evidence, without mixing CPU and
GPU vectors or charging old partial work to the new complete runtime.
See the [continuation record](../../.context/history/single-cell-showcase-wsl2-execution.md).

The original Mac budget was CPU, one numerical thread, one-cell model batches
and 2 GiB process-family memory. The explicitly approved PC profile uses six
threads, CUDA, batches of sixteen, a 16 GiB process-family ceiling and a 6 GiB
whole-GPU ceiling. It requires 6 GiB available system RAM, 8 GiB free disk and
at most 256 MiB host swap growth; its workload group cannot swap. An additional
5.5 GiB PyTorch allocator ceiling leaves graphics memory for the system. The
default cautious profile remains available. Actual producer limits stay attached
to each method. Blocked rows contain null scores, causes and retained logs.

The [complete artifact record](https://doi.org/10.5281/zenodo.23187931) preserves
the original study data and results. [Tested validation evidence](report/reproduction-validation.md)
records the checks performed on the completed study.

## Interpretation

Keep every individual metric visible. scVI trains on these datasets and must be
interpreted separately from the pretrained methods, which receive no fine-tuning.
One seed does not establish statistical superiority or generalization to unseen
studies. Mac and new Windows/WSL2 costs belong to different computers and cannot
establish a same-host performance ranking. The pancreas source supplies fractional quantification values;
they remain unchanged and limit integer count-model assumptions. See
`report/limitations.md` for the remaining boundaries.
