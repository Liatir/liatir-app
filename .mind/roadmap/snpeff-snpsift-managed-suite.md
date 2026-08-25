# Managed SnpEff and SnpSift suite

> **Implemented locally 2026-08-25.** Release and publication are deliberately out of scope. This
> document is the durable product contract and validation ledger for the managed Java suite.

## Decision

SnpEff and SnpSift are two applications in one official distribution, so Liatir installs and
updates them as one optional suite. Java 21 or newer remains a host dependency; neither the Java
runtime nor these JARs belongs in the Native Tools Scrollcase box.

The default path must not send a non-technical user to an upstream download page. Liatir presents
one pinned release, downloads it on demand, verifies the archive, extracts into staging, writes a
component-level installation marker and atomically activates it. Existing external installations
remain usable only through an advanced path and are recorded as external and unverified.

## Pinned release and databases

The built-in catalog is `snpeff-suite/catalog.json`:

- suite `5.4c`, released 2026-02-23, MIT, Java 21 minimum;
- official core ZIP SHA-256
  `3b06a1e1f939e7ebd5433387f088c1d3d1e0a7d472d63f39161b1fe9f00adf33`;
- compatible database series `v5_4`;
- checksum-pinned Ensembl 115 databases for human GRCh38, mouse GRCm39, zebrafish GRCz11,
  fruit fly BDGP6, *C. elegans* WBcel235 and yeast R64-1-1.

There is no mutable `latest`, no probing older database series and no silent substitution. Adding
a suite version or database is a reviewed catalog change with an exact URL, byte count and SHA-256.

## Lifecycle and ownership

- Suite state is app-global under `tool-runtimes/snpeff-suite`; releases are content-addressed and
  `active.json` is the atomic activation pointer.
- Databases are app-global under `snpeff-data/<database-id>` and have a Liatir ownership marker.
  An unmarked legacy or external directory is never overwritten or deleted.
- Installation is a workspace-visible `dependency` Job with one shared cancellation flag for the
  Job and streamed download. Navigating away does not detach it.
- A valid local copy is verified and reused without a second download.
- Removal refuses while a native Job is using the suite path or the exact database identity.
- Status re-verifies component hashes and required database files before exposing them to a run.

## Product surfaces

SnpEff uses the managed suite plus a selected verified database. Each direct or pipeline run records
the suite version, suite archive hash, database ID, database series, database archive hash and
managed/external source.

SnpSift Filter is the first SnpSift surface. It is available directly and in pipelines, streams its
VCF output to disk, and offers high impact, high-or-moderate, missense, stop-gained, minimum-quality
and advanced-expression modes. The UI explains that the four biological presets require the `ANN`
field written by SnpEff, and the exact resolved expression is recorded with every run.

## Validation ledger

- `npm run test:verify`: all 6 suites passed; the unit layer passed 65 files / 435 tests, SDK
  generation and both TypeScript builds passed, and Svelte reported 0 errors and 0 warnings.
- `cargo test`: 87 passed, 0 failed and 2 heavy fixtures ignored by their declared gate.
- `cargo clippy`: passed; the repository's pre-existing warnings remain outside this change.
- the five shipped SnpSift expressions were executed with the official 5.4c JAR against a small
  VCF; every invocation exited successfully.
- `npm run test:ui`: all 7 applicable suites passed and 2 foreign-platform desktop suites skipped.
  The general native run passed 34 tests; the isolated managed-suite lifecycle then downloaded the
  suite and database once, verified both, reused both without another request, and removed every
  managed file in 1/1 passing E2E test.
- the first sandboxed UI attempt stopped before application compilation because Pixi could not
  open its host cache lock. The identical gate passed when given access to that required cache; it
  was an execution-environment restriction, not a product failure.

## Stop boundary

This work does not publish assets, create tags, change release versions or deploy infrastructure.
Any future catalog addition still requires exact upstream verification; a publication step requires
separate authorization.
