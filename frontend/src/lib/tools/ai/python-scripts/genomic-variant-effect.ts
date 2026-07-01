export const GENOMIC_VARIANT_EFFECT_SCRIPT = String.raw`
import csv
import gzip
import json
import math
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", cache_dir)
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)

import numpy as np
import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

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
                records.append((current_id, "".join(current)))
            current_id = line[1:].strip().split()[0] or f"sequence_{len(records) + 1}"
            current = []
        else:
            current.append(line)
    if current_id is not None:
        records.append((current_id, "".join(current)))
    return records

def load_reference():
    reference_file = payload.get("referenceFile") or ""
    inline = (payload.get("sequence") or "").strip()
    reference_name = (payload.get("referenceName") or "").strip()
    if reference_file:
        with open_text(reference_file) as fh:
            records = parse_fasta(fh.read())
    elif inline:
        records = parse_fasta(inline) if inline.startswith(">") else [(reference_name or "sequence_1", inline)]
    else:
        records = []
    if not records:
        raise SystemExit("Reference FASTA or inline reference sequence is required.")
    if reference_name:
        for seq_id, seq in records:
            if seq_id == reference_name:
                return seq_id, clean_dna(seq)
        raise SystemExit(f"Reference name '{reference_name}' was not found in the FASTA input.")
    seq_id, seq = records[0]
    return seq_id, clean_dna(seq)

def clean_dna(seq):
    return "".join(ch for ch in seq.upper().replace("U", "T") if ch in "ACGTN")

def open_text(path):
    if path.lower().endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, "r", encoding="utf-8", errors="replace")

def parse_vcf(path, reference_name, max_variants):
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
            alt = alts.split(",")[0].strip().upper()
            if not alt or alt == ".":
                continue
            variants.append({
                "chrom": chrom,
                "pos": pos,
                "id": variant_id if variant_id and variant_id != "." else f"{chrom}:{pos}:{ref}>{alt}",
                "ref": clean_dna(ref),
                "alt": clean_dna(alt),
            })
            if len(variants) >= max_variants:
                break
    return variants

def variant_windows(reference_seq, variants, window_start, flank_size):
    windows = []
    warnings = []
    seq_len = len(reference_seq)
    for variant in variants:
        local = variant["pos"] - window_start
        ref = variant["ref"]
        alt = variant["alt"]
        if local < 0 or local >= seq_len:
            warnings.append(f"{variant['id']} is outside the provided reference window.")
            continue
        observed = reference_seq[local:local + len(ref)]
        ref_match = observed == ref
        if not ref_match:
            warnings.append(f"{variant['id']} REF mismatch: VCF={ref}, FASTA={observed or 'out-of-range'}.")
        left = max(0, local - flank_size)
        right = min(seq_len, local + max(1, len(ref)) + flank_size)
        prefix = reference_seq[left:local]
        suffix = reference_seq[local + len(ref):right]
        ref_window = reference_seq[left:right]
        alt_window = prefix + alt + suffix
        windows.append({
            **variant,
            "local": local,
            "windowStart": window_start + left,
            "windowEnd": window_start + right - 1,
            "refWindow": ref_window,
            "altWindow": alt_window,
            "refMatch": ref_match,
        })
    return windows, warnings

def embed_sequences(model, tokenizer, seqs, max_length, device):
    encoded = tokenizer.batch_encode_plus(
        seqs,
        return_tensors="pt",
        padding="max_length",
        truncation=True,
        max_length=max_length,
    )
    input_ids = encoded["input_ids"].to(device)
    mask = (input_ids != tokenizer.pad_token_id).to(device)
    with torch.no_grad():
        output = model(
            input_ids,
            attention_mask=mask,
            encoder_attention_mask=mask,
            output_hidden_states=True,
        )
        hidden = output["hidden_states"][-1]
        expanded = mask.unsqueeze(-1).expand(hidden.size()).float()
        pooled = (hidden * expanded).sum(dim=1) / expanded.sum(dim=1).clamp(min=1.0)
    return pooled.detach().cpu().numpy()

def cosine_distance(a, b):
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom <= 0:
        return 0.0
    return float(1.0 - (np.dot(a, b) / denom))

model_id = payload["hubModelId"]
revision = payload.get("hubRevision") or None
output_dir = payload["outputDir"]
variant_file = payload.get("variantFile") or ""
window_start = int(payload.get("windowStart") or 1)
flank_size = max(1, min(int(payload.get("flankSize") or 256), 4096))
max_variants = max(1, min(int(payload.get("maxVariants") or 20), 1000))
max_length = max(16, min(int(payload.get("maxLength") or 1024), 4096))
os.makedirs(output_dir, exist_ok=True)

if not variant_file:
    raise SystemExit("Variant VCF file is required.")

reference_name, reference_seq = load_reference()
variants = parse_vcf(variant_file, reference_name, max_variants)
if not variants:
    raise SystemExit("No variants from the VCF overlap the selected reference sequence/window.")

windows, warnings = variant_windows(reference_seq, variants, window_start, flank_size)
if not windows:
    raise SystemExit("No variants could be converted into reference/alternate windows.")

device = "cpu"
if torch.cuda.is_available():
    device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = "mps"

tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
model = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
model.eval()
model.to(device)

seqs = []
for item in windows:
    seqs.append(item["refWindow"])
    seqs.append(item["altWindow"])
embeddings = embed_sequences(model, tokenizer, seqs, max_length, device)

rows = []
for index, item in enumerate(windows):
    ref_emb = embeddings[index * 2]
    alt_emb = embeddings[index * 2 + 1]
    cos = cosine_distance(ref_emb, alt_emb)
    l2 = float(np.linalg.norm(alt_emb - ref_emb))
    rows.append({
        "variantId": item["id"],
        "chrom": item["chrom"],
        "pos": item["pos"],
        "ref": item["ref"],
        "alt": item["alt"],
        "windowStart": item["windowStart"],
        "windowEnd": item["windowEnd"],
        "refMatch": item["refMatch"],
        "cosineDistance": cos,
        "l2Delta": l2,
        "score": min(1000, max(0, int(round(cos * 1000)))),
    })

scores_path = os.path.join(output_dir, "variant-effect-scores.csv")
bed_path = os.path.join(output_dir, "variant-effect-scores.bed")
summary_path = os.path.join(output_dir, "variant-effect-summary.json")

with open(scores_path, "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)

with open(bed_path, "w", encoding="utf-8") as fh:
    for row in rows:
        start0 = max(0, int(row["pos"]) - 1)
        end0 = start0 + max(1, len(row["ref"]))
        fh.write(f"{row['chrom']}\t{start0}\t{end0}\t{row['variantId']}\t{row['score']}\n")

top = max(rows, key=lambda row: row["cosineDistance"])
summary = {
    "variantCount": len(rows),
    "referenceName": reference_name,
    "windowStart": window_start,
    "referenceLength": len(reference_seq),
    "model": model_id,
    "revision": revision,
    "device": device,
    "flankSize": flank_size,
    "maxLength": max_length,
    "topVariant": top,
    "warnings": warnings[:100],
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "scoresPath": scores_path,
    "bedPath": bed_path,
    "summaryPath": summary_path,
    "summary": summary,
    "preview": rows[:10],
}))
`;
