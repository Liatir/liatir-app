# Single-cell foundation-model showcase

This is a first-party Liatir workflow comparing six ways of representing a cell's
gene expression. The authoritative scope is the repository's single-cell showcase
plan. [protocol.md](protocol.md) specifies the fixed scientific parameters.

## Run in Liatir

1. Install the available selected models through **AI Models**. Signed targets differ
   by platform; an unsupported model stays visible as a blocked configuration.
2. Open **Tools → Single-cell study**. Choose PBMC or Pancreas and the methods.
3. Disable **Small stability check** for the complete dataset. Launch the study.
4. Follow it in **Jobs**. Its **Results** entry contains the individual measurements,
   cell-type and batch plots, runtime/memory comparisons and ZIP export.

The small stability check is a diagnostic, not the full scientific comparison.
Every invocation belongs to its workspace and has its own saved run identity.
Leaving the screen does not stop it. A finished study can be resumed; completed
methods are reused only after verifying code, data, split and embedding checksums.

**Current execution status:** full PBMC measurements exist; pancreas stopped
after four completed representation stages. It has no final common evaluation.
The Mac scGPT worker saved only at the end, so its interrupted partial work
was lost. The updated worker commits each completed batch to a checked local
database; fixture interruption, corruption, changed identity and concurrent-writer
checks pass. The detached driver survives its launcher exiting. The real signed
Linux model interruption check passed: 16 resumed cells matched the frozen runner
exactly, and a changed seed was rejected. Full native pancreas continuation is now
running on Windows/WSL2, reusing its four completed Mac representations. An independent
detached continuation waits for its successful export before running reproduction,
source-count checks and repository gates. Final study completion remains pending.
All nine completed representations were imported and checked on Windows/WSL2;
their original Mac inputs, costs and provenance remain attached. See the
[Windows/WSL2 handoff](../../.context/state/single-cell-showcase-wsl2-handoff.md).

The approved local operating budget is CPU only, one numerical thread, one-cell
pretrained-model batches and a 2 GiB process-family memory limit. An independent
monitor also checks host memory, swap growth and free disk. A blocked method has
null scientific scores, an explicit cause and retained logs. The pinned UCE loader's
checkpoint storage alone exceeds this budget; its preflight records that boundary
without attempting the known oversized allocation.

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

Full native run identities and sources are retained in
`validation/native-study-runs.json`. Original count inputs and large embeddings
are excluded from Git; manifests record SHA-256 identities. The local scientific
ZIP contains prepared counts, compact embeddings, source code, configuration,
environment, logs, metrics, figures and reports. Intermediate model-produced count
copies and trained weights are referenced by checksum and size rather than copied
again into the ZIP.

## Recompute saved measurements

Use Python 3.11 and the exact packages in `requirements.txt`, in an isolated
environment. Set the numerical thread variables to one. With the repository root
as the working directory, the following checks the assembled export and recomputes
every biological and batch score from saved embeddings and the fixed split:

```sh
python showcases/single-cell-foundation-benchmark/reproduce.py \
  showcases/single-cell-foundation-benchmark \
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
for the checksummed public sources. It uses the same frozen resource limits and
does not repeat representations. Its full scientific execution remains pending;
the existence of the helper is not validation evidence.

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
