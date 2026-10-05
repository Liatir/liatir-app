"""Scientific regression checks, run in the showcase's managed Python environment."""
import json
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
import pandas as pd
from common import save_embedding, write_json
from evaluation import align_embeddings, score_embedding


class StudyTests(unittest.TestCase):
    def test_memory_bounded_hvg_path_matches_original_values_and_pca(self):
        import anndata as ad
        import scanpy as sc
        from scipy import sparse
        from representations import hvg_data
        from common import SEED
        rng = np.random.default_rng(SEED)
        raw = sparse.csr_matrix(rng.poisson(rng.uniform(0.1, 5, 2400), (100, 2400)).astype(np.float32))
        obs = pd.DataFrame({"batch": pd.Categorical(["a"] * 50 + ["b"] * 50)},
                           index=[f"cell-{i}" for i in range(100)])
        original = ad.AnnData(raw, obs=obs)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / "datasets/pbmc"
            directory.mkdir(parents=True)
            original.write_h5ad(directory / "counts.h5ad")
            reference = original.copy()
            reference.layers["counts"] = reference.X.copy()
            sc.pp.normalize_total(reference, target_sum=1e4)
            sc.pp.log1p(reference)
            sc.pp.highly_variable_genes(reference, flavor="seurat", n_top_genes=2000, batch_key="batch")
            reference = reference[:, reference.var.highly_variable].copy()
            measured = hvg_data(root, "pbmc", retain_counts=True)
            self.assertEqual(reference.var_names.tolist(), measured.var_names.tolist())
            for expected, actual in ((reference.X, measured.X),
                                     (reference.layers["counts"], measured.layers["counts"])):
                self.assertEqual(expected.dtype, actual.dtype)
                np.testing.assert_array_equal(expected.toarray(), actual.toarray())
            without_counts = hvg_data(root, "pbmc")
            self.assertNotIn("counts", without_counts.layers)
            for data in (reference, without_counts):
                sc.pp.scale(data, max_value=10)
                sc.tl.pca(data, n_comps=50, svd_solver="arpack", random_state=SEED)
            np.testing.assert_array_equal(reference.obsm["X_pca"], without_counts.obsm["X_pca"])

    def test_fractional_source_counts_need_exact_canonical_provenance(self):
        from scipy import sparse
        from study_data import PANCREAS_SHA256
        helper = Path(__file__).resolve().parents[3] / "frontend/src/lib/tools/ai/python-scripts/source-count-validation.ts"
        source = helper.read_text().split("String.raw`", 1)[1].rsplit("`;", 1)[0]
        namespace = {"np": np}
        exec(compile(source, str(helper), "exec"), namespace)
        validate = namespace["validate_source_counts"]
        matrix = sparse.csr_matrix([[0.5, 1.75]])
        original = matrix.copy()
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "prepared.h5ad"
            file.write_bytes(b"prepared fixture")
            provenance = {"kind": "canonical-source-count-layer", "source_layer": "counts",
                          "source_sha256": PANCREAS_SHA256,
                          "prepared_sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
            for payload in ({}, {"sourceCountProvenance": {**provenance, "source_sha256": "wrong"}},
                            {"sourceCountProvenance": {**provenance, "prepared_sha256": "wrong"}}):
                with self.assertRaises(SystemExit):
                    validate(matrix, file, payload, [], "Geneformer")
            warnings = []
            validate(matrix, file, {"sourceCountProvenance": provenance}, warnings, "Geneformer")
            np.testing.assert_array_equal(matrix.toarray(), original.toarray())
            self.assertTrue(any("without rounding" in message for message in warnings))

    def test_alignment_uses_identity_not_row_position_and_preserves_split(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "datasets" / "pbmc"
            source.mkdir(parents=True)
            ids = [f"cell-{i}" for i in range(12)]
            obs = pd.DataFrame({"cell_type": ["a", "b"] * 6, "batch": ["x", "y"] * 6,
                                "split": ["train"] * 8 + ["test"] * 4}, index=ids)
            obs.to_csv(source / "split.csv", index_label="cell_id")
            for method, order in (("pca", list(range(12))), ("geneformer", list(reversed(range(1, 12))))):
                directory = root / "runs" / "pbmc" / method
                directory.mkdir(parents=True)
                embedding = save_embedding(directory, np.array(order)[:, None], [ids[i] for i in order])
                write_json(directory / "provenance.json", {"status": "completed", "embedding": embedding})
            selected, embeddings = align_embeddings(root, "pbmc", ["pca", "geneformer"])
            self.assertEqual(selected.index.tolist(), ids[1:])
            self.assertEqual(selected.split.tolist(), obs.iloc[1:].split.tolist())
            np.testing.assert_array_equal(embeddings["pca"], embeddings["geneformer"])
            # Observe the checksum guard failing after corruption, before restoring the fixture.
            target = root / "runs/pbmc/pca/embedding.npz"
            original = target.read_bytes()
            target.write_bytes(original + b"corruption")
            with self.assertRaisesRegex(ValueError, "checksum changed"):
                align_embeddings(root, "pbmc", ["pca", "geneformer"])
            target.write_bytes(original)
            align_embeddings(root, "pbmc", ["pca", "geneformer"])

    def test_nonfinite_and_duplicate_embeddings_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            for values, ids in (([[np.nan], [0]], ["a", "b"]), ([[1], [2]], ["a", "a"])):
                with self.assertRaises(ValueError):
                    save_embedding(temporary, values, ids)

    def test_separable_biology_mixed_batches_and_permuted_labels(self):
        rng = np.random.default_rng(23)
        labels = np.repeat(["a", "b", "c"], 60)
        values = rng.normal(0, 0.1, (180, 4)) + np.repeat([0, 10, 20], 60)[:, None]
        obs = pd.DataFrame({"cell_type": labels, "batch": np.tile(["x", "y"], 90),
                            "split": np.tile(["train"] * 4 + ["test"], 36)})
        measured = score_embedding(values, obs)
        self.assertAlmostEqual(measured["ari"], 1)
        self.assertAlmostEqual(measured["knn_macro_f1"], 1)
        self.assertAlmostEqual(measured["logistic_macro_f1"], 1)
        self.assertGreater(measured["asw_batch"], 0.8)
        self.assertTrue(0 <= measured["ilisi_scaled"] <= 1)
        permuted = obs.copy()
        permuted["cell_type"] = rng.permutation(labels)
        negative = score_embedding(values, permuted)
        self.assertLess(negative["ari"], 0.1)
        self.assertLess(negative["logistic_macro_f1"], 0.6)


if __name__ == "__main__":
    unittest.main()
