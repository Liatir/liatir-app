# Repository names

Taken 2026-09-28 by the maintainer.

## Decision

- The main repository is **`Liatir/liatir-app`** (was `Liatir/liatir-stack`).
- The public SDK mirror is **`Liatir/liatir-sdk`** (was `Liatir/sdk`).

GitHub keeps the repository ID (`1268399566` for the main repository) and redirects the old
names, so the run URLs already recorded in `runtime-boxes/catalog.json`, `runtime-boxes/evidence/`
and `.context/history/` stay valid and are deliberately left as they are: evidence records the
repository name it was built from.

## What the name is bound to

- **Runtime Box signing.** The four Google Workload Identity Federation providers
  (`runtime-box-production`, `runtime-box-signer-admin`, `runtime-box-revocation`,
  `single-cell-index-release`) match both the repository ID and the exact repository name and
  `workflow_ref`. They were updated in place to `Liatir/liatir-app` on 2026-09-28 and read back;
  `scripts/configure-runtime-box-ci.sh` now defaults to the new name, so a later reconcile keeps it.
- **Self-hosted runners** register against the name in
  `scripts/run-runtime-box-selfhosted-runner.sh` and `.ps1`; the Windows conda prefix length check
  uses the runner work directory, which GitHub names after the repository.
- **The SDK mirror** (`.github/workflows/sync-public-sdk.yml`) names `liatir-sdk` both for the
  GitHub App token and for the checkout. The app's repository selection is by ID, so it kept access.

## Constraint

Never create a new repository called `liatir-stack` or `sdk` in the `Liatir` organization: it would
take over GitHub's redirect and silently break every old link.
