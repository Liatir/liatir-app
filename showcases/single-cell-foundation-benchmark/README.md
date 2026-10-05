# Single-cell foundation-model showcase

This is a first-party Liatir workflow comparing six ways of representing a cell's
gene expression. The authoritative scope is the repository's single-cell showcase
plan. [protocol.md](protocol.md) specifies the fixed scientific parameters.

## Run in Liatir

1. Install the available selected models through **AI Models**. Signed targets differ
   by platform; an unsupported model stays visible as a blocked configuration.
2. Open **Tools → Single-cell study**. Choose PBMC or Pancreas and the methods.
3. Disable **Check stability on a small sample first** for the complete dataset.
   On the approved PC choose **Use NVIDIA graphics card and more memory**. Launch.
4. Follow it in **Jobs**. Its **Results** entry contains the individual measurements,
   cell-type and batch plots, runtime/memory comparisons and ZIP export.

The small stability check is a diagnostic, not the full scientific comparison.
Every invocation belongs to its workspace and has its own saved run identity.
Leaving the screen does not stop it. A finished study can be resumed; completed
methods are reused only after verifying code, data, split and embedding checksums.

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

## Native execution driver

The driver operates the same controls in the compiled native app; it does not run
the science in a browser or replace Liatir's Jobs and Results. After preparing the
repository's native UI test binary, set `LIATIR_STUDY_MODEL_ROOT` to the existing
signed-model activation directory, then run each dataset sequentially:

```sh
node scripts/run-single-cell-showcase.mjs pbmc pca,geneformer,harmony,scvi,scgpt,uce
node scripts/run-single-cell-showcase.mjs pancreas pca,geneformer,harmony,scvi,scgpt,uce
```

Use `--detach` to keep the native driver independent of the launching chat or
terminal session. It records its own execution identity, exact request, continuous
log and actual exit under the ignored `transfer/executions` directory. For a
verified saved study, set `LIATIR_STUDY_IMPORT_FILE` to its `liatir-run.json`, or
choose that file using **Import saved study** in Liatir. Import verifies original
input, split, code and embedding identities before reusing completed work. It
creates fresh workspace/run/Job records and keeps the original source separately.
It never turns the lost Mac progress log into a reusable scGPT result.

On Windows, a detached Linux process alone does not guarantee that WSL stays
alive after the launching shell closes. Use `scripts/run-single-cell-wsl2.mjs`
from Windows with the distribution, Linux user, absolute Linux checkout and
the foreground continuation entry under its showcase `transfer` directory.
This Windows supervisor holds a WSL session until that entry actually exits.
Its unique systemd workload group refuses swapping; the original independent
RSS, available-memory, disk and host-wide swap-growth guards remain active.
It does not modify global WSL configuration. The recorded request and actual
exit live under `transfer/windows-executions`.

Full native run identities and sources are retained in
`validation/native-study-runs.json`. Original count inputs and large embeddings
are excluded from Git; manifests record SHA-256 identities. The local scientific
ZIP contains prepared counts, compact embeddings, source code, configuration,
environment, logs, metrics, figures and reports. Intermediate model-produced count
copies and trained weights are referenced by checksum and size rather than copied
again into the ZIP.

## Recompute saved measurements

Use Python 3.11 and the exact packages in `requirements.txt`, in an isolated
environment. The helper starts a separate process per dataset with its recorded
thread settings (one for PBMC, six for pancreas); use a host with six cores.
The tracked tables alone omit large matrices and embeddings. Use the complete
local export in `transfer/completed-study-final-wsl2-2026-10-05`, or extract its
`single-cell-study.zip` into a fresh directory. With the repository root
as the working directory, the following checks that export and recomputes
every biological and batch score from saved embeddings and the fixed split:

```sh
python showcases/single-cell-foundation-benchmark/reproduce.py \
  showcases/single-cell-foundation-benchmark/transfer/completed-study-final-wsl2-2026-10-05 \
  --output tests/.artifacts/single-cell-reproduction
```

Choose a new output directory for each verification. The helper checks frozen
evaluation code, package versions, data and split checksums first. Numeric agreement
requires absolute tolerance 1e-9 and relative tolerance 1e-8; missing values and
their reasons must agree exactly. This verifies evaluation reproducibility. It does
not claim that pretrained inference or scVI training was rerun.

`finish_study.py` coordinates assembly of two completed native exports, independent
metric reproduction, exact canonical source-count checks and artifact validation.
Pass both native output directories, a fresh `--output` directory and `--cache`
for the checksummed public sources. It keeps producer limits separate and does
not repeat representations. Its complete scientific execution passed on the
two native exports; [tested reproduction](report/reproduction-validation.md)
records the commands and real outcomes. Final curation also retains original
partial attempts, reviewed figures and repository gate evidence in the bundle.

`verify_counts.py` separately checks every prepared count against the downloaded
canonical sources, without rounding or reconstructing measurements. For an assembled
export pass `--dataset pbmc` or `--dataset pancreas`, `--cache` with Liatir's
`single-cell-datasets` cache directory and a new `--output` JSON path.
`validate_artifacts.py` verifies all twelve configurations, CSV/JSON equality,
checksums, figures and ZIP integrity. Tested command outcomes belong in
`report/reproduction-validation.md` and `validation/`; helper existence is not
evidence of a successful verification.

## Interpretation

Keep every individual metric visible. scVI trains on these datasets and must be
interpreted separately from the pretrained methods, which receive no fine-tuning.
One seed does not establish statistical superiority or generalization to unseen
studies. Mac and new Windows/WSL2 costs belong to different computers and cannot
establish a same-host performance ranking. The pancreas source supplies fractional quantification values;
they remain unchanged and limit integer count-model assumptions. See
`report/limitations.md` for the remaining boundaries.
