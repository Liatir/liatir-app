"""Measured tables, scientific figures and the normal Liatir Result presentation."""
import csv
from pathlib import Path
import zipfile

from common import METHODS, read_json, sha256, write_json

BIO = ["ari", "nmi", "cell_type_silhouette", "knn_macro_f1", "logistic_macro_f1"]
BATCH = ["batch_silhouette", "asw_batch", "graph_connectivity", "ilisi_scaled"]
COMPUTE = ["wall_seconds", "peak_rss_bytes", "peak_accelerator_bytes", "execution_target",
           "model_runtime_bytes", "embedding_dimensions", "embedding_bytes", "wall_seconds_lower_bound", "wall_seconds_reason",
           "numerical_threads", "model_batch_size", "max_rss_limit_bytes", "max_gpu_used_limit_bytes"]
IDENTITY = ["runtime_box_id", "runtime_box_version", "runtime_archive_sha256", "runtime_payload_sha256",
            "runner_sha256", "host_os", "host_architecture", "host_cpu", "host_ram_bytes", "python_version"]


def table(path, rows, fields):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def report(root):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    rows, sections = [], []
    stability_check = (read_json(root / "liatir-run.json").get("stability_check", False)
                       if (root / "liatir-run.json").exists() else False)
    results = root / "results"
    figures = results / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    report_dir = root / "report"
    report_dir.mkdir(exist_ok=True)
    for dataset_dir in sorted((root / "runs").iterdir()):
        for method in METHODS:
            directory = dataset_dir / method
            if not directory.exists():
                continue
            provenance_path = directory / "provenance.json"
            provenance = read_json(provenance_path) if provenance_path.exists() else {"status": "blocked", "error": "No successful provenance record"}
            metrics = read_json(directory / "metrics.json") if (directory / "metrics.json").exists() else {}
            measured = read_json(directory / "telemetry.json") if (directory / "telemetry.json").exists() else {}
            env = read_json(directory / "environment.json") if (directory / "environment.json").exists() else {}
            config = read_json(directory / "config.json") if (directory / "config.json").exists() else {}
            recorded_run = root / "datasets" / dataset_dir.name / "liatir-run.json"
            if not recorded_run.exists():
                recorded_run = root / "liatir-run.json"
            producer_limits = config.get("resource_limits") or provenance.get("source_resource_limits") or (
                read_json(recorded_run).get("resource_limits", {}) if recorded_run.exists() else {})
            study_environment = root / "datasets" / dataset_dir.name / "study-environment.json"
            if not study_environment.exists():
                study_environment = root / "study-environment.json"
            host = provenance.get("source_study_environment") or env.get("host_environment") or (
                env if env.get("cpu") else read_json(study_environment) if study_environment.exists() else env)
            release = (provenance.get("runtime_box_activation") or {}).get("release", {})
            row = {"dataset": dataset_dir.name, "method": method, "status": provenance["status"],
                   "stability_check_only": stability_check,
                   "error": provenance.get("error"),
                   **{key: metrics.get(key) for key in BIO + BATCH + ["evaluation_cells", "train_cells", "test_cells"]},
                   **{key: measured.get(key) for key in COMPUTE},
                   "numerical_threads": config.get("threads", 1), "model_batch_size": config.get("batchSize", config.get("batch_size")),
                   "max_rss_limit_bytes": producer_limits.get("maxRssBytes"),
                   "max_gpu_used_limit_bytes": config.get("maxGpuUsedBytes"),
                   "peak_accelerator_reason": measured.get("peak_accelerator_reason", "Method did not run."),
                   "input_sha256": provenance.get("input_sha256"),
                   "embedding_sha256": provenance.get("embedding", {}).get("sha256"),
                   "runtime_box_identity": provenance.get("runtime_box_activation"),
                   "zero_shot": method in ("geneformer", "scgpt", "uce"),
                   "runtime_box_id": release.get("boxId"), "runtime_box_version": release.get("version"),
                   "runtime_archive_sha256": release.get("archive", {}).get("sha256"),
                   "runtime_payload_sha256": release.get("payloadDigest", {}).get("sha256"),
                   "runner_sha256": provenance.get("runner_sha256"),
                   "host_os": host.get("os"), "host_architecture": host.get("architecture"),
                   "host_cpu": host.get("cpu"), "host_ram_bytes": host.get("host_ram_bytes"),
                   "python_version": env.get("python"),
                   "null_reasons": metrics.get("null_reasons", {})}
            if row["status"] == "completed" and not metrics:
                row["status"] = "blocked"
                row["error"] = "Embedding produced but shared evaluation has not completed."
            rows.append(row)
            if not (directory / "umap.csv").exists():
                continue
            data = pd.read_csv(directory / "umap.csv")
            for color in ("cell_type", "batch"):
                title = f"{dataset_dir.name} · {method} · {color.replace('_', ' ')}"
                figure, axis = plt.subplots(figsize=(9, 6), layout="constrained")
                traces = []
                groups = sorted(data[color].astype(str).unique())
                palette = plt.get_cmap("tab20")
                for index, group in enumerate(groups):
                    selected = data[data[color].astype(str) == group]
                    axis.scatter(selected.umap_1, selected.umap_2, s=2, alpha=0.6,
                                 label=group, color=palette(index % 20), rasterized=True)
                    traces.append({"type": "scattergl", "mode": "markers", "name": group,
                                   "x": selected.umap_1.round(5).tolist(), "y": selected.umap_2.round(5).tolist(),
                                   "marker": {"size": 3, "opacity": 0.65}})
                axis.set(xlabel="UMAP 1", ylabel="UMAP 2", title=title)
                axis.legend(markerscale=3, bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=7)
                figure.savefig(figures / f"{dataset_dir.name}-{method}-{color}.png", dpi=160)
                plt.close(figure)
                sections.append({"type": "plotly", "plotlyType": "scattergl", "title": title,
                                 "description": "UMAP places similar cells close together. The projection is visual only; scores use the full embedding.",
                                 "data": traces, "layout": {"height": 480, "xaxis": {"title": "UMAP 1"}, "yaxis": {"title": "UMAP 2"}}})
    write_json(results / "summary.json", rows)
    scalar_fields = ["dataset", "method", "status", "stability_check_only", "error", "evaluation_cells", "train_cells", "test_cells"] + BIO + BATCH + COMPUTE + IDENTITY + ["peak_accelerator_reason", "input_sha256", "embedding_sha256", "zero_shot"]
    table(results / "summary.csv", rows, scalar_fields)
    for filename, fields in (("biological_metrics", BIO), ("batch_metrics", BATCH), ("compute_metrics", COMPUTE)):
        table(results / f"{filename}.csv", rows, ["dataset", "method", "status"] + fields)
    for cost, xlabel, divisor in (("wall_seconds", "Representation runtime (seconds; logarithmic scale)", 1),
                                  ("peak_rss_bytes", "Peak process RAM (GiB)", 1024 ** 3)):
        figure, axis = plt.subplots(figsize=(9, 6), layout="constrained")
        traces = []
        for dataset in sorted({row["dataset"] for row in rows}):
            subset = [r for r in rows if r["dataset"] == dataset and r["status"] == "completed" and r.get(cost) is not None]
            xs = [r[cost] / divisor for r in subset]
            ys = [r["logistic_macro_f1"] for r in subset]
            names = [r["method"] for r in subset]
            host_names = [("Mac" if r["host_os"] and "macOS" in r["host_os"] else "WSL2" if r["host_os"] and "WSL" in r["host_os"] else r["host_architecture"] or "unknown host") + f"/{r['execution_target']}" for r in subset]
            axis.scatter(xs, ys, label=dataset)
            offsets = {"pca": (-6, -14), "harmony": (6, 8), "scvi": (-6, 8),
                       "geneformer": (6, -14), "scgpt": (6, 8), "uce": (6, -14)}
            for x, y, name, host_name in zip(xs, ys, names, host_names):
                dx, dy = offsets[name]
                axis.annotate(f"{name} ({host_name})", (x, y), xytext=(dx, dy), textcoords="offset points",
                              ha="right" if dx < 0 else "left", fontsize=8)
            traces.append({"type": "scatter", "mode": "markers+text", "name": dataset, "x": xs, "y": ys,
                           "text": [f"{name} ({host_name})" for name, host_name in zip(names, host_names)], "textposition": ["bottom left" if name == "pca" else
                               "top left" if name == "scvi" else "bottom right" if name == "geneformer"
                               else "top right" for name in names]})
        if cost == "wall_seconds":
            axis.set_xscale("log")
        axis.margins(x=0.15)
        axis.set(xlabel=xlabel, ylabel="Logistic regression macro-F1", ylim=(0, 1.04))
        axis.legend(loc="lower right")
        figure.savefig(figures / f"biological-performance-vs-{cost}.png", dpi=160)
        plt.close(figure)
        sections.insert(0, {"type": "plotly", "plotlyType": "scatter", "title": f"Cell identity vs {xlabel.lower()}",
                            "data": traces, "layout": {"xaxis": {"title": xlabel,
                                "type": "log" if cost == "wall_seconds" else "linear"},
                                "yaxis": {"title": "Macro-F1", "range": [0, 1.04]}}})
    headers = ["Dataset", "Method", "Status", "ARI", "NMI", "Cell silhouette", "kNN F1", "Logistic F1", "Batch ASW", "Connectivity", "iLISI", "Seconds", "Peak RAM GiB", "Host OS"]
    def display(value):
        return round(value, 5) if isinstance(value, float) else value if value is not None else "—"
    comparison = [[r["dataset"], r["method"], r["status"], *[display(r[k]) for k in BIO],
                   *[display(r[k]) for k in ("asw_batch", "graph_connectivity", "ilisi_scaled", "wall_seconds")],
                   display(r["peak_rss_bytes"] / 1024 ** 3 if r["peak_rss_bytes"] else None), r["host_os"] or "unknown"] for r in rows]
    sections.insert(0, {"type": "table", "label": "Individual measurements", "headers": headers, "rows": comparison})
    sections.insert(0, {"type": "text", "label": "Reading these results", "content":
        "ARI and NMI measure how closely discovered groups match known cell types. F1 measures cell-label prediction on held-out cells, giving each type equal weight (1 is perfect). Cell silhouette measures separation of cell types. Batch ASW and iLISI measure mixing of experimental batches; connectivity measures whether cells of the same type stay connected. Higher values are favorable, but no single measure determines a winner. scVI learned from this dataset; the pretrained models were used without further training."})
    host_boundary = "Each method retains the computer that produced its embedding. Mac and Windows/WSL2 measurements describe different hosts. Compare runtime and memory within the same host; these plots do not establish a same-host speed ranking."
    sections.insert(0, {"type": "text", "label": "Computers used", "content": host_boundary})
    report_text = ["# Single-cell foundation-model study", "", "## Observations", "",
                   "Measurements from local Liatir Jobs. F1 measures cell-label prediction on the fixed held-out split (1 is perfect). No combined ranking is computed.", "",
                   "| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    if stability_check:
        report_text.insert(2, "**Stability diagnostic only: a small sample, not the complete scientific study.**\n")
        sections.insert(0, {"type": "text", "label": "Stability check only", "content": "This small sample checks that the computer can run these methods within the resource limits. These numbers are not results of the complete study."})
    report_text += ["| " + " | ".join(str(x) for x in row) + " |" for row in comparison]
    report_text += ["", "## Failed or blocked configurations", ""]
    report_text += [f"- {r['dataset']}/{r['method']}: {r['error']}" for r in rows if r["status"] != "completed"] or ["None."]
    report_text += ["", "## Interpretation boundary", "", host_boundary, "", "These are dataset-specific measurements from one seeded execution. scVI was trained on the evaluation data; the three pretrained models were not fine-tuned. The study does not establish statistical superiority, generalization to unseen studies, or absence of pretraining overlap."]
    (report_dir / "results.md").write_text("\n".join(report_text) + "\n")
    (report_dir / "limitations.md").write_text("# Limitations\n\n- One seed; no confidence intervals. Saved Mac representations and new Windows/WSL2 representations retain their own host identities. Costs across these hosts do not establish a same-host speed ranking.\n- Random stratified classification split, not leave-one-batch-out prediction. Unsupervised representation fitting uses all cells.\n- The PBMC loader supplies a historically selected 3,346-gene subset, not a whole-transcriptome input.\n- The canonical pancreas count layer contains fractional quantification values; these are preserved without rounding. Integer count-distribution assumptions are imperfect for this source.\n- scVI learns on the evaluation data and must be interpreted separately from zero-shot models.\n- Public benchmark data may overlap pretrained corpora; zero-shot does not prove unseen-data generalization.\n- Raw cell-type silhouette and ASW-batch have known geometry and batch-composition limitations. Inspect all metrics.\n- Peak RAM is the OS process high-water mark; it excludes other processes. Apple unified memory means it is not additive with device memory. Reliable Metal peak memory is unavailable and is null.\n- Representation time includes imports, model loading, preprocessing and writing embeddings; common evaluation and UMAP are separate. Downloads and installation are not included. Interrupted executions report only verified timing lower bounds when their unsaved tail cannot be measured.\n- Pretrained inputs use each model's required vocabulary and formatting. Exclusions and the common evaluation cell set are exported.\n")
    (report_dir / "reproduction.md").write_text(
        "# Reproduction\n\n"
        "In Liatir open Tools → Single-cell study, choose the recorded dataset and methods, and run. "
        "For the approved PC continuation select Use NVIDIA graphics card and more memory; this uses the separately recorded PC resource regime. "
        "Install available selected AI Models through AI Models. Unsupported signed targets remain explicit blockers. "
        "To continue a saved study, use Import saved study and choose its liatir-run.json. "
        "Completed results retain their original inputs, code, measurements and computer. "
        "The Plugin and public data are downloaded only when absent; installed runtimes work locally.\n\n"
        "This export retains Mac representations and the Windows/WSL2 continuation separately. "
        "It does not imply that every model has a CPU target on both computers.\n\n"
        "To reproduce all biological and batch scores, use Python 3.11 with the exact requirements.txt packages. "
        "From the repository root, run:\n\n"
        "```sh\npython showcases/single-cell-foundation-benchmark/reproduce.py <export-directory> "
        "--output <new-verification-directory>\n```\n\n"
        "This command verifies frozen evaluation code, package versions, count/split/embedding identities "
        "and recomputes every score with absolute tolerance 1e-9 and relative tolerance 1e-8. "
        "Missing values and their reasons must agree exactly. It does not repeat inference or scVI training.\n\n"
        "verify_counts.py compares every prepared source value and retained cell/gene identity with the "
        "checksummed canonical downloads; validate_artifacts.py checks all twelve configurations and ZIP integrity. "
        "See report/reproduction-validation.md and validation/ for tested commands and exact outcomes.\n")
    # The scientific bundle includes source counts, compact embeddings, metrics, plots and all logs.
    # Model-produced copies of the count matrix are referenced by provenance, avoiding duplicate matrices.
    bundle = root / "single-cell-study.zip"
    excluded = []
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path == bundle:
                continue
            relative = path.relative_to(root)
            if path.suffix in (".h5ad", ".torch", ".pkl", ".pt") and relative.parts[0] == "runs":
                excluded.append({"file": str(relative), "sha256": sha256(path), "bytes": path.stat().st_size})
                continue
            archive.write(path, str(relative))
        archive.writestr("referenced-intermediates.json", __import__('json').dumps(excluded, indent=2))
    artifacts = [bundle, results / "summary.csv", results / "summary.json", report_dir / "results.md"]
    return {"output": {"sections": sections}, "blockedCount": sum(r["status"] != "completed" for r in rows),
            "outputFiles": [{"label": p.name, "path": str(p), "ext": p.suffix[1:], "role": "final", "size": p.stat().st_size} for p in artifacts]}
