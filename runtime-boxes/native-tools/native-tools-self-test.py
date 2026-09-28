"""Exercise every command carried by the Native Tools Scrollcase box."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import h5py
import hdf5plugin  # registers the Blosc filter in this process, to write a Blosc fixture


ROOT = Path.cwd()
BIN = ROOT / "venv" / "bin"
METADATA = json.loads((ROOT / "native-tools.json").read_text(encoding="utf-8"))

# simpleaf refuses to start without ALEVIN_FRY_HOME, and reads the piscem and alevin-fry paths
# from a JSON file it writes there. Kept outside the payload so the self-test never adds a file
# to the box it is verifying.
SIMPLEAF_HOME = Path(tempfile.mkdtemp(prefix="liatir-simpleaf-home-"))

# The Blosc decoder h5repack reads simpleaf's .h5ad with. Liatir passes h5repack this same
# path (`HDF5_PLUGIN_DIR` in native_tools.rs), so a Python upgrade that moves it fails here.
HDF5_PLUGINS = ROOT / "venv/lib/python3.11/site-packages/hdf5plugin/plugins"


def run(
    tool: str,
    *args: str,
    ok: tuple[int, ...] = (0,),
    cwd: Path | None = None,
    hdf5_plugins: bool = True,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["PATH"] = f"{BIN}{os.pathsep}{environment.get('PATH', '')}"
    library_variable = "DYLD_LIBRARY_PATH" if sys.platform == "darwin" else "LD_LIBRARY_PATH"
    environment[library_variable] = str(BIN.parent / "lib")
    environment["ALEVIN_FRY_HOME"] = str(SIMPLEAF_HOME)
    # As in Liatir, only h5repack is shown the plugins; nothing inherits them from the build host.
    environment.pop("HDF5_PLUGIN_PATH", None)
    if tool == "h5repack" and hdf5_plugins:
        environment["HDF5_PLUGIN_PATH"] = str(HDF5_PLUGINS)
    result = subprocess.run(
        [str(BIN / tool), *args],
        cwd=cwd or ROOT,
        env=environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
        check=False,
    )
    if result.returncode not in ok:
        raise RuntimeError(
            f"{tool} exited {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def assert_version(tool: str, args: tuple[str, ...], version: str, ok: tuple[int, ...] = (0,)) -> None:
    result = run(tool, *args, ok=ok)
    output = f"{result.stdout}\n{result.stderr}"
    if version not in output:
        raise RuntimeError(f"{tool} did not report pinned version {version}:\n{output}")


versions = {entry["id"]: entry["version"] for entry in METADATA["tools"]}
assert_version("samtools", ("--version",), versions["samtools"])
assert_version("bcftools", ("--version",), versions["bcftools"])
assert_version("seqkit", ("version",), versions["seqkit"])
assert_version("fastp", ("--version",), versions["fastp"])
assert_version("bwa", (), versions["bwa"], ok=(1,))
assert_version("minimap2", ("--version",), versions["minimap2"])
assert_version("simpleaf", ("--version",), versions["simpleaf"])
assert_version("alevin-fry", ("--version",), versions["alevin-fry"])
assert_version("h5repack", ("--version",), versions["h5repack"])

with tempfile.TemporaryDirectory(prefix="liatir-native-tools-") as temporary:
    work = Path(temporary)
    reference = work / "reference.fa"
    reads = work / "reads.fastq"
    reference.write_text(
        ">chr1\n"
        "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT\n",
        encoding="utf-8",
    )
    reads.write_text(
        "@read1\nACGTACGTACGTACGTACGTACGTACGTACGT\n+\nIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n"
        "@read2\nTGCATGCATGCATGCATGCATGCATGCATGCA\n+\nIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n",
        encoding="utf-8",
    )

    run("samtools", "faidx", str(reference))
    if not reference.with_suffix(".fa.fai").is_file():
        raise RuntimeError("samtools faidx did not create its index")

    stats_result = run("seqkit", "stats", "--tabular", str(reads))
    if "\t2\t" not in stats_result.stdout or "[ERRO]" in stats_result.stderr:
        raise RuntimeError(
            f"seqkit did not count the self-test reads:\n{stats_result.stdout}\n{stats_result.stderr}"
        )

    run("bwa", "index", str(reference))
    bwa_sam = run("bwa", "mem", str(reference), str(reads)).stdout
    if "@SQ" not in bwa_sam or "read1" not in bwa_sam:
        raise RuntimeError("bwa mem did not produce SAM output")

    minimap_sam = run("minimap2", "-ax", "sr", str(reference), str(reads)).stdout
    if "@SQ" not in minimap_sam or "read1" not in minimap_sam:
        raise RuntimeError("minimap2 did not produce SAM output")

    trimmed = work / "trimmed.fastq"
    report = work / "fastp.json"
    run(
        "fastp",
        "--in1", str(reads),
        "--out1", str(trimmed),
        "--json", str(report),
        "--html", str(work / "fastp.html"),
        "--disable_adapter_trimming",
        "--disable_quality_filtering",
        "--disable_length_filtering",
    )
    if not trimmed.is_file() or json.loads(report.read_text(encoding="utf-8"))["summary"]["before_filtering"]["total_reads"] != 2:
        raise RuntimeError("fastp did not process the self-test reads")

    variants = work / "variants.vcf"
    variants.write_text(
        "##fileformat=VCFv4.2\n"
        "##contig=<ID=chr1,length=64>\n"
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"
        "chr1\t2\t.\tC\tT\t60\tPASS\t.\n",
        encoding="utf-8",
    )
    viewed = run("bcftools", "view", "--no-header", str(variants)).stdout
    if "chr1\t2" not in viewed:
        raise RuntimeError("bcftools did not read the self-test VCF")


# ── Single-cell chain: simpleaf drives piscem and alevin-fry, end to end ─────────────
#
# Asserted on the matrix-market matrix first, then on the .h5ad Liatir actually hands on:
# simpleaf's, rewritten by h5repack (see the Blosc section below for why). Every count is exact:
# the reads are built with distinct, enumerated UMIs, so a UMI is never lost to a collision and
# the expected matrix is arithmetic, not a range.

# Prints every dataset of an HDF5 file as JSON. Run in a fresh interpreter that never loads
# hdf5plugin, with no HDF5_PLUGIN_PATH, so only the filters built into HDF5 itself can decode —
# which is all the AI Model boxes have.
READ_WITHOUT_PLUGINS = """
import json, sys
import h5py

contents = {}

def decode(name, item):
    if isinstance(item, h5py.Dataset):
        value = item.asstr()[()] if h5py.check_string_dtype(item.dtype) else item[()]
        contents[name] = value.tolist() if hasattr(value, "tolist") else value

with h5py.File(sys.argv[1], "r") as handle:
    handle.visititems(decode)
print(json.dumps(contents))
"""


def read_without_plugins(path: Path) -> dict:
    return json.loads(run("python", "-c", READ_WITHOUT_PLUGINS, str(path)).stdout)


def repack(source: Path, target: Path) -> None:
    """Rewrite with gzip exactly as Liatir does, failing on any warning as Liatir does."""
    result = run("h5repack", "-f", "GZIP=4", str(source), str(target))
    if result.stderr.strip():
        raise RuntimeError(f"h5repack could not rewrite {source.name}:\n{result.stderr}")


BASES = "ACGT"


def deterministic_sequence(length: int, seed: int) -> str:
    """A pseudo-random sequence with unique k-mers, identical on every machine."""
    state = seed
    letters = []
    for _ in range(length):
        state = (state * 1103515245 + 12345) % (2 ** 31)
        letters.append(BASES[(state >> 16) & 3])
    return "".join(letters)


def umi(index: int) -> str:
    """The index written base-4 over ACGT — distinct for every read, so no UMI collides."""
    return "".join(BASES[(index >> (2 * shift)) & 3] for shift in range(11, -1, -1))


with tempfile.TemporaryDirectory(prefix="liatir-single-cell-") as temporary:
    work = Path(temporary)
    chromosome = deterministic_sequence(6000, seed=20260824)
    genes = [
        ("ENSG00000000001", "ALPHA", "ENST00000000001", [(201, 500), (1201, 1500)]),
        ("ENSG00000000002", "BETA", "ENST00000000002", [(3001, 3300), (4001, 4300)]),
    ]
    (work / "genome.fa").write_text(
        ">chr1\n" + "\n".join(chromosome[i:i + 60] for i in range(0, len(chromosome), 60)) + "\n",
        encoding="utf-8",
    )
    annotation = []
    for gene_id, gene_name, transcript_id, exons in genes:
        span = f"{exons[0][0]}\t{exons[-1][1]}"
        gene_attributes = f'gene_id "{gene_id}"; gene_name "{gene_name}";'
        transcript_attributes = (
            f'gene_id "{gene_id}"; transcript_id "{transcript_id}"; gene_name "{gene_name}";'
        )
        annotation.append(f"chr1\tliatir\tgene\t{span}\t.\t+\t.\t{gene_attributes}")
        annotation.append(f"chr1\tliatir\ttranscript\t{span}\t.\t+\t.\t{transcript_attributes}")
        for start, end in exons:
            annotation.append(
                f"chr1\tliatir\texon\t{start}\t{end}\t.\t+\t.\t{transcript_attributes}"
            )
    (work / "genes.gtf").write_text("\n".join(annotation) + "\n", encoding="utf-8")

    barcodes = ["AAACCCAAGAAACACT", "AAACCCAAGAAACCCA", "AAACCCAAGAAACCCG"]
    (work / "barcodes.txt").write_text("\n".join(barcodes) + "\n", encoding="utf-8")

    read_length = 90
    expected_spliced: dict[tuple[str, str], int] = {}
    expected_unspliced: dict[tuple[str, str], int] = {}
    first_lines: list[str] = []
    second_lines: list[str] = []
    emitted = 0
    for cell, barcode in enumerate(barcodes):
        for locus, (gene_id, _name, _transcript, exons) in enumerate(genes):
            mature = "".join(chromosome[start - 1:end] for start, end in exons)
            intron = chromosome[exons[0][1]:exons[1][0] - 1]
            spliced = (cell + 1) * (locus + 1) * 2
            unspliced = cell + 1
            expected_spliced[(barcode, gene_id)] = spliced
            expected_unspliced[(barcode, gene_id)] = unspliced
            fragments = [
                mature[(index * 37) % (len(mature) - read_length):][:read_length]
                for index in range(spliced)
            ]
            # Taken from the middle of the intron: roers pads intronic references with
            # flanking exonic sequence, and only the middle is unambiguously unspliced.
            middle = len(intron) // 2 - read_length // 2
            fragments += [intron[middle:middle + read_length] for _ in range(unspliced)]
            for fragment in fragments:
                emitted += 1
                first_lines.append(
                    f"@r{emitted}\n{barcode}{umi(emitted)}\n+\n{'I' * 28}"
                )
                second_lines.append(f"@r{emitted}\n{fragment}\n+\n{'I' * read_length}")
    (work / "reads_1.fq").write_text("\n".join(first_lines) + "\n", encoding="utf-8")
    (work / "reads_2.fq").write_text("\n".join(second_lines) + "\n", encoding="utf-8")

    run("simpleaf", "set-paths", cwd=work)
    run(
        "simpleaf", "index",
        "--output", "index",
        "--fasta", "genome.fa",
        "--gtf", "genes.gtf",
        "--rlen", str(read_length),
        "--threads", "2",
        cwd=work,
    )
    run(
        "simpleaf", "quant",
        "--index", "index/index",
        "--reads1", "reads_1.fq",
        "--reads2", "reads_2.fq",
        "--chemistry", "10xv3",
        "--resolution", "cr-like",
        "--explicit-pl", "barcodes.txt",
        "--output", "quant",
        "--threads", "2",
        "--anndata-out",
        cwd=work,
    )

    alevin = work / "quant" / "af_quant" / "alevin"
    summary = json.loads((work / "quant" / "af_quant" / "quant.json").read_text(encoding="utf-8"))
    if not summary.get("usa_mode"):
        raise RuntimeError("a spliced+intronic index must quantify in USA mode")
    if summary.get("num_quantified_cells") != len(barcodes):
        raise RuntimeError(f"alevin-fry quantified {summary.get('num_quantified_cells')} cells, expected {len(barcodes)}")

    matrix_h5ad = alevin / "quants.h5ad"
    if matrix_h5ad.read_bytes()[:8] != b"\x89HDF\r\n\x1a\n":
        raise RuntimeError("simpleaf --anndata-out did not write an HDF5 .h5ad container")

    rows = (alevin / "quants_mat_rows.txt").read_text(encoding="utf-8").split()
    columns = (alevin / "quants_mat_cols.txt").read_text(encoding="utf-8").split()
    if len(columns) != 3 * len(genes):
        raise RuntimeError(f"USA mode must emit three blocks of gene columns, got {len(columns)}")
    counts: dict[tuple[str, str], float] = {}
    with open(alevin / "quants_mat.mtx", encoding="utf-8") as handle:
        header = [line for line in handle if not line.startswith("%")]
    for entry in header[1:]:
        row, column, value = entry.split()
        counts[(rows[int(row) - 1], columns[int(column) - 1])] = float(value)
    for (barcode, gene_id), expected in expected_spliced.items():
        for suffix, table in (("", expected_spliced), ("-U", expected_unspliced), ("-A", None)):
            wanted = 0.0 if table is None else float(table[(barcode, gene_id)])
            found = counts.get((barcode, f"{gene_id}{suffix}"), 0.0)
            if found != wanted:
                raise RuntimeError(
                    f"single-cell counts for {barcode}/{gene_id}{suffix}: expected {wanted}, got {found}"
                )

    portable = work / "portable.h5ad"
    repack(matrix_h5ad, portable)
    h5ad = read_without_plugins(portable)
    cells, genes = h5ad["obs/barcodes"], h5ad["var/gene_id"]
    indptr, indices, data = h5ad["X/indptr"], h5ad["X/indices"], h5ad["X/data"]
    if len(indptr) != len(cells) + 1:
        raise RuntimeError("the .h5ad's X is not a cells-by-genes CSR matrix")
    stored: dict[tuple[str, str], float] = {}
    for cell, barcode in enumerate(cells):
        for slot in range(indptr[cell], indptr[cell + 1]):
            stored[(barcode, genes[indices[slot]])] = data[slot]
    # X is spliced + unspliced + ambiguous, and these reads leave nothing ambiguous.
    for key, spliced in expected_spliced.items():
        wanted = float(spliced + expected_unspliced[key])
        if stored.get(key, 0.0) != wanted:
            raise RuntimeError(f"portable .h5ad count for {key}: expected {wanted}, got {stored.get(key)}")

shutil.rmtree(SIMPLEAF_HOME, ignore_errors=True)


# ── Blosc: what h5repack has to decode in a real sample's .h5ad ───────────────────────
#
# simpleaf compresses its .h5ad with Blosc, which a stock HDF5 cannot decode, so Liatir rewrites
# it with h5repack and gzip. The anndata-rs library simpleaf writes through leaves arrays of 128
# values or fewer uncompressed, so the small matrix above holds no Blosc at all. This fixture is
# written the way simpleaf writes a real sample — Blosc, zstd, byte shuffle — and proven unreadable
# without the decoder before it is repacked. h5repack exits 0 even when it cannot decode a dataset:
# it copies it still compressed and warns. Liatir fails the step on any warning, so the last check
# proves that warning is really printed.

with tempfile.TemporaryDirectory(prefix="liatir-hdf5-") as temporary:
    work = Path(temporary)
    counts = [float(index % 97) for index in range(4096)]
    blosc = work / "blosc.h5"
    with h5py.File(blosc, "w") as handle:
        handle.create_dataset(
            "counts",
            data=counts,
            dtype="f4",
            chunks=(1024,),
            **hdf5plugin.Blosc(cname="zstd", clevel=5, shuffle=hdf5plugin.Blosc.SHUFFLE),
        )
    run("python", "-c", READ_WITHOUT_PLUGINS, str(blosc), ok=(1,))

    portable = work / "portable.h5"
    repack(blosc, portable)
    if read_without_plugins(portable)["counts"] != counts:
        raise RuntimeError("h5repack changed the values it rewrote")

    blind = run("h5repack", "-f", "GZIP=4", str(blosc), str(work / "blind.h5"), hdf5_plugins=False)
    if not blind.stderr.strip():
        raise RuntimeError("h5repack without the Blosc decoder no longer warns; Liatir relies on it")
