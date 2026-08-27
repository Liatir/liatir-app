# Runtime Box Registry Worker

This Worker is the small control plane for AI Runtime Boxes and ready-made
single-cell reference indexes. It serves signed catalogs, channel and revocation
documents from R2 and accepts authenticated promotion of already-signed
metadata. Large archives are uploaded by the repository CLI and served directly
from the R2 custom domain.

## Local development

```bash
cp workers/runtime-box-registry/.dev.vars.example workers/runtime-box-registry/.dev.vars
npm run runtime-box:worker:types
npm run runtime-box:worker:dev
```

Wrangler uses local R2 storage by default. Seed
`ai-runtime-boxes/control/trusted-keys.json` with
the public signing key before testing an authenticated promotion:

```bash
npm run runtime-box -- publish-key --bucket liatir-storage \
  --prefix ai-runtime-boxes --local --confirm
```

## Production setup

1. Create the `liatir-storage` R2 bucket in the Personal account.
2. Upload `ai-runtime-boxes/control/trusted-keys.json` using Wrangler.
3. Set `ADMIN_TOKEN` with `wrangler secret put`; never store it in config. The required secret
   name is declared in `wrangler.jsonc`, but its value remains encrypted by Cloudflare.
4. Attach the Worker to `models.liatir.com`.
5. Attach the R2 custom domain to `assets.models.liatir.com`.

Production publication is intentionally two phase: upload immutable archive and
release objects first, then promote the signed channel document. Production
documents are signed independently by the private Google Cloud Run/KMS signer;
the Worker and R2 store only the public trust bundle and signed output.

The authenticated admin surface also exposes bounded multipart archive upload
for Runtime Boxes and reference indexes larger than Wrangler's object limit.
Keys are derived from a validated scientific or box identity plus SHA-256,
existing immutable objects are refused, each request is limited to 64 MiB, and
completion checks the expected byte size. The release CLI verifies the complete
public SHA-256 before it uploads or promotes signed metadata.

The source-mirror surface is narrower still: it accepts only IDs compiled into
both the Worker and repository CLI. The sole current ID is
`mhcflurry-class1-presentation`; its R2 key, byte size, SHA-256 and content type
cannot be supplied by a caller. Production upload runs only through the manual
`runtime-box-mhcflurry-source-mirror.yml` workflow in the protected
`runtime-box-production` environment, and finishes by streaming and hashing the
public object.

CI uses the Registry admin surface for both archives and immutable signed release documents.
It does not receive a Cloudflare account or R2 API token. Rotate the shared Worker/GitHub
Environment token with `npm run runtime-box:ci:configure -- --rotate-registry-token`.

## Production ownership and operations

The deployed Worker is `liatir-runtime-box-registry`. Its public control-plane
domain is `models.liatir.com`; immutable R2 objects use
`assets.models.liatir.com`. `wrangler.jsonc` binds `RUNTIME_BOXES` to bucket
`liatir-storage`, sets `OBJECT_PREFIX=ai-runtime-boxes`, and declares the
required Worker secret name `ADMIN_TOKEN`. `ASSET_ORIGIN` pins signed archive
URLs to `https://assets.models.liatir.com`.

The protected `runtime-box-production` GitHub Environment supplies these
Registry-facing variables to `.github/workflows/runtime-box-release.yml` and
`.github/workflows/single-cell-index-release.yml`:

- `LIATIR_RUNTIME_BOX_REGISTRY`
- `LIATIR_RUNTIME_BOX_BUCKET`
- `LIATIR_RUNTIME_BOX_PREFIX`

Its corresponding Environment secret is
`LIATIR_RUNTIME_BOX_ADMIN_TOKEN`. The Worker secret and GitHub secret must hold
the same rotating value, but the value must never appear in repository files,
workflow evidence, logs, or documentation.

Production publication uses the protected release workflow. Direct `publish`,
`publish-key`, `promote`, token rotation, and revocation commands are operator
surfaces and require exact revision review plus explicit authorization. In
particular, `publish-key` replaces the Registry trust document and must be used
only as part of a staged key rotation that retains all keys needed by supported
releases.

Token rotation is deliberately explicit:

```bash
npm run runtime-box:ci:configure -- --rotate-registry-token
```

The helper updates Cloudflare first, probes the authenticated boundary without
publishing data, then updates the protected GitHub Environment. If either side
fails, stop release work and reconcile the two stores before continuing.

Revocation creates and promotes a signed complete revocation list; it does not
delete immutable R2 objects. Read the signed document before promotion and read
back `/v1/revocations` afterward. A failed or merely uploaded candidate must
never be represented as channel-promoted.

See the internal
[Runtime Box production report](../../.mind/roadmap/runtime-box-production-report.md)
for the evidence matrix, identity boundary, exact protected workflow inputs,
revocation sequence, and cleanup rules.
