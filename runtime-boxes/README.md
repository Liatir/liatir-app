# AI Runtime Boxes

AI Runtime Boxes are immutable, signed archives containing a relocatable
runtime, its exact dependency set, model assets, and build provenance. Liatir
downloads them on demand; they are not bundled into the desktop installer.

The distribution design has two separate paths:

- `runtime-box` CLI: build, verify, serve locally, publish immutable artifacts
  to R2, and promote signed channel documents.
- Runtime Box Registry Worker: serve small signed channel/revocation documents
  and accept authenticated channel promotions. It never proxies large boxes.
- Runtime Box Signer: validate production metadata in a private Google Cloud
  Run service and sign it with a non-exportable Ed25519 Cloud KMS key.

## Local development

```bash
npm run runtime-box -- keygen
npm run runtime-box -- lock geneformer-v1-10m-macos-arm64-metal
npm run runtime-box -- build geneformer-v1-10m-macos-arm64-metal \
  --asset-base-url http://127.0.0.1:8790/objects --allow-dirty
npm run runtime-box -- verify .runtime-box-dist/<release>.release.json --self-test
npm run runtime-box -- serve
npm run runtime-box:validate:geneformer
npm run runtime-box:validate:scgpt
npm run runtime-box:test:foundation
```

The UCE 4-layer packaging gate uses its model-specific recipe and the same
generic build and verify commands:

```bash
npm run runtime-box -- build uce-4layer-macos-arm64-metal \
  --asset-base-url http://127.0.0.1:8790/objects
npm run runtime-box -- verify \
  .runtime-box-dist/uce-4layer-1.0.0-beta.1-macos-aarch64-metal.release.json \
  --self-test
```

The measured Gate 3 evidence is recorded in
[`measurements/uce-4layer-macos-arm64-metal.md`](measurements/uce-4layer-macos-arm64-metal.md).
The catalog now selects this Runtime Box through the shared single-cell runner.
Gate 5 also validates that exact product runner with one deterministic CPU run
and one Apple Metal run:

```bash
npm run runtime-box:validate:uce
```

The focused run validates finite 1,280-dimensional output, preserved raw input,
all result artifacts and provenance, plus CPU/Metal numeric parity. It does not
publish a production channel or cover the native install lifecycle.

`build` requires the exact `uv` version declared by the recipe. It copies the
complete Astral-managed standalone Python distribution into the box, synchronizes
the checked-in hash lock, downloads every asset with SHA-256 verification, runs
the recipe self-test, and creates a normalized ZIP archive.
Recipe asset archives may use `zip` or `tar.gz`. Their complete entry lists are
validated before extraction; traversal paths, symbolic links, hard links, and
special entries are rejected, and the compressed source is removed from the
payload by default after successful extraction.
Recipes may declare reviewed `prunePaths` for build, training, and installer
files that are not part of the immutable inference runtime. Every pruned box
must still pass its post-extraction self-test and real model-specific gate.

New release manifests sign the exact logical `installedSizeBytes` produced by
the builder. Before downloading, the app combines the remaining archive bytes,
the extracted payload, the active runtime, the retained rollback, and a safety
margin into a peak disk-space plan. The extracted payload size is checked again
before self-test and activation. Older signed releases without this optional
field remain installable and retain the download-size preflight.

`runtime-box:test:foundation` is a focused infrastructure gate. It validates
safe TAR handling and builds the same deterministic ZIP twice around a sparse
file larger than 4 GiB, then extracts that Zip64 archive through the production
Rust helper. It does not download or run an AI Model.

## CI catalog and workflows

[`catalog.json`](catalog.json) is the machine-readable authority for CI model
identities, recipes, exact targets, runner labels, timeouts, legal gates,
validation modes, and compact publication evidence. Run
`npm run runtime-box:catalog:check` after changing it. Workflows accept IDs,
but runner labels and executable validator scripts are always resolved from
this checked catalog rather than from arbitrary dispatch input.

`runtime-box-foundation.yml` runs cheap shared contract checks and small native
fixtures on pinned Linux x64, Windows x64, and macOS arm64 runners. The
per-model workflows use path filters and perform only the Ubuntu preflight on
automatic events; a native model build requires an explicit manual dispatch.
Paid GPU workflows remain separate and manual. No validation workflow uploads
a Runtime Box archive.

## CI cost controls

[`catalog.json`](catalog.json) also owns the enforceable Runtime Box cost
policy. Every model target pins its dependency-lock hash and a conservative
pre-download disk plan made from declared source assets, estimated extracted
payload, archive size, and a safety margin. The cheap Ubuntu preflight rejects
an invalid lock, legal/catalog drift, an underestimated disk plan, arbitrary
runner input, or an unapproved mode before a native or GPU runner can start.
The native host then verifies its real free disk before downloading anything.

GPU host preflights and future model GPU validation are manual-only and have no
schedule, push, or pull-request trigger. Shared infrastructure changes can fan
out only to cheap standard-runner contract preflights; they never request a
native model build automatically. Validation concurrency is one model and one
target at a time across all modes, stale validation is cancelled, foundation
native fixtures use `max-parallel: 1`, and production releases share one queue
that is never cancelled.

The Linux T4 target is the first model CUDA gate. A Windows CUDA target cannot
be enabled in the checked catalog until its same-model Linux CUDA prerequisite
is at least scientifically validated. Even the Windows host preflight requires
the run ID of a successful manual Linux T4 preflight for the exact same commit,
and verifies it on a standard runner before allocating Windows T4. CPU
reference and GPU parity belong in the same paid job when practical, avoiding
duplicate setup and downloads.

Long native build, scientific validator, fixture, and Rust lifecycle commands
emit one concise heartbeat every 5 minutes. This is a liveness signal, not
status polling. Model weights, Runtime Box archives, and uv downloads are not
cached; npm's dependency cache remains independent of scientific
assets. Compact evidence is the only uploaded Runtime Box artifact.

Production publication and signer deployment are manual-only workflows behind
the `runtime-box-production` and `runtime-box-signer-admin` GitHub environments.
They become runnable only after Gate 5 provisions the environments, WIF
identities, variables, and secrets. Release concurrency is never cancelled,
and channel promotion is the final step after immutable publication and public
hash verification.

The two publications that still predate this CI foundation are recorded as
`legacy-operator` evidence. They keep their real signed release metadata and
deliberately do not invent GitHub workflow run IDs. Every new publication made
by the release workflow must be recorded with `github-actions` run evidence and
a reviewed pointer to a compact record under [`evidence/`](evidence/README.md).

The shared evidence contract lives in
`packages/liatir-core/src/runtime-box.ts`; `scripts/runtime-box/evidence.mjs`
collects the exact source/recipe/lock identity, native host and peak disk
pressure, build/self-test results, scientific fixture and parity details, KMS
signature identity, public streamed hashes, and channel-promotion receipt.
Successful CI records are uploaded for 7 days. Runtime Box archives and model
assets are never GitHub artifacts, and CI has no permission to update this
directory or readiness documents itself.

The model-specific validation commands are intentionally separate from the
general test matrix. Geneformer compares the product runner with the pinned
upstream tokenizer and embedding algorithm. scGPT loads the packaged official
checkpoint and source, runs one real CPU embedding, and validates finite output.

For a fast installer-only check, build the small fixture instead:

```bash
npm run runtime-box -- build installer-fixture-macos-arm64 \
  --asset-base-url http://127.0.0.1:8790/objects --channel development --allow-dirty
npm run runtime-box -- verify \
  .runtime-box-dist/runtime-box-installer-fixture-0.1.0-macos-aarch64-metal.release.json \
  --self-test
npm run runtime-box -- serve
```

The app can also use the local control plane by starting Liatir with
`LIATIR_RUNTIME_BOX_REGISTRY_URL=http://127.0.0.1:8790/v1` and
`LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE=.runtime-box-local/signing-public.json`.
These debug-only overrides exercise the real signed download, resume,
extraction, activation, and rollback path. A fixture run does not validate
Geneformer numerics or scientific parity.

Development signing keys and build outputs live under `.runtime-box-local/` and
`.runtime-box-dist/`; both are ignored. Never commit a private signing key.

## Production publication

The canonical production path is the manual
`.github/workflows/runtime-box-release.yml` workflow behind the
`runtime-box-production` GitHub Environment. It resolves only catalog-approved
inputs, obtains a short-lived OIDC identity, builds with the private signer,
verifies and scientifically validates the candidate, publishes immutable
objects, runs the applicable product lifecycle, promotes beta, writes compact
evidence, and cleans build state. The complete resource, identity, variable,
secret-name, evidence, and incident-operation handoff is in the internal
[Runtime Box production report](../internal-docs/roadmap/runtime-box-production-report.md).

The immutable archive and release manifest are uploaded through the
least-privilege Registry Worker into R2. A separate promotion updates the
selected channel only after the immutable objects are present and publicly
verified byte for byte.

Production builds refuse a dirty Git tree and record the builder commit in
signed provenance. `--allow-dirty` is limited to local development artifacts,
which `publish` refuses by default.

The following direct CLI examples are operator and local-integration surfaces,
not a substitute for the protected production workflows. Deploying the signer,
publishing, changing the trust root, and promoting are consequential operations
that require an exact revision readback and explicit authorization. The CLI
obtains a short-lived Google identity token and verifies the returned signature
locally before writing the document:

```bash
npm run runtime-box:signer:deploy
npm run runtime-box:signer:smoke -- https://PRIVATE-SERVICE-URL
npm run runtime-box -- build <recipe> \
  --signer https://PRIVATE-SERVICE-URL \
  --public-key runtime-boxes/trust/production-public.json
```

```bash
npm run runtime-box -- publish .runtime-box-dist/<release>.release.json \
  --bucket liatir-storage --prefix ai-runtime-boxes \
  --registry https://models.liatir.com \
  --token-file .runtime-box-local/admin-token.txt
npm run runtime-box -- publish-key --bucket liatir-storage \
  --prefix ai-runtime-boxes --confirm
npm run runtime-box -- promote .runtime-box-dist/<channel>.channel.json \
  --registry https://models.liatir.com --token-file .runtime-box-local/admin-token.txt
```

The Worker admin token is provided through `LIATIR_RUNTIME_BOX_ADMIN_TOKEN`.
Cloudflare receives only public keys and already-signed documents. The
production private key remains non-exportable in Cloud KMS and the Cloud Run
service identity has only `roles/cloudkms.signerVerifier` on that key.

`publish` uses the same Registry Worker admin token for bounded 64 MiB archive
multipart uploads and small signed release documents. The Worker accepts only
content-addressed Runtime Box paths, refuses an existing immutable object, and
checks the completed byte size. Before uploading the signed release document,
the CLI streams the public archive back and verifies its complete SHA-256.

The app always trusts the checked-in production public-key bundle. Additional public
trust roots can be supplied at compile time through
`LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON`. The legacy public key remains in the
bundle so already-published Runtime Boxes continue to verify during rotation.

scFoundation is not eligible for this distribution path: its model license
restricts weight redistribution. The Apache-2.0 repository code license does
not override the separate checkpoint license.
