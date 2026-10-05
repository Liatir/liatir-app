# Reproduce or inspect the study

In Liatir open **Tools ? Single-cell study**, choose PBMC or Pancreas and the methods, disable **Check stability on a small sample first** for full data, and launch. On the approved PC select **Use NVIDIA graphics card and more memory**; the default remains cautious CPU execution. Install supported models through **AI Models**. Normal Jobs and Results retain progress, diagnostics, figures and export. UCE's unavailable Linux target remains an explicit blocker.

**Import saved study** accepts a native dataset run's `liatir-run.json`. Verified Mac imports preserve original code, inputs, measurements and producer. Ordinary resumes require unchanged recorded code, resources, model and environment; incompatible CPU/GPU checkpoints are refused. A combined two-dataset export is an analysis bundle, rather than one native resumable run.

The tracked tables omit large matrices. The complete local export is `showcases/single-cell-foundation-benchmark/transfer/completed-study-final-wsl2-2026-10-05`, in both Windows and `/home/lorenzo/liatir-single-cell-wsl2-2026-10-05`. Its `single-cell-study.zip` contains prepared counts, splits, ten embeddings, frozen code, metadata, logs, figures, historical partial attempts and validation. Extract it to a fresh directory on another machine and use this repository's study helpers. Recorded absolute Mac/Linux paths identify historical producers; helpers resolve the portable inputs relative to the export.

Use Python 3.11 and the exact repository `showcases/single-cell-foundation-benchmark/requirements.txt` packages. The tested WSL interpreter is Liatir's pinned Plugin Python 3.11.16:

```sh
PYTHON="tests/.artifacts/home/single-cell-showcase/.local/share/app.liatir.app/.liatir/.main/data/plugin-runtimes/plugin-single-cell-fo-1-0-0-b28876365baa/venv/bin/python"
STUDY="showcases/single-cell-foundation-benchmark"
EXPORT="$STUDY/transfer/completed-study-final-wsl2-2026-10-05"

"$PYTHON" "$STUDY/reproduce.py" "$EXPORT" \
  --output tests/.artifacts/single-cell-reproduction-new

"$PYTHON" "$STUDY/verify_counts.py" "$EXPORT" --dataset pbmc \
  --cache "$STUDY/transfer/public-source-cache" \
  --output tests/.artifacts/pbmc-count-check-new.json

"$PYTHON" "$STUDY/verify_counts.py" "$EXPORT" --dataset pancreas \
  --cache "$STUDY/transfer/public-source-cache" \
  --output tests/.artifacts/pancreas-count-check-new.json

"$PYTHON" "$STUDY/validate_artifacts.py" "$EXPORT" \
  --output tests/.artifacts/bundle-check-new.json
```

Run from the repository root and choose a new output for every verification. On another host replace `PYTHON` with its isolated pinned interpreter. Reproduction starts separate processes with recorded thread settings: one for PBMC and six for pancreas, so provide at least six cores. It verifies frozen evaluation code, package versions, input/split/embedding hashes and every biological/batch score at absolute tolerance 1e-9 and relative tolerance 1e-8. Missing values and reasons must match exactly. It repeats evaluation only, rather than inference, training or UMAP.

The separate source cache contains checksummed canonical downloads from `datasets/manifest.json`; it is outside Git and the ZIP. `finish_study.py` coordinates assembly and these checks from two full native exports without rerunning representations. See [tested outcomes](reproduction-validation.md) for commands actually executed and their precise scope.

The portable ZIP also includes `reproduction-tools/` with the verification scripts, source and pinned requirements. From an extracted export, `python reproduction-tools/reproduce.py . --output <fresh-directory>` uses the same checked evaluation path.
