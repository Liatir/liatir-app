# Minimap2

Minimap2 is a versatile aligner for long reads, short reads, and assembled
sequences. In Liatir it outputs SAM format.

## Use it for

- long-read alignment;
- quick mapping experiments;
- alignment workflows where Minimap2 is the preferred mapper.

## Inputs

- Reference FASTA or `.mmi` index.
- Reads FASTQ/FASTA.
- Threads.

## Outputs

- SAM alignment file.
- Alignment log and parsed run summary where available.

## How to read the result

The SAM output is usually an intermediate artifact. For downstream analysis,
convert and sort it with Samtools or another alignment-processing tool.

Minimap2 supports many presets. Liatir currently exposes a practical default
configuration, with more preset controls planned.
