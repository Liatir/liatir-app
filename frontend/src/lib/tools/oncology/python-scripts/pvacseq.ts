/** Offline pVACtools 7.1.2 adapter. It exposes only pVACseq with MHCflurry 2.0.6. */
export const PVACSEQ_SCRIPT = String.raw`
import csv
import gzip
import json
import math
import os
import pathlib
import platform
import re
import socket
import sys

ALLOWED_PREDICTORS = ["MHCflurry", "MHCflurryEL"]

def fail(message):
    raise ValueError(message)

original_socket_connect = socket.socket.connect

def deny_network(sock, address):
    if sock.family == socket.AF_UNIX:
        return original_socket_connect(sock, address)
    raise RuntimeError("Network access is disabled for this local pVACseq run.")

def open_vcf(path):
    if str(path).lower().endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")

def inspect_vcf(path, tumor_sample=None, normal_sample=None, proximal=False):
    if not path.is_file():
        fail("VCF input does not exist: %s" % path)
    if str(path).lower().endswith(".gz") and not pathlib.Path(str(path) + ".tbi").is_file():
        fail("A gzipped VCF requires its .tbi tabix index beside it.")
    if proximal and not str(path).lower().endswith(".gz"):
        fail("The proximal variants VCF must be gzipped and tabix indexed.")

    vcf_header = False
    csq_header = False
    csq_fields = []
    sample_ids = []
    genotype_format = False
    variant_count = 0
    with open_vcf(path) as handle:
        for raw in handle:
            line = raw.rstrip("\r\n")
            if line.startswith("##fileformat=VCF"):
                vcf_header = True
            elif line.startswith("##INFO=<ID=CSQ,"):
                csq_header = True
                match = re.search(r"Format:\s*([^\">]+)", line)
                if match:
                    csq_fields = [field.strip() for field in match.group(1).strip().split("|")]
            elif line.startswith("#CHROM"):
                columns = line.split("\t")
                sample_ids = columns[9:] if len(columns) > 9 else []
            elif line and not line.startswith("#"):
                variant_count += 1
                columns = line.split("\t")
                if len(columns) > 8 and "GT" in columns[8].split(":"):
                    genotype_format = True
                if variant_count > 2_000_000:
                    fail("The VCF contains more than 2,000,000 variants. Reduce it before running pVACseq.")

    if not vcf_header:
        fail("The input has no VCF file-format header.")
    if not csq_header or not csq_fields:
        fail("The VCF has no readable VEP CSQ annotation header.")
    if not genotype_format:
        fail("The VCF has no GT genotype field in its variant records.")
    if variant_count == 0:
        fail("The VCF contains no variants.")
    if proximal:
        required_proximal_fields = ["Allele", "Feature", "Consequence", "Amino_acids", "Codons", "Protein_position"]
        missing = [field for field in required_proximal_fields if field not in csq_fields]
        if missing:
            fail("The proximal variants VCF CSQ header is missing required fields: %s." % ", ".join(missing))
        if len(sample_ids) != 1:
            fail("The proximal variants VCF must contain exactly one sample.")
    else:
        if "WildtypeProtein" not in csq_fields:
            fail("The VCF CSQ header is missing the WildtypeProtein annotation.")
        if "FrameshiftSequence" not in csq_fields:
            fail("The VCF CSQ header is missing the FrameshiftSequence annotation.")
        if tumor_sample not in sample_ids:
            fail("Tumor sample %s is not present in the VCF." % tumor_sample)
        if normal_sample and normal_sample not in sample_ids:
            fail("Normal sample %s is not present in the VCF." % normal_sample)
    return {
        "vcfHeader": vcf_header,
        "csqHeader": csq_header,
        "genotypeFormat": genotype_format,
        "sampleIds": sample_ids,
        "tumorSample": tumor_sample,
        "normalSample": normal_sample,
        "variantCount": variant_count,
        "wildtypeProteinAnnotation": "WildtypeProtein" in csq_fields,
        "frameshiftSequenceAnnotation": "FrameshiftSequence" in csq_fields,
    }

def inspect_tsv(path, score_columns, keep_limit=0):
    if not path.is_file():
        fail("pVACseq did not produce the required output: %s" % path.name)
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        columns = reader.fieldnames or []
        rows = []
        row_count = 0
        finite_scores = True
        for row in reader:
            row_count += 1
            if len(rows) < keep_limit:
                rows.append(row)
            for column in score_columns:
                value = (row.get(column) or "").strip()
                if value in ("", "NA", "None"):
                    continue
                try:
                    finite_scores = finite_scores and math.isfinite(float(value))
                except ValueError:
                    finite_scores = False
        return columns, rows, row_count, finite_scores

def main():
    payload = json.load(sys.stdin)
    if payload.get("predictors", ALLOWED_PREDICTORS) != ALLOWED_PREDICTORS:
        fail("This Tool Runtime permits only MHCflurry and MHCflurryEL.")

    runtime_path = pathlib.Path(payload["runtimePath"])
    source_dir = runtime_path / "source" / "pvactools-wheel"
    mhcflurry_source_dir = runtime_path / "source" / "mhcflurry-wheel"
    mhcgnomes_source_dir = runtime_path / "source" / "mhcgnomes-wheel"
    vcfpy_source_dir = runtime_path / "source" / "vcfpy-sdist"
    np_utils_source_dir = runtime_path / "source" / "np-utils-sdist"
    vaxrank_source_dir = runtime_path / "source" / "vaxrank-sdist"
    downloads_dir = runtime_path / "model-cache" / "pvactools-mhcflurry-downloads"
    models_dir = downloads_dir / "models_class1_presentation" / "models"
    if not source_dir.joinpath("pvactools", "tools", "pvacseq", "run.py").is_file():
        fail("The signed Tool Runtime does not contain the reviewed pVACtools source.")
    if not mhcflurry_source_dir.joinpath("mhcflurry", "__init__.py").is_file():
        fail("The signed Tool Runtime does not contain MHCflurry 2.0.6.")
    if not mhcgnomes_source_dir.joinpath("mhcgnomes", "__init__.py").is_file():
        fail("The signed Tool Runtime does not contain its reviewed MHC allele parser.")
    if not vcfpy_source_dir.joinpath("vcfpy", "__init__.py").is_file():
        fail("The signed Tool Runtime does not contain vcfpy 0.13.8.")
    if not np_utils_source_dir.joinpath("np_utils", "__init__.py").is_file():
        fail("The signed Tool Runtime does not contain np-utils 0.6.0.")
    if not vaxrank_source_dir.joinpath("vaxrank", "manufacturability.py").is_file():
        fail("The signed Tool Runtime does not contain the reviewed Vaxrank manufacturability module.")
    if not models_dir.joinpath("weights.csv").is_file():
        fail("The signed Tool Runtime does not contain the MHCflurry presentation models.")

    input_vcf = pathlib.Path(payload["inputVcf"])
    proximal_vcf = pathlib.Path(payload["proximalVcf"]) if payload.get("proximalVcf") else None
    tumor_sample = payload["tumorSample"]
    normal_sample = payload.get("normalSample") or None
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", tumor_sample) or tumor_sample in (".", ".."):
        fail("The tumor sample name contains characters that are unsafe in output file names.")
    if normal_sample and (not re.fullmatch(r"[A-Za-z0-9_.-]+", normal_sample) or normal_sample in (".", "..")):
        fail("The normal sample name contains unsupported characters.")
    if proximal_vcf and not str(input_vcf).lower().endswith(".gz"):
        fail("The tumor VCF must be gzipped and tabix indexed when a proximal variants VCF is used.")
    inspection = inspect_vcf(input_vcf, tumor_sample, normal_sample)
    proximal_inspection = inspect_vcf(proximal_vcf, proximal=True) if proximal_vcf else None

    alleles = payload["alleles"]
    lengths = payload["peptideLengths"]
    top_count = max(1, min(int(payload.get("topCount", 100)), 5000))
    output_dir = pathlib.Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    # Input validation finishes before pVACtools or predictor imports. Every parent and child Python
    # process then receives an explicit model directory and a socket guard. Unix-domain sockets stay
    # available because pVACtools uses them only for local multiprocessing coordination.
    os.environ["MHCFLURRY_DOWNLOADS_DIR"] = str(downloads_dir)
    source_paths = [str(source_dir), str(mhcflurry_source_dir), str(mhcgnomes_source_dir), str(vcfpy_source_dir), str(np_utils_source_dir), str(vaxrank_source_dir)]
    os.environ["PYTHONPATH"] = os.pathsep.join(source_paths + [os.environ.get("PYTHONPATH", "")])
    socket.socket.connect = deny_network
    socket.create_connection = deny_network
    guarded_bin = output_dir / ".liatir-guarded-bin"
    guarded_bin.mkdir(exist_ok=True)
    guarded_predict_script = guarded_bin / "_mhcflurry_predict.py"
    guarded_predict_script.write_text(
        "import socket\n"
        + "def deny(*a, **k): raise RuntimeError('Network access is disabled for this local predictor run.')\n"
        + "socket.socket.connect = deny\n"
        + "socket.create_connection = deny\n"
        + "from mhcflurry.predict_command import run\n"
        + "run()\n",
        encoding="utf-8",
    )
    guarded_predict = guarded_bin / "mhcflurry-predict"
    guarded_predict.write_text(
        "#!/bin/sh\n"
        + 'exec "$LIATIR_PVACTOOLS_PYTHON" "$LIATIR_PVACTOOLS_PREDICTOR" "$@"\n',
        encoding="utf-8",
    )
    guarded_predict.chmod(0o700)
    os.environ["LIATIR_PVACTOOLS_PYTHON"] = sys.executable
    os.environ["LIATIR_PVACTOOLS_PREDICTOR"] = str(guarded_predict_script)
    os.environ["PATH"] = str(guarded_bin) + os.pathsep + os.environ.get("PATH", "")

    sys.path[:0] = source_paths
    from pvactools.lib.prediction_class import MHCflurry
    unsupported = sorted(set(alleles) - set(MHCflurry().valid_allele_names()))
    if unsupported:
        fail("Unsupported MHCflurry allele(s): %s." % ", ".join(unsupported))

    from pvactools.tools.pvacseq.run import main as pvacseq_main
    threads = max(1, min(int(payload.get("threads", 1)), 32))
    if platform.system() == "Darwin":
        threads = 1
    args = [
        str(input_vcf),
        tumor_sample,
        ",".join(alleles),
        "MHCflurry",
        "MHCflurryEL",
        str(output_dir),
        "--class-i-epitope-length", ",".join(str(length) for length in lengths),
        "--n-threads", str(threads),
        "--iedb-retries", "0",
    ]
    if normal_sample:
        args.extend(["--normal-sample-name", normal_sample])
    if proximal_vcf:
        args.extend(["--phased-proximal-variants-vcf", str(proximal_vcf)])
    if payload.get("passOnly"):
        args.append("--pass-only")

    print("Running pVACseq locally with locked MHCflurry predictors.", flush=True)
    pvacseq_main(args)

    class_i_dir = output_dir / "MHC_Class_I"
    all_path = class_i_dir / (tumor_sample + ".MHC_I.all_epitopes.tsv")
    filtered_path = class_i_dir / (tumor_sample + ".MHC_I.filtered.tsv")
    aggregate_path = class_i_dir / (tumor_sample + ".MHC_I.all_epitopes.aggregated.tsv")
    metrics_path = class_i_dir / (tumor_sample + ".MHC_I.all_epitopes.aggregated.metrics.json")
    required_columns = ["Index", "Gene", "Best Peptide", "Allele", "IC50 MT", "Tier"]
    aggregate_columns, aggregate_rows, aggregate_count, aggregate_finite = inspect_tsv(
        aggregate_path, ["IC50 MT", "%ile MT", "Pres %ile MT"], max(top_count, 25)
    )
    missing_columns = [column for column in required_columns if column not in aggregate_columns]
    if missing_columns:
        fail("The aggregated pVACseq report is missing required columns: %s." % ", ".join(missing_columns))
    all_columns, _all_rows, all_count, all_finite = inspect_tsv(
        all_path, ["MHCflurry MT IC50 Score", "MHCflurry MT Percentile", "MHCflurryEL Presentation MT Score"]
    )
    _filtered_columns, _filtered_rows, filtered_count, filtered_finite = inspect_tsv(filtered_path, ["Best MT IC50 Score"])
    if not metrics_path.is_file():
        fail("pVACseq did not produce its aggregated metrics JSON.")

    candidates_path = class_i_dir / (tumor_sample + ".MHC_I.candidates.fasta")
    seen = set()
    candidates = []
    for row in aggregate_rows:
        peptide = (row.get("Best Peptide") or "").strip().upper()
        if not peptide or peptide in seen:
            continue
        seen.add(peptide)
        candidates.append(row)
        if len(candidates) >= top_count:
            break
    with open(candidates_path, "w", encoding="utf-8", newline="\n") as handle:
        for rank, row in enumerate(candidates, start=1):
            handle.write(
                ">rank_%d|%s|%s|%s\n%s\n" % (
                    rank,
                    (row.get("Allele") or "unknown").replace(" ", "_"),
                    (row.get("Gene") or "unknown").replace(" ", "_"),
                    (row.get("Tier") or "unknown").replace(" ", "_"),
                    row["Best Peptide"].strip().upper(),
                )
            )

    summary = {
        "pvactoolsVersion": "7.1.2",
        "mhcflurryVersion": "2.0.6",
        "predictors": ALLOWED_PREDICTORS,
        "alleles": alleles,
        "peptideLengths": lengths,
        "threads": threads,
        "passOnly": bool(payload.get("passOnly")),
        "requestedTopCount": top_count,
        "networkAccess": False,
        "inputInspection": inspection,
        "proximalInputInspection": proximal_inspection,
        "allEpitopeCount": all_count,
        "filteredCount": filtered_count,
        "aggregateCount": aggregate_count,
        "candidateCount": len(candidates),
        "aggregateColumns": aggregate_columns,
        "requiredAggregateColumns": required_columns,
        "finiteScores": aggregate_finite and all_finite and filtered_finite,
    }
    summary_path = output_dir / "pvacseq-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    preview = []
    for row in aggregate_rows[:25]:
        preview.append({key: row.get(key, "") for key in ["Gene", "AA Change", "Best Peptide", "Allele", "IC50 MT", "Tier"]})
    print(json.dumps({
        "allPath": str(all_path),
        "filteredPath": str(filtered_path),
        "aggregatePath": str(aggregate_path),
        "metricsPath": str(metrics_path),
        "candidatesPath": str(candidates_path),
        "summaryPath": str(summary_path),
        "summary": summary,
        "preview": preview,
    }), flush=True)

if __name__ == "__main__":
    main()
`;
