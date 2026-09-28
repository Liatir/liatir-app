# Demo files

The Sandbox workspace ships a small set of real datasets so a new user can try every tool and AI
Model without bringing data. Why they are shaped this way is in the
[decision](../decisions/demo-files-are-real-task-datasets.md); this page is the contract and the
provenance.

## Contract

- The set lives in `src-tauri/resources/demo-files/`, **one folder per task**, each folder one
  level deep and holding a `How to use these files.txt` that names the tools to try, the exact
  settings and where the data comes from. The Data page shows each folder as
  `Demo Files/<folder name>`, so the folder name is user-facing text.
- `manifest.json` lists every file with its size and SHA-256. It is written by
  `npm run demo-files:manifest` and `tests/unit/demo-files.test.ts` fails when it is stale.
  **Any change to a demo file means regenerating the manifest in the same change.**
- The production bundle carries the set (`conf-templates/tauri.conf.template.prod.json`); a debug
  build reads it from the source tree. Before 2026-09-28 it was never bundled, so released builds
  had no demo files at all.
- `lia_init_demo_files` (`src-tauri/src/bridge/demo_files.rs`) keeps a copy under the app data
  directory. A copy whose manifest differs from the bundle's is replaced whole; a current copy only
  gets missing files back. The Data store (`dataFiles.initDemoFiles`) drops entries for demo files
  the returned list no longer contains, so a renamed file does not linger as "missing".
- `.gitattributes` marks the directory `-text`: a CRLF checkout would change the scientific bytes
  and break the manifest.

## The five folders

| Folder | What it exercises | Size |
| --- | --- | --- |
| Find mutations in a yeast genome | FastQC, fastp, seqkit, samtools faidx/flagstat, BWA-MEM, Minimap2, BCFtools stats/filter, SnpEff, SnpSift, Genome Track Viewer | 3.0 MB |
| Map blood cells with single-cell AI | scGPT, Geneformer, UCE (Single-cell Embedding), Single-cell Viewer | 3.9 MB |
| Count genes in single cells from reads | Single-cell Reference Index, Single-cell Quantification (simpleaf) | 3.5 MB |
| Predict and simulate protein structures | Boltz-2, Protenix, Protein–Ligand Affinity, 3D Structure Viewer, OpenMM relaxation and dynamics | 0.5 MB |
| Find cancer neoantigens | pVACseq (Neoantigen Prioritization), MHCflurry (MHC-I Epitope Prediction) | 0.7 MB |

Not covered: External Workflows (Nextflow, Snakemake), which bring their own workflow and data,
and the OpenMM ligand path (see below).

## Provenance and how each file was made

**Yeast.** Reads: ENA run `SRR11697748` (PRJNA630580, "ORIGINAL CENPK113-7D", HiSeq 2500,
2×150). The first 1.2 M pairs were aligned with the bundled bwa 0.7.19 to the whole Ensembl 115
R64-1-1 genome; the 14,879 pairs whose two primary mates are properly paired on chromosome `I` were
kept in original order (~19× coverage). Reference `I` and the chromosome-I GFF3 lines come from
Ensembl 115. The VCF was called from these reads against chromosome I: `bwa mem`, `samtools sort`,
`bcftools mpileup -q 20 -Q 20 -a AD,DP | call -mv --ploidy 1 | norm`, then
`filter -e 'QUAL<30 || INFO/DP<5' -s LowQual` — 955 records, 748 PASS. No BAM ships: Liatir's aligners
write SAM. The Genome Track Viewer can show a user's BAM, and indexes it first when it has no index.

**Single-cell AI.** 1,192 cells of 10x "3k PBMCs from a Healthy Donor" (CC BY 4.0), sampled per
Scanpy PBMC3k tutorial cell type with seed `20260928` (CD4 T 350, CD14+ Mono 200, B 200, CD8 T 150,
NK 120, FCGR3A+ Mono 120, DC 37, Megakaryocytes 15), genes detected in at least one kept cell
(15,161). `X` is the unchanged raw UMI count; `var_names` and `var["gene_name"]` are symbols,
`var["ensembl_id"]` the 10x gene IDs, `obs` has `cell_type`, `n_counts`, `n_genes`. Written with
**anndata 0.10.9**, the oldest reader among the boxes (Geneformer), and read back with 0.12.19.

**Single-cell counting.** A 20-gene panel of blood markers: each gene's GRCh38 span ±500 bases from
the Ensembl REST sequence endpoint as its own contig `<GENE>_region`, with the gene, transcript and
exon lines of Ensembl 115 shifted onto it. Reads: the first 3 M pairs of lane 1 of 10x
"1k PBMCs (v3 chemistry)" (CC BY 4.0), keeping the 62,690 pairs whose R2 aligns to the panel
(`minimap2 -x splice:sr`, ≥70 matching bases).

**Proteins.** PDB 1UBQ and 3HS4 unchanged (CC0); the ubiquitin sequence from 1UBQ; carbonic
anhydrase 2 is UniProt P00918 (identical to `runtime-boxes/fixtures/proteins/P00918.fasta`);
acetazolamide is the SMILES of the Boltz-2 affinity validation.

**Neoantigens.** 40 records of pVACtools 7.1.2's `annotated.expression.vcf.gz` (HCC1395, BSD
3-Clause Clear), chosen across the official result's tiers with seed `20260928`, header unchanged.
The peptide table holds published neoantigens (KRAS G12D/G12V on HLA-A*11:01, Wang 2016; KRAS G12D
GADGVGKSA on HLA-C*08:02, Tran 2016; TP53 R175H, Hsiue 2021), their normal counterparts and three
viral HLA-A*02:01 controls. KRAS is UniProt P01116 with G12D applied.

## Verified on 2026-09-28 (macOS arm64)

Run with the app's own scripts or pinned environments, not reimplementations:

- **snpEff 5.4c + R64-1-1.115** (catalog checksums matched) on the yeast VCF: 4 HIGH, 155 MODERATE
  (147 missense); SnpSift `ANN[*].IMPACT = 'HIGH'` keeps 4.
- **pVACseq**: the product script `pvacseq.ts`, in an environment installed `--frozen` from the
  box's `pixi.lock` with the scroll's source layout: 40 variants, 16,872 epitopes, 16 filtered, 40
  aggregated (20 Pass), 6 min 20 s on one thread.
- **MHCflurry**: the product script `mhcflurry-epitope.ts` with MHCflurry 2.2.1 and the mirrored
  presentation models: all three demo alleles supported; controls and KRAS 10-mers rank top on
  A*02:01/A*11:01; GADGVGKSA on C*08:02 is 0.18 percentile against 4.5 for the normal GAGGVGKSA.
- **OpenMM 8.5.1** (`amber19-all` + `tip3pfb`, as the product script builds it) on 1UBQ:
  hydrogens, minimization and 10 ps Langevin dynamics, without and with TIP3P-FB water, all finite.
- **simpleaf 0.28.0** from the bundled Native Tools box with the app's arguments: index in under a
  second, quantification with `--knee` → 935 cells × 20 genes, markers separating T cells,
  monocytes and B cells.
- **Not run through the models**: scGPT, Geneformer, UCE, Boltz-2 and Protenix need installed boxes
  or a GPU. The h5ad follows the input rules their scripts document; the protein inputs are the
  pairs the Boltz-2 and Protenix validations already use.

The OpenMM ligand path (an SDF for a ligand inside the structure) has no demo: the natural pair,
3HS4, carries a zinc ion and a deprotonated sulfonamide that the product's force-field route was
not verified against.
