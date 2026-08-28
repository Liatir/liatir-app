/** Offline MHCflurry 2.2.1 adapter. Runtime Box assets are passed explicitly; no downloader runs. */
export const MHCFLURRY_EPITOPE_SCRIPT = String.raw`
import csv
import json
import math
import os
import pathlib
import socket
import sys

AMINO_ACIDS = set("ARNDCEQGHILKMFPSTWYV")

def fail(message):
    raise ValueError(message)

def deny_network(*_args, **_kwargs):
    raise RuntimeError("Network access is disabled for this local AI Tool run.")

def append_fasta_record(rows, record_name, sequence, lengths, max_rows):
    if not sequence:
        fail("FASTA sequence %s is empty." % record_name)
    invalid = sorted(set(sequence) - AMINO_ACIDS)
    if invalid:
        fail("FASTA sequence %s contains unsupported amino acids: %s." % (record_name, ", ".join(invalid)))
    for length in lengths:
        for start in range(0, len(sequence) - length + 1):
            if len(rows) >= max_rows:
                fail("This run would create more than 2,000,000 allele-peptide predictions. Reduce the input or selected lengths.")
            rows.append({
                "source_name": record_name,
                "position": start + 1,
                "peptide": sequence[start:start + length],
                "n_flank": sequence[max(0, start - 5):start],
                "c_flank": sequence[start + length:start + length + 5],
            })

def read_fasta(path, lengths, max_rows):
    name = None
    chunks = []
    rows = []
    sequence_count = 0
    total_residues = 0
    with open(path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            if line.startswith(">"):
                if name is not None:
                    sequence = "".join(chunks).upper()
                    append_fasta_record(rows, name, sequence, lengths, max_rows)
                    sequence_count += 1
                    total_residues += len(sequence)
                name = line[1:].strip().split()[0] if line[1:].strip() else "sequence_%d" % (sequence_count + 1)
                chunks = []
            else:
                if name is None:
                    fail("The FASTA input must start with a > sequence header.")
                chunks.append("".join(line.split()))
    if name is not None:
        sequence = "".join(chunks).upper()
        append_fasta_record(rows, name, sequence, lengths, max_rows)
        sequence_count += 1
        total_residues += len(sequence)
    if sequence_count == 0:
        fail("The FASTA input contains no protein sequences.")
    return rows, sequence_count, total_residues

def read_peptide_table(path, lengths, max_rows):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        if not sample.strip():
            fail("The peptide table is empty.")
        handle.seek(0)
        delimiter = "\t" if "\t" in sample.splitlines()[0] else ","
        reader = csv.DictReader(handle, delimiter=delimiter)
        if not reader.fieldnames or "peptide" not in [field.strip().lower() for field in reader.fieldnames]:
            fail("The peptide table must contain a peptide column.")
        columns = {field.strip().lower(): field for field in reader.fieldnames}
        rows = []
        for index, row in enumerate(reader, start=2):
            if len(rows) >= max_rows:
                fail("This run would create more than 2,000,000 allele-peptide predictions. Reduce the input or selected lengths.")
            peptide = (row.get(columns["peptide"]) or "").strip().upper()
            if not peptide:
                fail("Peptide table row %d has no peptide." % index)
            if len(peptide) not in lengths:
                fail("Peptide table row %d has length %d, outside the selected lengths." % (index, len(peptide)))
            invalid = sorted(set(peptide) - AMINO_ACIDS)
            if invalid:
                fail("Peptide table row %d contains unsupported amino acids: %s." % (index, ", ".join(invalid)))
            rows.append({
                "source_name": (row.get(columns.get("name", "")) or "row_%d" % (index - 1)).strip(),
                "position": None,
                "peptide": peptide,
                "n_flank": (row.get(columns.get("n_flank", "")) or "").strip().upper(),
                "c_flank": (row.get(columns.get("c_flank", "")) or "").strip().upper(),
            })
    if not rows:
        fail("The peptide table contains no peptide rows.")
    return rows

payload = json.load(sys.stdin)
input_file = pathlib.Path(payload["inputFile"])
output_dir = pathlib.Path(payload["outputDir"])
models_dir = pathlib.Path(payload["modelCacheDir"]) / "models"
runtime_path = pathlib.Path(payload["runtimePath"])
alleles = payload["alleles"]
lengths = payload["peptideLengths"]
mode = payload["mode"]
requested_accelerator = payload.get("accelerator", "auto")
top_count = int(payload.get("topCount", 50))

if not isinstance(alleles, list) or not (1 <= len(alleles) <= 12):
    fail("Between 1 and 12 HLA Class I alleles are required.")
if not isinstance(lengths, list) or not lengths or any(
    not isinstance(length, int) or isinstance(length, bool) or length not in range(8, 16)
    for length in lengths
):
    fail("MHC Class I peptide lengths must be whole numbers from 8 to 15.")
if not 1 <= top_count <= 5_000:
    fail("Top result count must be between 1 and 5,000.")
if mode not in ("binding", "presentation"):
    fail("Prediction mode must be binding or presentation.")
if requested_accelerator not in ("auto", "cpu", "mps", "cuda"):
    fail("Accelerator must be auto, cpu, mps, or cuda.")
if not models_dir.joinpath("weights.csv").is_file():
    fail("The signed Runtime Box does not contain the MHCflurry presentation models.")

max_base_rows = 2_000_000 // len(alleles)
if payload["inputKind"] == "fasta":
    base_rows, sequence_count, total_residues = read_fasta(input_file, lengths, max_base_rows)
elif payload["inputKind"] == "peptide-table":
    base_rows = read_peptide_table(input_file, lengths, max_base_rows)
    sequence_count = None
    total_residues = None
else:
    fail("Input type must be fasta or peptide-table.")

prediction_count = len(base_rows) * len(alleles)
if prediction_count > 2_000_000:
    fail("This run would create more than 2,000,000 allele-peptide predictions. Reduce the input or selected lengths.")

# Imports happen only after complete bounded input validation. The socket guard proves that an
# accidental future library call cannot turn this local run into a web request.
socket.socket.connect = deny_network
socket.create_connection = deny_network
sys.path[:0] = [
    str(runtime_path / "source" / "mhcflurry-wheel"),
    str(runtime_path / "source" / "mhcgnomes-wheel"),
    str(runtime_path / "source" / "np-utils-sdist"),
]
import pandas
import torch
from mhcflurry import Class1PresentationPredictor, __version__ as mhcflurry_version
from mhcflurry.common import configure_pytorch, get_pytorch_device

configure_pytorch(backend="gpu" if requested_accelerator == "cuda" else requested_accelerator)

print("Loading bundled MHCflurry Class I presentation models.", flush=True)
predictor = Class1PresentationPredictor.load(str(models_dir))
unsupported = [allele for allele in alleles if allele not in predictor.supported_alleles]
if unsupported:
    fail("Unsupported HLA Class I allele(s): %s." % ", ".join(unsupported))

query_rows = []
for base in base_rows:
    for allele in alleles:
        query_rows.append({**base, "allele": allele})
queries = pandas.DataFrame(query_rows)
allele_map = {allele: [allele] for allele in alleles}
print("Running %d local predictions." % len(queries), flush=True)
if mode == "binding":
    predictions = predictor.predict_affinity(
        peptides=queries.peptide.values,
        alleles=allele_map,
        sample_names=queries.allele.values,
        include_affinity_percentile=True,
        throw=True,
    )
    rank_column = "affinity"
    ascending = True
else:
    predictions = predictor.predict(
        peptides=queries.peptide.values,
        alleles=allele_map,
        sample_names=queries.allele.values,
        n_flanks=queries.n_flank.values,
        c_flanks=queries.c_flank.values,
        include_affinity_percentile=True,
        throw=True,
    )
    rank_column = "presentation_score"
    ascending = False

for column in predictions.columns:
    if column not in ("peptide", "allele", "sample_name", "peptide_num"):
        queries[column] = predictions[column].values
if rank_column not in queries.columns:
    fail("MHCflurry did not return the expected %s ranking column." % rank_column)
ranking_values = pandas.to_numeric(queries[rank_column], errors="coerce")
if not all(math.isfinite(float(value)) for value in ranking_values):
    fail("MHCflurry returned a non-finite ranking score.")

queries = queries.sort_values(rank_column, ascending=ascending, kind="mergesort").reset_index(drop=True)
queries.insert(0, "rank", range(1, len(queries) + 1))
output_dir.mkdir(parents=True, exist_ok=True)
predictions_path = output_dir / "mhcflurry-class1-predictions.csv"
best_fasta_path = output_dir / "mhcflurry-top-peptides.fasta"
summary_path = output_dir / "mhcflurry-summary.json"
queries.to_csv(predictions_path, index=False)

seen = set()
best = []
for row in queries.itertuples(index=False):
    key = (row.allele, row.peptide)
    if key in seen:
        continue
    seen.add(key)
    best.append(row)
    if len(best) >= top_count:
        break
with open(best_fasta_path, "w", encoding="utf-8", newline="\n") as handle:
    for row in best:
        handle.write(">rank_%d|%s|%s\n%s\n" % (row.rank, row.allele, row.source_name, row.peptide))

accelerator = str(get_pytorch_device())
summary = {
    "inputKind": payload["inputKind"],
    "inputRows": len(base_rows),
    "sequenceCount": sequence_count,
    "totalResidues": total_residues,
    "alleles": alleles,
    "peptideLengths": lengths,
    "mode": mode,
    "requestedTopCount": top_count,
    "predictionCount": len(queries),
    "topPeptideCount": len(best),
    "rankColumn": rank_column,
    "accelerator": accelerator,
    "mhcflurryVersion": mhcflurry_version,
    "networkAccess": False,
}
summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
preview = []
for row in queries.head(25).to_dict(orient="records"):
    preview.append({
        key: (None if pandas.isna(value) else value.item() if hasattr(value, "item") else value)
        for key, value in row.items()
    })
print(json.dumps({
    "predictionsPath": str(predictions_path),
    "bestFastaPath": str(best_fasta_path),
    "summaryPath": str(summary_path),
    "summary": summary,
    "preview": preview,
}), flush=True)
`;
