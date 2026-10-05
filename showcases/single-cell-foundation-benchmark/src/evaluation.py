"""One evaluator, with explicit cell alignment and supervised split reuse."""
import time
import warnings

from common import SEED, read_json, sha256, write_json


def align_embeddings(root, dataset, methods):
    import numpy as np
    import pandas as pd
    obs = pd.read_csv(root / "datasets" / dataset / "split.csv", index_col="cell_id", dtype=str)
    arrays = {}
    common = set(obs.index)
    for method in methods:
        path = root / "runs" / dataset / method / "provenance.json"
        if not path.exists() or read_json(path).get("status") != "completed":
            continue
        provenance = read_json(path)
        file = root / "runs" / dataset / method / "embedding.npz"
        if sha256(file) != provenance["embedding"]["sha256"]:
            raise ValueError(f"Embedding checksum changed for {dataset}/{method}")
        with np.load(file, allow_pickle=False) as content:
            values, ids = content["values"], content["cell_ids"].astype(str)
        if len(set(ids)) != len(ids) or not set(ids).issubset(obs.index):
            raise ValueError(f"Unknown or duplicate cell identities in {method}")
        arrays[method] = (values, ids)
        common.intersection_update(ids)
    if not arrays or len(common) < 10:
        raise ValueError("No sufficiently large common valid cell set.")
    selected = obs.index[obs.index.isin(common)]
    aligned = {}
    exclusions = {}
    for method, (values, ids) in arrays.items():
        lookup = {name: i for i, name in enumerate(ids)}
        aligned[method] = values[[lookup[name] for name in selected]]
        exclusions[method] = {"missing_from_model": obs.index[~obs.index.isin(ids)].tolist(),
                              "excluded_for_common_set": [name for name in ids if name not in common]}
    write_json(root / "datasets" / dataset / "evaluation_cells.json",
               {"cells": selected.tolist(), "exclusions": exclusions,
                "split_policy": "Original fixed split intersected with common cells; never regenerated"})
    return obs.loc[selected], aligned


def score_embedding(values, obs):
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score, silhouette_score, silhouette_samples, f1_score
    from sklearn.neighbors import KNeighborsClassifier, NearestNeighbors
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from scipy import sparse
    from scipy.sparse.csgraph import connected_components
    from scib_metrics import ilisi_knn
    from scib_metrics.nearest_neighbors import NeighborsResults

    if not np.isfinite(values).all():
        raise ValueError("Evaluation refuses non-finite embeddings.")
    labels = obs.cell_type.to_numpy()
    batch = obs.batch.to_numpy()
    train = obs.split.to_numpy() == "train"
    test = ~train
    if set(labels[train]) != set(labels) or set(labels[test]) != set(labels):
        raise ValueError("Common-cell intersection removed an entire label from a split.")
    clusters = KMeans(n_clusters=len(set(labels)), n_init=20, random_state=SEED).fit_predict(values)
    knn = KNeighborsClassifier(n_neighbors=15, weights="uniform", n_jobs=1).fit(values[train], labels[train])
    classifier = make_pipeline(StandardScaler(), LogisticRegression(C=1, max_iter=2000, random_state=SEED))
    classifier.fit(values[train], labels[train])
    raw_batch = None
    asw_by_label = []
    reasons = {}
    if len(set(batch)) > 1:
        raw_batch = float(silhouette_score(values, batch))
        for label in sorted(set(labels)):
            mask = labels == label
            if 1 < len(set(batch[mask])) < int(mask.sum()):
                asw_by_label.append(float(np.mean(1 - np.abs(silhouette_samples(values[mask], batch[mask])))))
    else:
        reasons["batch_silhouette"] = "Only one batch in the common cell set."
    if not asw_by_label:
        reasons["asw_batch"] = "No biological label contains two meaningful batches."
    neighbor_count = min(90, len(values) - 1)
    distances, indices = NearestNeighbors(n_neighbors=neighbor_count + 1, n_jobs=1).fit(values).kneighbors(values)
    # The first neighbor is the cell itself. All metrics use the same Euclidean geometry.
    distances, indices = distances[:, 1:], indices[:, 1:]
    graph = sparse.csr_matrix((np.ones(len(values) * 15),
                               (np.repeat(np.arange(len(values)), 15), indices[:, :15].ravel())),
                              shape=(len(values), len(values)))
    connectivity = []
    for label in sorted(set(labels)):
        mask = labels == label
        _, components = connected_components(graph[mask][:, mask], directed=True, connection="strong")
        connectivity.append(float(np.bincount(components).max() / mask.sum()))
    mixing = float(ilisi_knn(NeighborsResults(indices=indices, distances=distances), batch,
                             perplexity=30, scale=True)) if len(set(batch)) > 1 else None
    return {
        "ari": float(adjusted_rand_score(labels, clusters)),
        "nmi": float(normalized_mutual_info_score(labels, clusters)),
        "cell_type_silhouette": float(silhouette_score(values, labels)),
        "knn_macro_f1": float(f1_score(labels[test], knn.predict(values[test]), average="macro", zero_division=0)),
        "logistic_macro_f1": float(f1_score(labels[test], classifier.predict(values[test]), average="macro", zero_division=0)),
        "batch_silhouette": raw_batch,
        "asw_batch": float(np.mean(asw_by_label)) if asw_by_label else None,
        "graph_connectivity": float(np.mean(connectivity)),
        "ilisi_scaled": mixing, "null_reasons": reasons,
        "evaluation_cells": len(values), "train_cells": int(train.sum()), "test_cells": int(test.sum()),
        "label_count": len(set(labels)), "batch_count": len(set(batch)),
    }


def evaluate(root, dataset, methods):
    import numpy as np
    import umap
    from sklearn import config_context
    obs, arrays = align_embeddings(root, dataset, methods)
    for method, values in arrays.items():
        directory = root / "runs" / dataset / method
        print(f"Evaluating {dataset}/{method}: {len(values)} common cells", flush=True)
        started = time.perf_counter()
        with config_context(working_memory=64), warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            metrics = score_embedding(values, obs)
        metrics["warnings"] = [str(w.message) for w in caught]
        metrics["evaluation_seconds"] = time.perf_counter() - started
        write_json(directory / "metrics.json", metrics)
        coordinates = umap.UMAP(n_neighbors=15, min_dist=0.3, metric="euclidean", random_state=SEED,
                                n_jobs=1).fit_transform(values)
        preview = obs[["cell_type", "batch", "split"]].copy()
        preview["umap_1"], preview["umap_2"] = coordinates[:, 0], coordinates[:, 1]
        preview.to_csv(directory / "umap.csv", index_label="cell_id")
    return {"dataset": dataset, "completed_methods": list(arrays), "common_cells": len(obs)}
