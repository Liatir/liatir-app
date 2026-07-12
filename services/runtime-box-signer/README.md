# Runtime Box Signer

Private Cloud Run service that validates Runtime Box release metadata against a
versioned allowlist and asks Cloud KMS to create an Ed25519 signature. The
service never stores or exports private key material and never proxies Runtime
Box archives.

Cloud Run IAM is the authentication boundary. Deploy the service without
unauthenticated access and grant `roles/run.invoker` only to the release
operator or a dedicated workload identity. Its service account needs only
`roles/cloudkms.signerVerifier` on the signing key.

`policy.json` is intentionally reviewed and deployed with the service. Adding a
new AI Model or target therefore requires a code review and signer deployment
before KMS will sign it.

The repository deployment helper provisions the service:

```bash
bash scripts/deploy-runtime-box-signer.sh
```

After deployment, build a Runtime Box with remote signing:

```bash
npm run runtime-box -- build <recipe> \
  --signer https://SERVICE-URL \
  --public-key runtime-boxes/trust/production-public.json
```
