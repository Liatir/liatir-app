/** Explicit source identity keeps a known fractional count layer distinct from inferred normalized data. */
export const SOURCE_COUNT_VALIDATION_SCRIPT = String.raw`
def validate_source_counts(matrix, input_file, payload, summary_warnings, model_name):
    sample = matrix.data[: min(matrix.data.size, 100_000)]
    if not sample.size or np.mean(np.abs(sample - np.rint(sample)) > 1e-4) <= 0.01:
        return
    provenance = payload.get("sourceCountProvenance")
    # Only the independently identified canonical pancreas count layer is accepted.
    # A generic user file still follows the existing strict count-input guard.
    canonical_sha = "97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c"
    if not isinstance(provenance, dict) or provenance.get("kind") != "canonical-source-count-layer" \
            or provenance.get("source_layer") != "counts" or provenance.get("source_sha256") != canonical_sha:
        raise SystemExit(f"{model_name} requires raw counts, but AnnData .X appears normalized or log-transformed.")
    import hashlib
    digest = hashlib.sha256()
    with input_file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if provenance.get("prepared_sha256") != digest.hexdigest():
        raise SystemExit("The source-count provenance does not match the selected AnnData checksum.")
    summary_warnings.append(
        "Retained fractional values from the canonical pancreas source count layer without rounding. "
        "These are source-supplied quantification values; integer count assumptions are imperfect."
    )
`;
