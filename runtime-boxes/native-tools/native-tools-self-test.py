"""Exercise every command carried by the Native Tools Scrollcase box."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path.cwd()
BIN = ROOT / "venv" / "bin"
METADATA = json.loads((ROOT / "native-tools.json").read_text(encoding="utf-8"))


def run(tool: str, *args: str, ok: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["PATH"] = f"{BIN}{os.pathsep}{environment.get('PATH', '')}"
    library_variable = "DYLD_LIBRARY_PATH" if sys.platform == "darwin" else "LD_LIBRARY_PATH"
    environment[library_variable] = str(BIN.parent / "lib")
    result = subprocess.run(
        [str(BIN / tool), *args],
        cwd=ROOT,
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
