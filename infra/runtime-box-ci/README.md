# Runtime Box CI identities

This directory records the protected identity boundary for Runtime Box releases and signer
deployments. Apply the idempotent configuration from an authenticated operator workstation:

```bash
npm run runtime-box:ci:configure
```

Rotate the shared Registry token independently, without changing Google IAM:

```bash
npm run runtime-box:ci:configure -- --rotate-registry-token
```

The rotation command generates the token in memory, updates the Worker first, proves the new token
through an authenticated fail-closed request, and only then updates the GitHub Environment secret.
It never prints or writes the value to disk.

## GitHub Environments

Both Environments allow deployments only from `main`:

- `runtime-box-production`
  - variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`,
    `GCP_RELEASE_SERVICE_ACCOUNT`, `LIATIR_RUNTIME_BOX_SIGNER_URL`,
    `LIATIR_RUNTIME_BOX_REGISTRY`, `LIATIR_RUNTIME_BOX_BUCKET`, and
    `LIATIR_RUNTIME_BOX_PREFIX`;
  - secret: `LIATIR_RUNTIME_BOX_ADMIN_TOKEN`.
- `runtime-box-signer-admin`
  - variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, and
    `GCP_SIGNER_ADMIN_SERVICE_ACCOUNT`;
  - no Registry secret.

GitHub Team supports Environment secrets and deployment branches for this private repository, but
not required reviewers. Protection therefore consists of `workflow_dispatch`, exact `main`,
environment-scoped credentials, and cloud-side OIDC conditions. Add required reviewers if the
repository moves to a plan that supports them for private repositories.

## Google Workload Identity Federation

Project `liatir-release-security` contains pool `liatir-github-actions` with three providers:

- `runtime-box-production` accepts only the release workflow on `main`, using the production
  Environment and `workflow_dispatch` event;
- `runtime-box-signer-admin` accepts only the signer deployment workflow under the equivalent
  signer-admin constraints;
- `runtime-box-revocation` accepts only the revocation workflow, under the same production
  Environment constraints as the release provider.

Each condition pins one exact `workflow_ref`. That is what stops a token minted for one workflow
being usable by another, so a new protected workflow gets a new provider rather than an extra
`workflow_ref` bolted onto an existing condition — and dispatching a protected workflow before its
provider exists fails closed, with `unauthorized_client: rejected by the attribute condition`.
Because the principal set is keyed on `attribute.environment`, a provider in an existing
Environment inherits that Environment's service account and needs no further IAM.

All providers also bind the immutable GitHub repository ID. The release service account has only
Cloud Run Invoker on the private signer. The signer deployment service account has Cloud Run Source
Developer, Service Usage Consumer, Service Account User on the signer runtime identity, and Invoker
for the post-deploy smoke test. Neither GitHub service account has project-level or key-level Cloud
KMS permissions. Only the Cloud Run runtime service account can use the signing key.

## Cloudflare boundary

GitHub receives no Cloudflare account or R2 API token. The Registry Worker owns the R2 binding and
accepts content-addressed archive uploads, immutable signed release documents, and channel promotion
through its authenticated admin surface. Anonymous admin requests must return `401`.
