# BWA-MEM

BWA-MEM maps short sequencing reads to a reference genome and writes a SAM
alignment file.

## Use it for

- short-read DNA alignment;
- paired-end or single-end FASTQ reads;
- creating an alignment step before downstream SAM/BAM processing.

## Inputs

- Reference FASTA.
- R1 FASTQ.
- Optional R2 FASTQ for paired-end reads.
- Threads.

The reference should already be suitable for BWA. Large real references usually
need indexing before production alignment.

## Outputs

- SAM alignment file.
- Alignment log and parsed run summary where available.

## How to read the result

The SAM file is usually an intermediate file. For real workflows, you normally
convert, sort, and index it with Samtools before downstream analysis.

Check logs for indexing or reference errors. If the run is very slow, increase
threads when your machine has enough CPU cores.

## Technical details

Tool ID: `bwa-mem`

Liatir runs BWA-MEM with controlled thread settings and records the generated
SAM file as an output artifact.
