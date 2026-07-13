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

The immutable archive and release manifest are uploaded directly to R2. A
separate promotion updates the selected channel through the Worker only after
the immutable objects are present.

Production builds refuse a dirty Git tree and record the builder commit in
signed provenance. `--allow-dirty` is limited to local development artifacts,
which `publish` refuses by default.

Deploy or update the private signer, then pass its Cloud Run URL to the build.
The CLI obtains a short-lived Google identity token and verifies the returned
signature locally before writing the document:

```bash
npm run runtime-box:signer:deploy
npm run runtime-box:signer:smoke -- https://PRIVATE-SERVICE-URL
npm run runtime-box -- build <recipe> \
  --signer https://PRIVATE-SERVICE-URL \
  --public-key runtime-boxes/trust/production-public.json
```

```bash
npm run runtime-box -- publish .runtime-box-dist/<release>.release.json \
  --bucket liatir-storage --prefix ai-runtime-boxes
npm run runtime-box -- publish-key --bucket liatir-storage \
  --prefix ai-runtime-boxes --confirm
npm run runtime-box -- promote .runtime-box-dist/<channel>.channel.json \
  --registry https://models.liatir.com --token-file .runtime-box-local/admin-token.txt
```

The Worker admin token is provided through `LIATIR_RUNTIME_BOX_ADMIN_TOKEN`.
Cloudflare receives only public keys and already-signed documents. The
production private key remains non-exportable in Cloud KMS and the Cloud Run
service identity has only `roles/cloudkms.signerVerifier` on that key.

The app always trusts the checked-in production public-key bundle. Additional public
trust roots can be supplied at compile time through
`LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON`. The legacy public key remains in the
bundle so already-published Runtime Boxes continue to verify during rotation.

scFoundation is not eligible for this distribution path: its model license
restricts weight redistribution. The Apache-2.0 repository code license does
not override the separate checkpoint license.
