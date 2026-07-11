# AI Runtime Boxes

AI Runtime Boxes are immutable, signed archives containing a relocatable
runtime, its exact dependency set, model assets, and build provenance. Liatir
downloads them on demand; they are not bundled into the desktop installer.

The distribution design has two separate paths:

- `runtime-box` CLI: build, verify, serve locally, publish immutable artifacts
  to R2, and promote signed channel documents.
- Runtime Box Registry Worker: serve small signed channel/revocation documents
  and accept authenticated channel promotions. It never proxies large boxes.

## Local development

```bash
npm run runtime-box -- keygen
npm run runtime-box -- lock geneformer-v1-10m-macos-arm64-metal
npm run runtime-box -- build geneformer-v1-10m-macos-arm64-metal \
  --asset-base-url http://127.0.0.1:8790/objects --allow-dirty
npm run runtime-box -- verify .runtime-box-dist/<release>.release.json --self-test
npm run runtime-box -- serve
```

`build` requires the exact `uv` version declared by the recipe. It copies the
complete Astral-managed standalone Python distribution into the box, synchronizes
the checked-in hash lock, downloads every asset with SHA-256 verification, runs
the recipe self-test, and creates a normalized ZIP archive.

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

Local signing keys and build outputs live under `.runtime-box-local/` and
`.runtime-box-dist/`; both are ignored. Never commit a private signing key.

## Production publication

The immutable archive and release manifest are uploaded directly to R2. A
separate promotion updates the selected channel through the Worker only after
the immutable objects are present.

Production builds refuse a dirty Git tree and record the builder commit in
signed provenance. `--allow-dirty` is limited to local development artifacts,
which `publish` refuses by default.

```bash
npm run runtime-box -- publish .runtime-box-dist/<release>.release.json \
  --bucket liatir-ai-runtime-boxes
npm run runtime-box -- publish-key --bucket liatir-ai-runtime-boxes --confirm
npm run runtime-box -- promote .runtime-box-dist/<channel>.channel.json \
  --registry https://models.liatir.app
```

The Worker admin token is provided through `LIATIR_RUNTIME_BOX_ADMIN_TOKEN`.
The offline signing key is never uploaded to Cloudflare.

Production desktop builds receive their public trust roots at compile time via
`LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON`. Only public keys belong in that value;
private keys stay offline and should be backed up before the first release.
