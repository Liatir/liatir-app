export const SEQUENCE_EMBEDDING_SCRIPT = String.raw`
import csv
import json
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
from transformers import AutoModel, AutoModelForMaskedLM, AutoTokenizer

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
            current_id = line[1:].strip() or f"seq_{len(records) + 1}"
            current = []
        else:
            current.append(line)
    if current_id is not None:
        records.append((current_id, "".join(current)))
    return records

def load_sequences():
    input_file = payload.get("inputFile")
    inline = (payload.get("sequence") or "").strip()
    if input_file:
        with open(input_file, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        records = parse_fasta(text)
        if records:
            return records
        compact = "".join(line.strip() for line in text.splitlines() if line.strip())
        return [("sequence_1", compact)] if compact else []
    if inline.startswith(">"):
        return parse_fasta(inline)
    return [("sequence_1", inline)] if inline else []

model_id = payload["hubModelId"]
revision = payload.get("hubRevision") or None
molecule_type = payload.get("moleculeType", "dna")
output_dir = payload["outputDir"]
max_length = int(payload.get("maxLength") or 1024)
os.makedirs(output_dir, exist_ok=True)

records = load_sequences()
if not records:
    raise SystemExit("No input sequence provided")

if molecule_type in ("dna", "rna"):
    cleaned = []
    for seq_id, seq in records:
        seq = seq.upper().replace("U", "T")
        cleaned.append((seq_id, "".join(ch for ch in seq if ch in "ACGTN")))
    records = cleaned
else:
    records = [(seq_id, seq.upper().replace("*", "")) for seq_id, seq in records]

device = "cpu"
if torch.cuda.is_available():
    device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = "mps"

tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
is_masked_lm = (payload.get("transformersLoader") or "auto-model") == "masked-lm"
if is_masked_lm:
    model = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
else:
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
model.eval()
model.to(device)

ids = [seq_id for seq_id, _ in records]
seqs = [seq for _, seq in records]
with torch.no_grad():
    if is_masked_lm:
        encoded = tokenizer.batch_encode_plus(
            seqs,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=max_length,
        )
        input_ids = encoded["input_ids"].to(device)
        mask = (input_ids != tokenizer.pad_token_id).to(device)
        output = model(
            input_ids,
            attention_mask=mask,
            encoder_attention_mask=mask,
            output_hidden_states=True,
        )
        hidden = output["hidden_states"][-1]
    else:
        encoded = tokenizer(
            seqs,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=max_length,
        )
        encoded = {k: v.to(device) for k, v in encoded.items()}
        output = model(**encoded)
        hidden = output.last_hidden_state
        mask = encoded.get("attention_mask")
    if mask is None:
        pooled = hidden.mean(dim=1)
    else:
        expanded = mask.unsqueeze(-1).expand(hidden.size()).float()
        pooled = (hidden * expanded).sum(dim=1) / expanded.sum(dim=1).clamp(min=1.0)
    embeddings = pooled.detach().cpu().numpy()

embedding_path = os.path.join(output_dir, "sequence-embeddings.csv")
summary_path = os.path.join(output_dir, "sequence-embedding-summary.json")
with open(embedding_path, "w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    dim = embeddings.shape[1]
    writer.writerow(["sequence_id", "length"] + [f"dim_{i}" for i in range(dim)])
    for seq_id, seq, emb in zip(ids, seqs, embeddings):
        writer.writerow([seq_id, len(seq)] + [float(x) for x in emb])

summary = {
    "sequenceCount": int(len(records)),
    "embeddingDim": int(embeddings.shape[1]),
    "model": model_id,
    "revision": revision,
    "moleculeType": molecule_type,
    "device": device,
    "meanSequenceLength": float(np.mean([len(seq) for seq in seqs])),
    "maxLength": max_length,
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "embeddingPath": embedding_path,
    "summaryPath": summary_path,
    "summary": summary,
    "preview": embeddings[:3, :8].tolist(),
}))
`;
