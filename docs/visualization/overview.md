# Scientific Viewers

Scientific viewers make output artifacts easier to inspect. They are especially
important for AI outputs because raw files alone are often hard to understand.

## Viewer types

| Viewer | Use it for | Typical input |
| --- | --- | --- |
| [3D Structure Viewer](/visualization/structure-viewer) | protein structure inspection | PDB, mmCIF, CIF |
| [Genome Track Viewer](/visualization/genome-track-viewer) | genome interval or score tracks | FASTA plus BED/GFF/VCF-like tracks |
| [Single-cell Viewer](/visualization/single-cell-viewer) | single-cell labels or embeddings | CSV/JSON/AnnData-derived artifacts |

Some viewers download what they need the first time you use them, so the base
app stays small.

## Screenshots and fullscreen

Viewer panels support focused inspection modes in the app. Use fullscreen when
you need more room, and use screenshots when you want to preserve the current
visual state for notes or reports.

## Pipeline use

Viewer nodes can be placed after tools that produce compatible artifacts:

- Protein Structure Prediction to 3D Structure Viewer.
- Regulatory Prediction to Genome Track Viewer.
- CellTypist Annotation to Single-cell Viewer.
