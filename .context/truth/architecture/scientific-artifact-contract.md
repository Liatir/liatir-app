# Scientific artifact contract

Status: Gate 4 contract, schema version 1
Owner: `packages/liatir-core`
First profile: `org.liatir.scientific.anndata@1.0.0`

## Purpose

Liatir passes original scientific files between tools. It does not invent a
replacement file format and does not claim that two files are scientifically
compatible because their extensions match.

The versioned metadata in `LiatirScientificArtifactMetadata` adds a stable,
inspectable contract around an ordinary `LiatirFileArtifact`. The file path,
producer and parent run remain in the existing artifact contract. The new
metadata carries content identity, semantic profile, validation and lineage.
It is optional so saved pipelines, Plugins and Results created before Gate 4
remain readable.

## Compatibility layers

`checkLiatirArtifactCompatibility` always reports three separate layers:

1. **Physical/transport:** the file has a stable content identity and can be
   passed without pretending that its contents are understood.
2. **Format:** the concrete format and profile are accepted and the container
   is structurally credible. For AnnData, a `.h5ad` name alone is insufficient;
   the file must have the HDF5 signature.
3. **Scientific:** declared type, organism, modality, feature namespace,
   preprocessing and representation satisfy the consumer.

An error makes a layer `incompatible`. Missing metadata makes it `partial`.
Unknown values remain absent and generate actionable warnings; validators and
adapters must never guess them.

## Version 1 identity

Every profiled artifact contains:

- `schemaVersion: 1`;
- an `artifactId` derived as `sha256:<digest>`;
- exact byte size and SHA-256 digest;
- media type, concrete format and optional container;
- a versioned profile reference;
- scientific type and known qualifiers;
- validator identity, validation time, status and diagnostics;
- optional source artifacts, transformation and viewer hints;
- `mutationPolicy: "immutable-source"`.

The path is deliberately not the artifact identity. Moving the same bytes may
preserve the semantic record; changing the bytes invalidates it and returns the
file to partial validation until an aware validator inspects the new content.

## AnnData profile 1.0.0

The first profile is `org.liatir.scientific.anndata@1.0.0`, with concrete
format `anndata-h5ad` and HDF5 media/container identity.

The shallow local inspector streams the file once in Rust. It records byte
size, SHA-256 and the first eight bytes without loading a large dataset into
the webview. This is enough to reject an empty file or a renamed non-HDF5 file.
It is not enough to infer organism, modality, matrix contents or feature IDs,
so an imported HDF5-backed AnnData file starts as `partial`.

An AnnData-aware scientific runner may refine the same content identity with:

- observation and variable counts;
- selected matrix location and presence;
- finite, non-negative and count-like value checks;
- organism/taxon;
- modality;
- feature namespace;
- preprocessing state;
- expression, embedding and annotation representations;
- embedding keys and viewer hints.

The validator becomes `valid` only when the required AnnData and single-cell
facts are known and no error remains.

## Single-cell adoption

The Single-cell Embedding AI Tool declares the AnnData profile on its input and
embedded AnnData output. Before model execution it:

1. re-hashes the selected input so externally changed bytes cannot retain stale
   semantic metadata;
2. rejects invalid containers and known organism, modality, namespace or
   preprocessing mismatches;
3. logs partial-validation warnings when a fact is still unknown;
4. leaves the model-specific AnnData validation as the final deep check for an
   otherwise partial input.

Geneformer requires human data and an Ensembl gene-ID namespace. scGPT requires
human data and gene symbols. UCE uses the selected supported organism and gene
symbols. All three require single-cell RNA data with raw counts and an
expression representation.

After a successful run, the shared finalizer refines the input metadata and
creates a new embedded AnnData artifact. The output has a distinct digest,
records expression plus embedding representations, the embedding key, model
parameters and source revision, and points back to the immutable input content.
Direct and pipeline runs use this same finalizer.

The output viewer hints may name an embedding preview path, embedding key,
dimension count and projection. These are presentation metadata attached to the
scientific artifact, not a claim that the preview is the complete analysis. The
current Geneformer, scGPT and UCE adapters write a deterministic PCA preview for
at most 1,000 cells while retaining raw dimensions in the CSV. The viewer labels
that bounded projection explicitly and must not call it full-dataset UMAP,
clustering or annotation.

## Persistence and UI

The Data store persists optional scientific metadata beside each file. Legacy
records load unchanged. Relocating identical content preserves the record;
relocating or externally changing different content invalidates stale deep
metadata.

Relevant Data and pipeline selectors show profile/validation/compatibility.
Known incompatible choices are disabled. Results show validation status,
profile version, scientific type, short digest and transformation lineage while
the complete machine-readable record remains in the Result artifact.

The single-cell lighthouse registers the Result AnnData and preview in Data and
reopens the same identities in the standalone viewer. Its saved preset connects
the embedding Tool's `embeddedAnnData` and `embeddingPreviewCsv` outputs to the
viewer `inputFile` and `previewFile` inputs. The preset reuses this contract and
does not define a second scientific type system.

## Extension rules

New profiles must be added in `packages/liatir-core`; frontend or adapters must
not mirror the types. A profile version is immutable once published. A breaking
semantic change receives a new major version, while old metadata remains
readable. Within one major version, a requirement names the oldest profile it
understands and accepts later minor or patch revisions; a new major version is
incompatible until the consumer explicitly adopts it.

Conversions, indexing, reference normalization or metadata enrichment must
produce a new artifact or preserve the exact content digest. They must record
their sources and transformation, and must never silently mutate the original
file.

FASTA, VCF/VCF.GZ, BED, PDB/mmCIF and generic table/report profiles remain
incremental follow-up work after the AnnData/single-cell lighthouse. Future
profiles must extend this contract instead of creating a second artifact
system.
