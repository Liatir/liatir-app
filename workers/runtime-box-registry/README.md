# Runtime Box Registry Worker

This Worker is the small control plane for AI Runtime Boxes. It serves signed
channel and revocation documents from R2 and accepts authenticated promotion of
already-signed metadata. Large archives are uploaded by the repository CLI and
served directly from the R2 custom domain.

## Local development

```bash
cp workers/runtime-box-registry/.dev.vars.example workers/runtime-box-registry/.dev.vars
npm run runtime-box:worker:types
npm run runtime-box:worker:dev
```

Wrangler uses local R2 storage by default. Seed `control/trusted-keys.json` with
the public signing key before testing an authenticated promotion:

```bash
npm run runtime-box -- publish-key --bucket liatir-ai-runtime-boxes --local --confirm
```

## Production setup

1. Create the `liatir-ai-runtime-boxes` R2 bucket.
2. Upload `control/trusted-keys.json` using Wrangler.
3. Set `ADMIN_TOKEN` with `wrangler secret put`; never store it in config.
4. Attach the Worker to `models.liatir.app`.
5. Attach the R2 public bucket/custom domain to `assets.models.liatir.app`.

Production publication is intentionally two phase: upload immutable archive and
release objects first, then promote the signed channel document.
