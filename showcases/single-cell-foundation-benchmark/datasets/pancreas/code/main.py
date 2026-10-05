"""A first-party Python .lia Plugin; the Liatir showcase owns orchestration and Jobs."""
from pathlib import Path
import contextlib
import os
import shutil
import sys
import time
import traceback

from common import DATASETS, METHODS, environment, read_json, telemetry, write_json
from resource_guard import ResourceGuard


def run_stage(inputs):
    root = Path(inputs["outputDir"]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    action = inputs["action"]
    dataset = inputs.get("dataset", "pbmc")
    if dataset not in DATASETS:
        raise ValueError(f"Unknown dataset: {dataset}")
    method = inputs.get("method", "pca")
    if method not in METHODS:
        raise ValueError(f"Unknown method: {method}")
    if action == "prepare":
        from study_data import prepare
        (root / "protocol.md").write_text(inputs["protocol"])
        (root / "requirements.txt").write_text(inputs.get("requirements", ""))
        write_json(root / "liatir-run.json", {"run_id": inputs.get("runId"), "dataset": dataset,
                   "stability_check": bool(inputs.get("stabilityCheck")), "resource_limits": inputs["resourceLimits"],
                   "execution_profile": inputs.get("executionProfile", "cautious-cpu"), "threads": inputs.get("threads", 1)})
        (root / "code").mkdir(exist_ok=True)
        for source in Path(__file__).parent.glob("*.py"):
            shutil.copyfile(source, root / "code" / source.name)
        for method, script in inputs.get("modelScripts", {}).items():
            if method not in METHODS:
                raise ValueError("Unknown model script in the reproducibility bundle.")
            (root / "code" / f"{method}-inference.py").write_text(script)
        write_json(root / "study-environment.json", environment())
        if inputs.get("importStudyFile"):
            from checkpoints import restore
            file = Path(inputs["importStudyFile"])
            if file.name != "liatir-run.json" or not file.is_file():
                raise ValueError("Choose the saved study's liatir-run.json file.")
            recorded = read_json(file)
            transfer = inputs["transferManifest"]
            recognized = any(run["run_id"] == recorded["run_id"] for run in transfer["runs"])
            return restore(root, file.resolve().parent, dataset, bool(inputs.get("stabilityCheck")), transfer if recognized else None, inputs.get("methods"))
        if inputs.get("resumeRoot"):
            from checkpoints import restore
            return restore(root, inputs["resumeRoot"], dataset, bool(inputs.get("stabilityCheck")), requested_methods=inputs.get("methods"))
        return prepare(root, dataset, Path(inputs["cacheDir"]), bool(inputs.get("stabilityCheck")))
    if action == "baseline":
        from representations import baseline
        return baseline(root, dataset, method)
    if action == "collect":
        from representations import collect
        return collect(root, dataset, method, inputs)
    if action == "evaluate":
        from evaluation import evaluate
        return evaluate(root, dataset, inputs["methods"])
    if action == "report":
        from reporting import report
        return report(root)
    raise ValueError(f"Unknown study action: {action}")


class Tee:
    def __init__(self, stream, file):
        self.stream, self.file = stream, file

    def write(self, value):
        self.file.write(value)
        self.file.flush()
        return self.stream.write(value)

    def flush(self):
        self.file.flush()
        self.stream.flush()

    def __getattr__(self, name):
        return getattr(self.stream, name)


def main(inputs):
    root = Path(inputs["outputDir"])
    threads = int(inputs.get("threads", 1))
    if not 1 <= threads <= (os.cpu_count() or 1):
        raise ValueError("The requested numerical thread count exceeds this host.")
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
        os.environ[name] = str(threads)
    os.environ["JAX_PLATFORMS"] = "cpu"
    directory = root / "runs" / inputs["dataset"] / inputs["method"] if inputs["action"] == "baseline" else root / "stages" / inputs["action"]
    with ResourceGuard(directory, inputs["resourceLimits"]):
        if hasattr(os, "nice"):
            os.nice(10)
        return logged_stage(inputs)


def logged_stage(inputs):
    root = Path(inputs["outputDir"])
    if inputs["action"] != "baseline":
        return run_stage(inputs)
    directory = root / "runs" / inputs["dataset"] / inputs["method"]
    logs = directory / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / "stdout.log").open("w") as out, (logs / "stderr.log").open("w") as err:
        with contextlib.redirect_stdout(Tee(sys.stdout, out)), contextlib.redirect_stderr(Tee(sys.stderr, err)):
            try:
                return run_stage(inputs)
            except BaseException:
                traceback.print_exc()
                raise
