# Scientific Showcases documentation integration

Completed 2026-10-06 on `handoff/single-cell-wsl2-2026-10-05`, starting from
`5a52035`. This record concerns documentation integration of the completed study,
not new experiments or a new scientific protocol.

## Public and repository surfaces

- [Public overview](https://liatir.com/showcases/overview): `/showcases/overview`.
- [Public study](https://liatir.com/showcases/single-cell-foundation-benchmark):
  `/showcases/single-cell-foundation-benchmark`.
- `Showcases` is a top-level navigation entry and sidebar group, and
  `Scientific Showcases` is a declared Markdown/LLM index section.
- The [root README](https://github.com/Liatir/liatir-app/blob/main/README.md) now describes the current local-first desktop
  environment, with a concise Scientific Showcases feature and one original result
  figure. Obsolete scaffold and legacy API instructions were replaced by the
  current repository layout and development entry points.
- The [reusable showcase index](https://github.com/Liatir/liatir-app/blob/main/showcases/README.md),
  [canonical package README](https://github.com/Liatir/liatir-app/blob/main/showcases/single-cell-foundation-benchmark/README.md)
  and [visual Liatir reproduction guide](https://github.com/Liatir/liatir-app/blob/main/showcases/single-cell-foundation-benchmark/report/reproduction.md)
  expose protocol, sources/provenance, results, figures, limitations, reproduction,
  validation and the external artifact record.
- The public account retains two datasets, seed 23, within-dataset classification,
  scVI fitting on evaluation counts, historical PBMC gene selection, fractional
  pancreas values, heterogeneous compute hardware, UCE blockers, and interrupted
  costs. It makes no combined ranking or superiority claim.
- Links to frozen scientific results, protocol and evidence pin completion revision
  `86a4542a2554032c8d1f79d6f07ef855e07af712`. The canonical package and visual
  reproduction guide link to `main` to include the integrated documentation.
- Reproduction guidance on the public page and in the repository describes the
  visual app workflow: workspace, AI Models, complete datasets in Tools, progress
  in Jobs, inspection and export in Results, and continuing verified saved work.
  User instructions contain no terminal commands or developer environment setup.
  At the owner's request, the guide uses general workflow stages rather than an
  exact sequence of UI controls. The interface source was inspected; no direct
  desktop interaction is claimed. A combined archive is not promised to import
  as a single resumable study.

## Artifact and integrity boundaries

The owner supplied [10.5281/zenodo.23187931](https://doi.org/10.5281/zenodo.23187931)
as the complete approximately 1.8 GB reproducibility artifact record. Every DOI
link uses that exact HTTPS resolver URL. Git tracks source, small scientific
results, figures and evidence; large matrices, embeddings and archives remain
ignored. No Zenodo upload was performed.

The original verified inner scientific ZIP is a separate artifact: 405,019,914
bytes, SHA-256 `184475f893e7f23efd24d095dccaccac8deefb79a525c0c7aa3d55a193f06de3`.
That receipt does not identify the larger external archive. Original-source count
checks require the separate checksummed canonical-source cache; evaluation
reproduction from the saved embeddings does not rerun inference or training.

All 412 pre-existing tracked study files other than the two navigation/reproduction
Markdown documents were protected by an aggregate SHA-256 inventory (sorted
repository paths, NUL separator, followed by each file's SHA-256 bytes):
`bd41fd054e5cbf1ca62fdb059267d1b232a5137e63230534a015ed2c2136fcb2`.
The inventory matches before and after integration. Results, provenance, source,
protocol, validation, failure records and all 22 original figures are unchanged.

The four public figure copies total 1,041,617 bytes and are byte-identical to the
validated originals: PBMC scGPT cell types, pancreas Harmony cell types, pancreas
scGPT cell types, and biological performance versus runtime. No plot was regenerated.

## Verification

- `npm run docs:all:build` passed after the visual-workflow correction, covering
  both public and internal documentation. The public site indexes 67 documentation
  pages across 12 sections, including the two showcase pages. Terminal-only local
  HTTP checks passed page titles, canonical metadata, navigation/sidebar targets,
  68 distinct local page/image targets, and all four image hashes.
- Generated per-page Markdown, the home Markdown index, both LLM indexes and the
  sitemap include both pages. Generated figure URLs are absolute and resolve to
  the matching public originals.
- The shared generator produced 358 Quenta documents, including 13 showcase
  sections. The online corpus and generated offline seed are identical, hash
  `8f2baa667a5c4147a6d716ff7d006a86d716a909edf582026b0f4099e56bf654`.
  All 345 pre-existing retrieval sections are unchanged. Generated files were
  regenerated, never edited by hand. The corrected visual reproduction guidance
  is present in rendered HTML, page Markdown, combined LLM text and both corpora.
- All 40 rounded biological/batch headline table values match the unchanged CSV.
- `npm run test:verify` passed all seven suites, 87 unit files / 676 tests, run
  `2026-10-06T13-48-46-208Z` after the correction. An earlier integration attempt
  found a stale ignored core build
  missing the existing PC execution exports. `npm run build --prefix packages/liatir-core`
  rebuilt it from unchanged source; the full retry passed without a source fix.
- Desktop UI and scientific experiments were not rerun for this documentation
  change. The completed study's original native and scientific evidence is retained.

- `syngraphe check --strict` passed with no errors or warnings.
- Internal-site validation exposed existing handoff links to scientific reports
  outside the context site's root, plus the new cross-site entry links. Those
  Markdown targets now point to the public docs or GitHub source; no dead-link
  checks were disabled and no scientific records were rewritten.
- Final scope review found eight small new files, unchanged existing generated
  retrieval sections, no whitespace findings and an empty Git index.

Repository context checks, internal docs build and the final diff/ignored-artifact
review complete the integration handoff.

## Publication receipt

On 2026-10-06 the owner explicitly authorized committing and pushing all integration
changes. Commit `9e2f5c0142778c4c7358ffd81aa1a07c6969c296` contains the 21 reviewed
files and was pushed normally to `git@github.com:Liatir/liatir-app.git`, branch
`handoff/single-cell-wsl2-2026-10-05`. A fresh remote read verified the exact branch
hash. No large scientific artifacts or ZIP archives were staged. This context-only
receipt follows that verified push on the same branch. Merge, website deployment,
release and artifact publication are not claimed.
