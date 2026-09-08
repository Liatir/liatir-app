# Runtime Box publication runs on hosted CI

Decided 2026-09-08, after the OpenMM macOS target was found to be scheduled onto
the product owner's own machine for no reason other than a copied catalog field.

## Decision

Building, signing, uploading and promoting a Runtime Box is CI work and runs on a
GitHub-hosted runner. A self-hosted runner is reserved for the targets that a
hosted runner genuinely cannot do: a GPU target, or a build whose real disk or
time footprint exceeds what the hosted image offers. Choosing `selfHosted` is a
justified exception, not the default, and the justification belongs in the
component's catalog entry review.

Local machines stay for development and verification. A developer builds a box
locally with a development key to iterate quickly, and that is exactly what the
development trust key exists for. A local build is never publication evidence:
production signing uses the KMS-backed signer through
`runtime-box-release.yml`, from a clean committed revision on `main`.

OpenMM's macOS target therefore uses `macos-arm64-standard` (`macos-15`). Its
measured footprint is roughly 2.3 GB of payload, 0.55 GB of archive and a package
cache of a few GB — well inside a hosted macOS runner, and far below the
`macos-arm64-heavy` profile's 37 GiB bootstrap floor, which exists for the much
larger oncology and single-cell boxes.

## What stays manual, and why that is not a contradiction

The release workflow's *trigger* remains `workflow_dispatch`. Publication writes
immutable objects to R2 whose key is their own hash: once uploaded, those bytes
are addressable forever and cannot be withdrawn. An irreversible, externally
visible action gets a deliberate press, not a push-triggered one. The repository's
cost policy makes the same point for GPU jobs.

Everything after that press is automatic and remote: build, self-test, signature,
scientific validation, upload with a public re-hash, the product lifecycle against
the real candidate, and only then channel promotion.

## What was rejected

Registering the owner's Mac as an ephemeral runner for OpenMM. It works, and the
launcher exists, but it makes a release depend on one person's laptop being awake,
and it puts a production signature on a machine that also runs development builds.

## Records

- [Phase 3 implementation status](../state/roadmap/phase3-implementation-status.md)
  — the OpenMM evidence this decision unblocks.
- [Runtime Box CI foundation](../state/roadmap/runtime-box-ci-foundation.md) —
  the runner profiles and cost policy this sits inside.
