#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project)}"
REGION="${LIATIR_SIGNER_REGION:-europe-west1}"
SERVICE="${LIATIR_SIGNER_SERVICE:-liatir-runtime-box-signer}"
SERVICE_ACCOUNT="${LIATIR_SIGNER_SERVICE_ACCOUNT:-runtime-box-signer}"
KEY_RING="${LIATIR_SIGNER_KEY_RING:-liatir-release-signing}"
KEY="${LIATIR_SIGNER_KEY:-runtime-box-production}"
KEY_ID="${LIATIR_SIGNER_KEY_ID:-liatir-runtime-box-kms-2026}"
BUILD_SERVICE_ACCOUNT="${LIATIR_SIGNER_BUILD_SERVICE_ACCOUNT:-}"
DEPLOY_ONLY="${LIATIR_SIGNER_DEPLOY_ONLY:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$BUILD_SERVICE_ACCOUNT" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  BUILD_SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
fi

if [[ "$DEPLOY_ONLY" == "1" ]]; then
  # CI deploys code and policy only. It must not access KMS directly: the post-deploy smoke test
  # exercises the private Cloud Run signer, whose runtime identity is the sole KMS principal.
  gcloud iam service-accounts describe "$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null
else
  gcloud services enable run.googleapis.com cloudkms.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"
  gcloud iam service-accounts describe "$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$SERVICE_ACCOUNT" --display-name="Runtime Box signer" --project "$PROJECT_ID"
  gcloud kms keyrings describe "$KEY_RING" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud kms keyrings create "$KEY_RING" --location "$REGION" --project "$PROJECT_ID"
  gcloud kms keys describe "$KEY" --keyring "$KEY_RING" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud kms keys create "$KEY" --keyring "$KEY_RING" --location "$REGION" --purpose=asymmetric-signing --default-algorithm=ec-sign-ed25519 --protection-level=software --project "$PROJECT_ID"
  gcloud kms keys versions describe 1 --key "$KEY" --keyring "$KEY_RING" --location "$REGION" --project "$PROJECT_ID" >/dev/null
  gcloud kms keys add-iam-policy-binding "$KEY" --keyring "$KEY_RING" --location "$REGION" \
    --member="serviceAccount:$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/cloudkms.signerVerifier --project "$PROJECT_ID"
fi

KEY_VERSION="projects/$PROJECT_ID/locations/$REGION/keyRings/$KEY_RING/cryptoKeys/$KEY/cryptoKeyVersions/1"
gcloud run deploy "$SERVICE" --source "$ROOT/services/runtime-box-signer" --region "$REGION" --project "$PROJECT_ID" \
  --build-service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SERVICE_ACCOUNT" \
  --service-account "$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --no-allow-unauthenticated \
  --min-instances=0 --max-instances=2 --concurrency=8 --cpu=1 --memory=256Mi --timeout=30s \
  --set-env-vars="KMS_KEY_VERSION=$KEY_VERSION,RUNTIME_BOX_KEY_ID=$KEY_ID" --quiet

if [[ "$DEPLOY_ONLY" != "1" ]]; then
  gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
    --member="user:$(gcloud config get-value account)" --role=roles/run.invoker
  gcloud kms keys versions get-public-key 1 --key "$KEY" --keyring "$KEY_RING" --location "$REGION" --project "$PROJECT_ID"
fi
