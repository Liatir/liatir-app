# Runtime Box Production Report

Last reviewed: 2026-08-11

This is the evidence-backed production and operational handoff for the Runtime
Box CI foundation. The canonical gate history remains in
[Runtime Box CI foundation](../state/roadmap/runtime-box-ci-foundation.md), while the live
machine-readable release state remains in `runtime-boxes/catalog.json` and its
referenced compact evidence records.

This report is a production-evidence snapshot, not the current builder
implementation guide. The releases below were built before Liatir adopted the
external Scrollcase package and remain valid because P5 preserves their signed
`liatir.runtime-box` wire contract, target IDs, trust roots and immutable object
paths. For new build ownership and migration status, use
[Scrollcase P5 — Liatir adoption](./scrollcase-p5-liatir-adoption.md):
Scrollcase owns the generic pixi build/signing-envelope/verify implementation;
Liatir consumes the published tool and retains recipes, scientific validation,
private signer custody, CI/evidence, distribution and product lifecycle.

## Current live-state addendum (2026-08-10)

The tables below are the immutable Gate 10/uv-era evidence snapshot, not the
current channel matrix. The subsequent schema-v2 re-release is complete: the
public `beta` registry serves three Geneformer targets (macOS Metal, Linux CUDA
12.9, Windows CUDA 12.8), five scGPT targets (macOS Metal, Linux/Windows CPU and
both CUDA targets), and UCE macOS Metal. All nine are KMS-signed and have
reviewed product-lifecycle evidence in `runtime-boxes/evidence/`.

The live signed revocations document jointly withdraws Geneformer
`1.0.0-beta.1` and scGPT `0.2.5-beta.1`. UCE `1.0.0-beta.1` is not channel-selected
and is rejected by the v2-only app, but it is not in that document; explicit
revocation remains a product decision. For current execution state use
[Scrollcase P5](./scrollcase-p5-liatir-adoption.md) and
`runtime-boxes/catalog.json`; preserve the rest of this report as historical
production evidence.

Scrollcase P5 adoption is now complete. The stable operator commands did not
change during P5.6/P5.7: generic authoring/build/verify still route through the
exact published package, while Liatir retains distribution and control-plane
verbs. The local `serve` implementation now honors HTTP byte ranges, which lets
the real product resume an interrupted candidate download without publishing
the candidate. This changes no production Registry, asset, trust or workflow
contract.

## Historical foundation outcome

Gates 0 through 10 are complete for the approved foundation scope. The
supported Geneformer targets are macOS arm64 Metal, Linux x86_64 CPU, Linux
x86_64 CUDA 12.4, and Windows x86_64 CPU. CUDA has been validated only on
Linux.

`windows-x86_64-cuda12.4` is a recognized, buildable recipe and workflow
identity, but it is unvalidated, unpublished, and unsupported. The hosted
Windows T4 driver `471.11` cannot run the CUDA 12.4 build, and the target must
not be dispatched until one of the re-entry conditions in the gate ledger is
met. WSL2 is also unsupported and unverified.

The foundation does not close the separate product backlog for a true
cross-version native update or client-persisted anti-replay channel state.
Same-version atomic replacement and rollback are covered; they must not be
described as cross-version evidence.

## Reviewed production evidence

| Subject | Target | Production and product evidence | Retained record |
| --- | --- | --- | --- |
| Geneformer V1 10M | macOS arm64 Metal | Published legacy release remains live; current shared builder, Metal parity, native Rust lifecycle, and cleanup regressed in run `29880520628` at `d07b6b4` without republishing | Workflow artifact `8514665653` |
| Geneformer V1 10M | Linux x86_64 CPU | Protected KMS-signed release, immutable R2 publication, beta promotion, real inference, Jobs, Results, provenance, replacement, rollback, removal, and cleanup in run `29547725429` | `runtime-boxes/evidence/geneformer-v1-10m-linux-x86_64-cpu-1.0.0-beta.1.json` |
| Geneformer V1 10M | Linux x86_64 CUDA 12.4 | Current-code T4 validation and full protected product lifecycle in run `29750614689` at `2307663`; original closure run was `29643382673` | `runtime-boxes/evidence/geneformer-v1-10m-linux-x86_64-cuda12.4-1.0.0-beta.1-run-29750614689.json` |
| Geneformer V1 10M | Windows x86_64 CPU | Protected KMS-signed release and native CPU product lifecycle in run `29706828552` at `f067482` | `runtime-boxes/evidence/geneformer-v1-10m-windows-x86_64-cpu-1.0.0-beta.1.json` |
| UCE 4-layer | macOS arm64 Metal | Protected heavy-runner release `29909249357` at `8e12512`: locked build, self-test, Metal parity, KMS signing, immutable publication, public hash verification, beta promotion, evidence, and cleanup | `runtime-boxes/evidence/uce-4layer-macos-aarch64-metal-1.0.0-beta.1-run-29909249357.json` |

The Linux CPU and native Windows CPU runs prove that a real AI Model traversed
legal and catalog preflight, dependency lock, build, self-test, scientific
validation, KMS signing, immutable R2 publication, beta promotion, and the
product Runtime Box lifecycle. The retained product evidence includes real
Geneformer inference plus Jobs, Results, provenance, replacement, rollback,
removal, and cleanup.

UCE run `29909249357` produced an `8,864,908,393`-byte archive with SHA-256
`63fc02de8e91699176510051be38790ab69739a92fe32052011081ad8297c960`,
an installed size of `10,142,864,860` bytes, and a signed release manifest with
SHA-256 `8e0c8c0174acfb44a8c8d956d13a6a584fa65bb757c134e9e120a67c76e95430`.
Its scientific output was `10 x 1280`, finite, and within the reviewed
CPU/Metal parity tolerances. The ephemeral runner deregistered and its marked
work root was removed.

## Production topology and ownership

| Boundary | Production resource | Ownership and authority |
| --- | --- | --- |
| Source and dispatch | Repository `Liatir/liatir-stack`, branch `main` | GitHub Actions reads the exact checked-out revision; production workflows are manual-only |
| Release approval | GitHub Environment `runtime-box-production` | Restricts the protected release workflow and holds release variables plus the Registry admin secret |
| Signer deployment approval | GitHub Environment `runtime-box-signer-admin` | Restricts signer source/policy deployment and holds only non-secret deployment variables |
| Signing project | Google Cloud project `liatir-release-security` | Separates signing authority from Cloudflare hosting |
| Signer | Private Cloud Run service `liatir-runtime-box-signer` in `europe-west1` | Validates exact payload bytes against `services/runtime-box-signer/policy.json` |
| Signing key | Key ring `liatir-release-signing`, key `runtime-box-production`, version `1`, public key ID `liatir-runtime-box-kms-2026` | Non-exportable Ed25519 key; only the signer runtime service account receives `roles/cloudkms.signerVerifier` |
| Registry control plane | Worker `liatir-runtime-box-registry` at `models.liatir.com` | Authenticates uploads and promotions, verifies signed documents, and stores control objects through its R2 binding |
| Immutable assets | R2 bucket `liatir-storage`, prefix `ai-runtime-boxes`, public origin `assets.models.liatir.com` | Stores content-addressed archives and signed release documents; it has no signing authority |
| Registry trust root | `ai-runtime-boxes/control/trusted-keys.json` | Contains public keys only; the app trust bundle is `runtime-boxes/trust/production-public.json` |

The Registry secret is `ADMIN_TOKEN` in Cloudflare and
`LIATIR_RUNTIME_BOX_ADMIN_TOKEN` in the protected GitHub Environment. These are
two names for the same rotating credential boundary. No secret value belongs
in the repository, evidence records, logs, or this report.

## Protected environments and variables

### `runtime-box-production`

Workflow: `.github/workflows/runtime-box-release.yml`

Environment variables:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_RELEASE_SERVICE_ACCOUNT`
- `LIATIR_RUNTIME_BOX_SIGNER_URL`
- `LIATIR_RUNTIME_BOX_REGISTRY`
- `LIATIR_RUNTIME_BOX_BUCKET`
- `LIATIR_RUNTIME_BOX_PREFIX`

Environment secret:

- `LIATIR_RUNTIME_BOX_ADMIN_TOKEN`

### `runtime-box-signer-admin`

Workflow: `.github/workflows/runtime-box-signer-deploy.yml`

Environment variables:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SIGNER_ADMIN_SERVICE_ACCOUNT`
- `GCP_SIGNER_BUILD_SERVICE_ACCOUNT`

This environment requires no repository signing secret. GitHub authenticates
to Google Cloud with OIDC, and the private signing key never leaves Cloud KMS.

## Workload identity boundary

The idempotent configuration source is
`scripts/configure-runtime-box-ci.sh`. Its defaults are:

- workload identity pool: `liatir-github-actions`;
- release provider: `runtime-box-production`;
- signer deployment provider: `runtime-box-signer-admin`;
- release service account: `runtime-box-release-ci@liatir-release-security.iam.gserviceaccount.com`;
- signer deployment service account: `runtime-box-signer-deploy-ci@liatir-release-security.iam.gserviceaccount.com`;
- signer runtime service account: `runtime-box-signer@liatir-release-security.iam.gserviceaccount.com`.

The two service-account bindings use these principal-set forms, where
`PROJECT_NUMBER` is resolved from Google Cloud rather than stored in docs:

```text
principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/liatir-github-actions/attribute.environment/runtime-box-production
principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/liatir-github-actions/attribute.environment/runtime-box-signer-admin
```

Each provider additionally requires the exact repository ID and name,
`refs/heads/main`, matching GitHub Environment, matching workflow path on
`main`, and `workflow_dispatch`. Environment membership alone is therefore not
sufficient to impersonate either service account.

The release identity may invoke the private signer but has no Cloud KMS role.
The deployment identity may deploy Cloud Run source and impersonate the signer
runtime identity, but also has no Cloud KMS role. The configuration script
asserts both project-level and key-level absence of KMS permissions.

## Operator procedures

All remote, paid, publishing, signer, token-rotation, trust-root, promotion, and
revocation actions require a fresh task checklist, exact source/workflow
readback, a clean and pushed `main`, explicit authorization, and immediate run
identity verification. Never use a production or paid run as a debugger.

### Cheap preflight

Read the current package scripts before running them, then use the applicable
local gates:

```bash
npm run runtime-box:catalog:check
npm run runtime-box:test:foundation
npm run runtime-box:test:native
npm run test:verify
npm run docs:internal:build
```

Model-specific changes additionally require their checked validator. A
documentation-only handoff does not justify downloading model assets or
rebuilding native archives.

### Reconcile protected identities

`npm run runtime-box:ci:configure` creates or reconciles the two GitHub
Environments, WIF pool/providers, service accounts, IAM boundaries, and
environment variables. It does not rotate the Registry token unless the
explicit rotation flag is supplied:

```bash
npm run runtime-box:ci:configure
```

This command changes live GitHub and Google Cloud configuration and must be run
only by an authorized operator after reviewing
`scripts/configure-runtime-box-ci.sh` from the exact revision.

### Deploy signer source or policy

After local signer and catalog checks, dispatch only the protected workflow:

```bash
gh workflow run runtime-box-signer-deploy.yml --ref main
```

Immediately verify that the created run uses the intended `main` SHA, workflow,
event, and `runtime-box-signer-admin` environment. Success requires source and
policy validation, private Cloud Run deployment, a short-lived OIDC identity
token, KMS smoke signing against the checked app trust root, compact evidence,
and no KMS permission on either GitHub identity.

### Release a catalog-approved target

The only canonical CI publication path is the protected release workflow:

```bash
gh workflow run runtime-box-release.yml --ref main \
  -f model_id=<catalog-model-id> \
  -f target_id=<catalog-target-id> \
  -f channel=beta
```

Reread the workflow choices, catalog-resolved runner, timeout, disk plan,
downloads, publication bandwidth, and expected cost immediately before every
dispatch. Verify the created run's workflow, run ID, exact SHA, inputs, and
environment at once. Stop or cancel on any mismatch. Use bounded background
waits and report only state transitions.

Do not dispatch `windows-x86_64-cuda12.4` under the current support decision.
Do not activate the macOS heavy runner except for a separately approved build;
it must use the repository launcher, dedicated marked work root, bounded online
time, unconditional deregistration, root removal, and retained diagnostics.

### Rotate the Registry admin token

Token rotation is a consequential two-system operation. The helper generates
the value in memory, updates Cloudflare, checks the authenticated Worker
boundary without publishing data, updates the protected GitHub Environment,
and unsets the local shell variable:

```bash
npm run runtime-box:ci:configure -- --rotate-registry-token
```

If the Worker probe or GitHub secret update fails, stop publication work and
reconcile both sides before another release. Never print, persist, or commit the
token.

### Revoke a released version

Revocation is an emergency production action, not an ordinary rollback. The
CLI first creates a signed revocation document; a separate authenticated
promotion makes it live:

```bash
npm run runtime-box -- revoke \
  --box <box-id> --version <version> --reason "<user-facing reason>" \
  --signer <private-signer-url> \
  --public-key runtime-boxes/trust/production-public.json
npm run runtime-box -- promote .runtime-box-dist/runtime-box-revocations.json \
  --registry https://models.liatir.com
```

The second command reads `LIATIR_RUNTIME_BOX_ADMIN_TOKEN` unless an explicitly
reviewed token file is supplied. The Registry stores one complete revocation
document, while the current `revoke` command creates a new single-entry
document; it does not merge an existing live list. Therefore, read back and
preserve every existing entry before signing a replacement. If the live list
is non-empty, stop and use a separately reviewed merge procedure or first add
CLI merge support; never promote the single-entry output as-is. Review the
exact signed payload and verify signer identity and target scope. After
promotion, read back `/v1/revocations` and confirm the app refuses new
installation or activation of the revoked version. Immutable R2 objects are
retained for audit; revocation does not delete them.

### Trust-root changes

`publish-key` replaces the Registry trust document and is deliberately guarded
by `--confirm`. A key rotation must stage old and new public keys together,
deploy matching signer policy/configuration, verify both the Registry and the
checked-in app trust bundle, and only later retire an old key after every
supported release remains verifiable. Never remove the legacy public key merely
because new releases use the KMS key.

## Monitoring, evidence, and cleanup

- GitHub retains compact workflow artifacts for 7 days. After review, copy only
  the contract-valid evidence JSON into `runtime-boxes/evidence/` and point the
  catalog publication at its immutable path.
- Never upload archives, model weights, raw scientific outputs, tokens, or
  credentials as GitHub artifacts.
- A successful build or immutable upload is not a completed release. Require
  scientific validation, public hash verification, applicable product
  lifecycle evidence, promotion, compact evidence, and cleanup.
- Failed immutable candidates may remain in R2 but must not be represented as a
  promoted or supported release.
- Verify runner cleanup explicitly after self-hosted work. The expected steady
  state for the Gate 9 macOS runner is no registered repository runner and no
  marked work root.

## Maintenance ownership

- `runtime-boxes/catalog.json`: live target, runner, cost, recipe, and
  publication authority.
- `runtime-boxes/evidence/`: reviewed compact production evidence.
- [AI Model ledger](../state/roadmap/ai-batches.md): the current support boundary for
  maintainers. It replaced the former Runtime Box compatibility matrix, deleted on
  2026-09-28 once it had fallen behind.
- `services/runtime-box-signer/policy.json`: signable model/target/origin
  allowlist.
- `scripts/configure-runtime-box-ci.sh`: protected identity and environment
  reconciliation.
- `scripts/deploy-runtime-box-signer.sh`: signer resource and deployment
  definition.
- `.github/workflows/runtime-box-release.yml`: protected publication chain.
- `.github/workflows/runtime-box-signer-deploy.yml`: protected signer
  deployment chain.
- `workers/runtime-box-registry/wrangler.jsonc`: Worker, R2 binding, domains,
  non-secret variables, and required secret name.
- This report: reviewed production state and operator handoff.

Update the report only after evidence, production topology, or operational
boundaries change. Do not copy transient incident details here; retain those in
the gate ledger or a focused incident record.
