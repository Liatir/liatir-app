export const REGULATORY_PREDICTION_SCRIPT = String.raw`
import csv
import gzip
import json
import os
import sys
import warnings as py_warnings

py_warnings.filterwarnings("ignore", category=FutureWarning, module=r"google\.api_core\._python_version_support")
py_warnings.filterwarnings("ignore", message=r"pkg_resources is deprecated as an API.*", category=UserWarning)

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("TFHUB_CACHE_DIR", os.path.join(cache_dir, "tfhub"))

import numpy as np
import tensorflow as tf

BASE_TO_INDEX = {"A": 0, "C": 1, "G": 2, "T": 3}

def open_text(path):
    if path.lower().endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, "r", encoding="utf-8", errors="replace")

def clean_dna(seq):
    return "".join(ch for ch in seq.upper().replace("U", "T") if ch in "ACGTN")

def parse_fasta(text):
    records = []
    current_id = None
    current = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current_id is not None:
                records.append((current_id, clean_dna("".join(current))))
            current_id = line[1:].strip().split()[0] or f"sequence_{len(records) + 1}"
            current = []
        else:
            current.append(line)
    if current_id is not None:
        records.append((current_id, clean_dna("".join(current))))
    return records

def load_reference():
    reference_file = payload.get("referenceFile") or ""
    inline = (payload.get("sequence") or "").strip()
    reference_name = (payload.get("referenceName") or "").strip()
    if reference_file:
        with open_text(reference_file) as fh:
            records = parse_fasta(fh.read())
    elif inline:
        records = parse_fasta(inline) if inline.startswith(">") else [(reference_name or "sequence_1", clean_dna(inline))]
    else:
        records = []
    if not records:
        raise SystemExit("Reference FASTA or inline sequence is required.")
    if reference_name:
        for seq_id, seq in records:
            if seq_id == reference_name:
                return seq_id, seq
        raise SystemExit(f"Reference name '{reference_name}' was not found in the FASTA input.")
    return records[0]

def parse_vcf(path, reference_name, max_variants):
    if not path:
        return []
    variants = []
    with open_text(path) as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) < 5:
                continue
            chrom, pos_raw, variant_id, ref, alts = cols[:5]
            if reference_name and chrom != reference_name:
                continue
            try:
                pos = int(pos_raw)
            except ValueError:
                continue
            alt = clean_dna(alts.split(",")[0])
            ref = clean_dna(ref)
            if not ref or not alt:
                continue
            variants.append({
                "chrom": chrom,
                "pos": pos,
                "id": variant_id if variant_id and variant_id != "." else f"{chrom}:{pos}:{ref}>{alt}",
                "ref": ref,
                "alt": alt,
            })
            if len(variants) >= max_variants:
                break
    return variants

def slice_with_padding(seq, start, length):
    left_pad = max(0, -start)
    right = start + length
    right_pad = max(0, right - len(seq))
    clipped_start = max(0, start)
    clipped_end = min(len(seq), right)
    return ("N" * left_pad) + seq[clipped_start:clipped_end] + ("N" * right_pad)

def centered_window_with_start(seq, length):
    center = len(seq) // 2
    start = center - length // 2
    return slice_with_padding(seq, start, length), start

def variant_windows(reference_seq, variants, window_start, length):
    windows = []
    warnings = []
    for variant in variants:
        local = variant["pos"] - window_start
        if local < 0 or local >= len(reference_seq):
            warnings.append(f"{variant['id']} is outside the provided reference window.")
            continue
        ref = variant["ref"]
        alt = variant["alt"]
        observed = reference_seq[local:local + len(ref)]
        ref_match = observed == ref
        if not ref_match:
            warnings.append(f"{variant['id']} REF mismatch: VCF={ref}, FASTA={observed or 'out-of-range'}.")
        start = local - length // 2
        alt_seq = reference_seq[:local] + alt + reference_seq[local + len(ref):]
        windows.append({
            **variant,
            "refMatch": ref_match,
            "windowStart": window_start + start,
            "refWindow": slice_with_padding(reference_seq, start, length),
            "altWindow": slice_with_padding(alt_seq, start, length),
        })
    return windows, warnings

def one_hot(seq):
    arr = np.zeros((len(seq), 4), dtype=np.float32)
    for i, base in enumerate(seq):
        index = BASE_TO_INDEX.get(base)
        if index is not None:
            arr[i, index] = 1.0
    return arr

def fit_target_index(prediction, target_index):
    if prediction.ndim == 1:
        return prediction
    if prediction.ndim < 2:
        return prediction.reshape(-1)
    max_index = prediction.shape[-1] - 1
    index = max(0, min(int(target_index), int(max_index)))
    return prediction[:, index]

def load_enformer(tfhub_url):
    import tensorflow_hub as hub
    loaded = hub.load(tfhub_url)
    return getattr(loaded, "model", loaded)

def load_basenji(params_path, model_path):
    from basenji import seqnn
    with open(params_path, "r", encoding="utf-8") as fh:
        params = json.load(fh)
    params_model = params["model"]
    params_model["verbose"] = False
    model = seqnn.SeqNN(params_model)
    model.restore(model_path)
    return model.model

def load_borzoi(params_path, model_path):
    from baskerville import seqnn
    with open(params_path, "r", encoding="utf-8") as fh:
        params = json.load(fh)
    params_model = params["model"]
    params_model["verbose"] = False
    model = seqnn.SeqNN(params_model)
    model.restore(model_path)
    return model.model

def model_input_length(model):
    shape = getattr(model, "input_shape", None)
    if isinstance(shape, list) and shape:
        shape = shape[0]
    if shape is not None:
        try:
            if len(shape) >= 3 and shape[1] is not None:
                return int(shape[1])
        except TypeError:
            pass
    inputs = getattr(model, "inputs", None)
    if inputs:
        input_shape = getattr(inputs[0], "shape", None)
        if hasattr(input_shape, "as_list"):
            input_shape = input_shape.as_list()
        if input_shape is not None and len(input_shape) >= 3 and input_shape[1] is not None:
            return int(input_shape[1])
    return None

def params_seq_length(params_path):
    if not params_path:
        return None
    try:
        with open(params_path, "r", encoding="utf-8") as fh:
            params = json.load(fh)
        seq_length = params.get("model", {}).get("seq_length")
        return int(seq_length) if seq_length else None
    except Exception:
        return None

def predict_batch(model, backend, seqs, head):
    batch = np.stack([one_hot(seq) for seq in seqs], axis=0)
    if backend == "enformer":
        raw = model.predict_on_batch(batch) if hasattr(model, "predict_on_batch") else model(batch)
        if isinstance(raw, dict):
            if head in raw:
                raw = raw[head]
            elif "human" in raw:
                raw = raw["human"]
            else:
                raw = next(iter(raw.values()))
        raw = raw.numpy() if hasattr(raw, "numpy") else raw
        return np.asarray(raw)
    raw = model(tf.convert_to_tensor(batch, dtype=tf.float32))
    raw = raw.numpy() if hasattr(raw, "numpy") else raw
    return np.asarray(raw)

backend = payload["backend"]
output_dir = payload["outputDir"]
os.makedirs(output_dir, exist_ok=True)
if not cache_dir:
    raise SystemExit("Regulatory prediction requires an installed model cache.")

reference_name, reference_seq = load_reference()
if not reference_seq:
    raise SystemExit("Reference sequence is empty after DNA normalization.")

requested_context_window = int(payload.get("contextWindow") or 0)
if requested_context_window <= 0:
    raise SystemExit("Regulatory model context window is missing.")
context_window = requested_context_window
target_index = int(payload.get("targetIndex") or 0)
output_head = payload.get("outputHead") or "human"
window_start = int(payload.get("windowStart") or 1)
max_variants = max(0, min(int(payload.get("maxVariants") or 0), 1000))
variant_file = payload.get("variantFile") or ""

warnings = []
model = None
model_source = None
params_path = ""
if backend == "enformer":
    model_source = payload["tfhubUrl"]
    model = load_enformer(model_source)
elif backend == "basenji2":
    model_source = os.path.join(cache_dir, payload["modelFile"])
    params_path = os.path.join(cache_dir, payload["paramsFile"])
    model = load_basenji(params_path, model_source)
elif backend == "borzoi-mini":
    model_source = os.path.join(cache_dir, payload["modelFile"])
    params_path = os.path.join(cache_dir, payload["paramsFile"])
    model = load_borzoi(params_path, model_source)
else:
    raise SystemExit(f"Unsupported regulatory backend: {backend}")

runtime_context_window = model_input_length(model) or params_seq_length(params_path) or requested_context_window
if runtime_context_window <= 0:
    raise SystemExit("Regulatory model input length could not be determined.")
context_window = int(runtime_context_window)
if context_window != requested_context_window:
    warnings.append(f"Model artifact expects {context_window} bp; Liatir adjusted the requested {requested_context_window} bp window.")

if len(reference_seq) < context_window:
    warnings.append(f"Reference sequence is shorter than the model context window ({len(reference_seq)} bp < {context_window} bp); Liatir pads missing context with N.")
if len(reference_seq) > context_window:
    warnings.append(f"Reference sequence is longer than the model context window; Liatir uses the centered {context_window} bp window for signal prediction.")

signal_seq, signal_window_start = centered_window_with_start(reference_seq, context_window)
prediction = predict_batch(model, backend, [signal_seq], output_head)[0]
signal = fit_target_index(prediction, target_index).astype("float32")

signal_rows = []
bin_count = int(signal.shape[0])
span = max(1, context_window)
for idx, value in enumerate(signal):
    local_start = int(round(idx * span / max(1, bin_count)))
    local_end = max(local_start + 1, int(round((idx + 1) * span / max(1, bin_count))))
    signal_rows.append({
        "binIndex": idx,
        "chrom": reference_name,
        "start": max(0, window_start + signal_window_start + local_start - 1),
        "end": max(1, window_start + signal_window_start + local_end - 1),
        "value": float(value),
    })

signal_csv_path = os.path.join(output_dir, "regulatory-prediction-signal.csv")
signal_bed_path = os.path.join(output_dir, "regulatory-prediction-signal.bed")
with open(signal_csv_path, "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["binIndex", "chrom", "start", "end", "value"])
    writer.writeheader()
    writer.writerows(signal_rows)
with open(signal_bed_path, "w", encoding="utf-8") as fh:
    for row in signal_rows:
        score = min(1000, max(0, int(round(float(row["value"]) * 1000))))
        fh.write(f"{row['chrom']}\t{row['start']}\t{row['end']}\tbin_{row['binIndex']}\t{score}\n")

variant_rows = []
if variant_file and max_variants > 0:
    variants = parse_vcf(variant_file, reference_name, max_variants)
    windows, variant_warnings = variant_windows(reference_seq, variants, window_start, context_window)
    warnings.extend(variant_warnings)
    for item in windows:
        preds = predict_batch(model, backend, [item["refWindow"], item["altWindow"]], output_head)
        ref_signal = fit_target_index(preds[0], target_index).astype("float32")
        alt_signal = fit_target_index(preds[1], target_index).astype("float32")
        delta = alt_signal - ref_signal
        mean_delta = float(np.mean(delta))
        max_abs_delta = float(np.max(np.abs(delta))) if delta.size else 0.0
        variant_rows.append({
            "variantId": item["id"],
            "chrom": item["chrom"],
            "pos": item["pos"],
            "ref": item["ref"],
            "alt": item["alt"],
            "refMatch": item["refMatch"],
            "meanDelta": mean_delta,
            "maxAbsDelta": max_abs_delta,
            "score": min(1000, max(0, int(round(abs(mean_delta) * 1000)))),
        })

variant_csv_path = os.path.join(output_dir, "regulatory-variant-scores.csv")
variant_bed_path = os.path.join(output_dir, "regulatory-variant-scores.bed")
if variant_rows:
    with open(variant_csv_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(variant_rows[0].keys()))
        writer.writeheader()
        writer.writerows(variant_rows)
    with open(variant_bed_path, "w", encoding="utf-8") as fh:
        for row in variant_rows:
            start0 = max(0, int(row["pos"]) - 1)
            end0 = start0 + max(1, len(row["ref"]))
            fh.write(f"{row['chrom']}\t{start0}\t{end0}\t{row['variantId']}\t{row['score']}\n")
else:
    variant_csv_path = ""
    variant_bed_path = ""

top_variant = max(variant_rows, key=lambda row: abs(row["meanDelta"])) if variant_rows else None
summary = {
    "backend": backend,
    "modelSource": model_source if backend == "enformer" else os.path.basename(model_source or ""),
    "referenceName": reference_name,
    "referenceLength": len(reference_seq),
    "windowStart": window_start,
    "contextWindow": context_window,
    "requestedContextWindow": requested_context_window,
    "outputHead": output_head,
    "targetIndex": target_index,
    "binCount": bin_count,
    "meanSignal": float(np.mean(signal)) if signal.size else 0.0,
    "maxSignal": float(np.max(signal)) if signal.size else 0.0,
    "variantCount": len(variant_rows),
    "topVariant": top_variant,
    "warnings": warnings[:100],
}
summary_path = os.path.join(output_dir, "regulatory-prediction-summary.json")
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "signalCsvPath": signal_csv_path,
    "signalBedPath": signal_bed_path,
    "variantCsvPath": variant_csv_path,
    "variantBedPath": variant_bed_path,
    "summaryPath": summary_path,
    "summary": summary,
    "signalPreview": signal_rows[:10],
    "variantPreview": variant_rows[:10],
}))
`;
