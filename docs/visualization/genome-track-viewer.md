# Genome Track Viewer

The Genome Track Viewer displays genome-positioned artifacts such as BED tracks.

## Use it for

- viewing variant-effect BED tracks;
- viewing regulatory prediction signal tracks;
- inspecting output intervals relative to a reference sequence.

## Inputs

- Reference FASTA.
- Track file such as BED.
- Reference name, for example `chr1`.

## How to read the result

Tracks show intervals or scores along a reference sequence. A high score means
the upstream tool assigned a stronger value to that interval. The biological
meaning depends on the tool that produced the track.

Always inspect the originating Result and provenance before interpreting a
track.

## Related tools

- [Genomic Variant Effect](/ai/tools/genomic-variant-effect)
- [Regulatory Prediction](/ai/tools/regulatory-prediction)
