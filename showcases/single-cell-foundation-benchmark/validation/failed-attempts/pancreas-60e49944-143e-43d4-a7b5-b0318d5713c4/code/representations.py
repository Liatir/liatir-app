"""Baselines share preprocessing; pretrained inference stays in signed Liatir model boxes."""
from pathlib import Path
import time

from common import SEED, environment, read_json, save_embedding, sha256, telemetry, write_json


def hvg_data(root, dataset):
    import anndata
    import scanpy as sc

    data = anndata.read_h5ad(root / "datasets" / dataset / "counts.h5ad")
    data.layers["counts"] = data.X.copy()
    sc.pp.normalize_total(data, target_sum=1e4)
    sc.pp.log1p(data)
    sc.pp.highly_variable_genes(data, flavor="seurat", n_top_genes=min(2000, data.n_vars), batch_key="batch")
    return data[:, data.var.highly_variable].copy()


def baseline(root, dataset, method):
    if method not in ("pca", "harmony", "scvi"):
        raise ValueError("Pretrained models must run through Liatir's signed Runtime Box API.")
    start = time.perf_counter()
    directory = root / "runs" / dataset / method
    directory.mkdir(parents=True, exist_ok=True)
    import numpy as np
    import scanpy as sc
    data = hvg_data(root, dataset)
    config = {"seed": SEED, "method": method, "dataset": dataset, "normalization_total": 10000,
              "hvg_flavor": "seurat", "hvg_batch_key": "batch", "hvg_count": data.n_vars,
              "hvg_ids": data.var_names.tolist(), "zero_shot": False}
    if method == "scvi":
        config.update({"epochs": 100, "batch_size": 128, "latent_dimensions": 30,
                       "hidden_units": 128, "layers": 2, "gene_likelihood": "nb",
                       "training": "unsupervised on the evaluation dataset; labels never supplied"})
        write_json(directory / "config.json", config)
        import scvi
        import torch
        scvi.settings.seed = SEED
        torch.set_num_threads(1)
        scvi.model.SCVI.setup_anndata(data, layer="counts", batch_key="batch")
        model = scvi.model.SCVI(data, n_hidden=128, n_latent=30, n_layers=2, gene_likelihood="nb")
        model.train(max_epochs=100, accelerator="cpu", devices=1, batch_size=128,
                    early_stopping=False, enable_progress_bar=False, deterministic=True)
        values = model.get_latent_representation()
        model.save(str(directory / "trained-model"), overwrite=False, save_anndata=False)
    else:
        sc.pp.scale(data, max_value=10)
        sc.tl.pca(data, n_comps=min(50, data.n_vars - 1), svd_solver="arpack", random_state=SEED)
        values = data.obsm["X_pca"]
        config.update({"pca_components": values.shape[1], "scale_clip": 10, "pca_solver": "arpack"})
        if method == "harmony":
            import harmonypy
            harmony = harmonypy.run_harmony(values, data.obs, "batch", random_state=SEED,
                                           max_iter_harmony=10, verbose=True)
            values = harmony.Z_corr.T
            config.update({"harmony_max_iterations": 10, "harmony_theta": 2, "harmony_lambda": 1})
    embedding = save_embedding(directory, values, data.obs_names)
    write_json(directory / "config.json", config)
    write_json(directory / "environment.json", environment())
    measured = telemetry(start)
    measured.update({"embedding_dimensions": embedding["dimensions"], "embedding_bytes": embedding["bytes"],
                     "model_runtime_bytes": sum(p.stat().st_size for p in Path(__import__('sys').prefix).rglob('*') if p.is_file()),
                     "disk_scope": "isolated shared baseline/evaluation Plugin environment; repeated per baseline, not additive"})
    write_json(directory / "telemetry.json", measured)
    provenance = {"status": "completed", "embedding": embedding,
                  "input_sha256": read_json(root / "datasets" / dataset / "manifest.json")["prepared_sha256"],
                  "runner_sha256": sha256(__file__), "environment": "Liatir managed Python Plugin"}
    write_json(directory / "provenance.json", provenance)
    return provenance


def collect(root, dataset, method, inputs):
    directory = root / "runs" / dataset / method
    directory.mkdir(parents=True, exist_ok=True)
    result = inputs["runResult"]
    (directory / "logs").mkdir(exist_ok=True)
    # Preserve continuously saved process logs, even when native settlement is interrupted.
    for stream in ("stdout", "stderr"):
        path = directory / "logs" / f"{stream}.log"
        if not path.exists():
            path.write_text(result.get(stream, ""))
    if not (directory / "config.json").exists():
        write_json(directory / "config.json", inputs["config"])
    base = {"runtime_box_activation": result.get("runtimeBoxActivation"),
            "input_sha256": read_json(root / "datasets" / dataset / "manifest.json")["prepared_sha256"],
            "runner_sha256": inputs.get("runnerSha256"), "job_id": inputs.get("jobId")}
    if (directory / "environment.json").exists():
        recorded_environment = read_json(directory / "environment.json")
        base["runner_sha256"] = recorded_environment.get("model_runner_sha256")
        base["runtime_box_activation"] = base["runtime_box_activation"] or recorded_environment.get("runtime_box_activation")
    guard_path = directory / "resource-monitor.json"
    guard = read_json(guard_path) if guard_path.exists() else {}
    guard_error = guard.get("reason") if guard.get("status") in ("stopped", "refused") else None
    if not result.get("ok") or guard_error:
        base.update(status="blocked", error=guard_error or result.get("stderr") or "Model process failed")
        write_json(directory / "provenance.json", base)
        if not (directory / "environment.json").exists():
            write_json(directory / "environment.json", {"requested_model": inputs["config"], "host_environment": environment(),
                                                        "model_environment": None, "reason": base["error"]})
        if not (directory / "telemetry.json").exists():
            write_json(directory / "telemetry.json", {"wall_seconds": None, "peak_rss_bytes": None,
                "peak_accelerator_bytes": None, "execution_target": "CPU",
                "peak_accelerator_reason": "CPU-only execution; no accelerator used.",
                "observed_peak_tree_rss_bytes": guard.get("peak_rss_bytes"),
                "reason": "Worker terminated before final OS telemetry: " + base["error"]})
        write_json(directory / "metrics.json", {"status": "blocked", "reason": base["error"]})
        return base
    parsed = None
    for line in reversed(result["stdout"].splitlines()):
        try:
            import json
            candidate = json.loads(line)
            if "embeddedAnnDataPath" in candidate:
                parsed = candidate
                break
        except (ValueError, TypeError):
            pass
    if parsed is None:
        raise ValueError("Successful model Job returned no embedding artifact identity.")
    import anndata
    data = anndata.read_h5ad(parsed["embeddedAnnDataPath"])
    summary = parsed["summary"]
    embedding = save_embedding(directory, data.obsm[summary["embeddingKey"]], data.obs_names)
    base.update(status="completed", embedding=embedding, model_summary=summary,
                model_output_sha256=sha256(parsed["embeddedAnnDataPath"]))
    measured = read_json(directory / "telemetry.json")
    measured.update(embedding_dimensions=embedding["dimensions"], embedding_bytes=embedding["bytes"],
                    execution_target=summary.get("accelerator", measured["execution_target"]))
    write_json(directory / "telemetry.json", measured)
    write_json(directory / "provenance.json", base)
    return base
