# Runtime Box Signer

Private Cloud Run service that validates Runtime Box release metadata against a
versioned allowlist and asks Cloud KMS to create an Ed25519 signature. The
service never stores or exports private key material and never proxies Runtime
Box archives.

Cloud Run IAM is the authentication boundary. Deploy the service without
unauthenticated access and grant `roles/run.invoker` only to the release
operator or a dedicated workload identity. Its service account needs only
`roles/cloudkms.signerVerifier` on the signing key.

## Production resources and identities

- Google Cloud project: `liatir-release-security`
- region: `europe-west1`
- Cloud Run service: `liatir-runtime-box-signer`
- signer runtime service account:
  `runtime-box-signer@liatir-release-security.iam.gserviceaccount.com`
- key ring: `liatir-release-signing`
- key: `runtime-box-production`
- key version: `1`
- public key ID: `liatir-runtime-box-kms-2026`

The release service account
`runtime-box-release-ci@liatir-release-security.iam.gserviceaccount.com` may
invoke the signer. The separate deployment service account
`runtime-box-signer-deploy-ci@liatir-release-security.iam.gserviceaccount.com`
may deploy the service and impersonate its runtime account. Neither GitHub
identity has a project-level or key-level Cloud KMS role; the configuration
script asserts that boundary.

`policy.json` is intentionally reviewed and deployed with the service. Adding a
new AI Model or target therefore requires a code review and signer deployment
before KMS will sign it.

The repository deployment helper provisions the service for an authorized
bootstrap operator:

```bash
bash scripts/deploy-runtime-box-signer.sh
```

GitHub OIDC identities and protected Environment variables are provisioned idempotently with:

```bash
npm run runtime-box:ci:configure
```

The protected deployment path is
`.github/workflows/runtime-box-signer-deploy.yml` behind the
`runtime-box-signer-admin` GitHub Environment. Its configured variables are:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SIGNER_ADMIN_SERVICE_ACCOUNT`
- `GCP_SIGNER_BUILD_SERVICE_ACCOUNT`

It requires no GitHub signing secret. After local catalog and signer checks,
an explicitly authorized operator dispatches the workflow from exact `main`:

```bash
gh workflow run runtime-box-signer-deploy.yml --ref main
```

Immediately verify the created run's workflow, SHA, event, and Environment.
Success requires the KMS smoke test against
`runtime-boxes/trust/production-public.json` and compact deployment evidence.
Do not use deployment as a debugging loop.

After deployment, build a Runtime Box with remote signing:

```bash
npm run runtime-box -- build <recipe> \
  --signer https://SERVICE-URL \
  --public-key runtime-boxes/trust/production-public.json
```

The canonical production build is the protected release workflow, not this
direct command. `policy.json`, the service source, the deployment script, the
checked-in public trust bundle, and the WIF/environment configuration must be
reviewed together for a signer or key change. Key rotation must retain every
public key needed to verify supported releases.

See the internal
[Runtime Box production report](../../project-knowledge-base/roadmap/runtime-box-production-report.md)
for the exact WIF principal forms, release environment, evidence matrix,
rotation boundary, and incident procedures.
