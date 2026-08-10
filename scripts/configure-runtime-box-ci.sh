#!/usr/bin/env bash
set -euo pipefail

# Idempotently provisions the protected identities and GitHub Environments used by Runtime Box CI.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY="${LIATIR_GITHUB_REPOSITORY:-Liatir/liatir-stack}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-liatir-release-security}"
REGION="${LIATIR_SIGNER_REGION:-europe-west1}"
SIGNER_SERVICE="${LIATIR_SIGNER_SERVICE:-liatir-runtime-box-signer}"
SIGNER_RUNTIME_SERVICE_ACCOUNT="${LIATIR_SIGNER_SERVICE_ACCOUNT:-runtime-box-signer}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_ID="${LIATIR_WIF_POOL_ID:-liatir-github-actions}"
RELEASE_PROVIDER_ID="${LIATIR_RELEASE_PROVIDER_ID:-runtime-box-production}"
SIGNER_PROVIDER_ID="${LIATIR_SIGNER_PROVIDER_ID:-runtime-box-signer-admin}"
REVOCATION_PROVIDER_ID="${LIATIR_REVOCATION_PROVIDER_ID:-runtime-box-revocation}"
RELEASE_SERVICE_ACCOUNT_ID="${LIATIR_RELEASE_SERVICE_ACCOUNT_ID:-runtime-box-release-ci}"
SIGNER_SERVICE_ACCOUNT_ID="${LIATIR_SIGNER_ADMIN_SERVICE_ACCOUNT_ID:-runtime-box-signer-deploy-ci}"
PRODUCTION_ENVIRONMENT="runtime-box-production"
SIGNER_ENVIRONMENT="runtime-box-signer-admin"
ROTATE_REGISTRY_TOKEN=0

usage() {
  cat <<'EOF'
Usage: scripts/configure-runtime-box-ci.sh [--rotate-registry-token]

Creates or reconciles Runtime Box GitHub Environments, Google Workload Identity
Federation providers, and least-privilege service accounts. Registry token
rotation is explicit because it changes the live Worker secret.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rotate-registry-token)
      ROTATE_REGISTRY_TOKEN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

for command in gh gcloud openssl curl; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

cd "$ROOT"
WRANGLER="$ROOT/node_modules/.bin/wrangler"
if [[ ! -x "$WRANGLER" ]]; then
  echo "Missing local Wrangler binary; run npm install first." >&2
  exit 1
fi

# Rotates the shared token in memory and verifies the Worker accepted it without publishing data.
rotate_registry_token() {
  gh api "repos/$REPOSITORY/environments/$PRODUCTION_ENVIRONMENT" >/dev/null
  local admin_token
  admin_token="$(openssl rand -hex 32)"
  printf '{"ADMIN_TOKEN":"%s"}' "$admin_token" \
    | "$WRANGLER" secret bulk --config workers/runtime-box-registry/wrangler.jsonc >/dev/null
  # A secret change creates a new Worker version; allow the custom domain to observe it once.
  sleep 30
  local status
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --request POST https://models.liatir.com/v1/admin/uploads \
    --header "Authorization: Bearer $admin_token" \
    --header 'Content-Type: application/json' --data '{}')"
  if [[ "$status" != "400" ]]; then
    echo "Registry token rotation probe returned HTTP $status instead of 400." >&2
    exit 1
  fi
  printf '%s' "$admin_token" \
    | gh secret set LIATIR_RUNTIME_BOX_ADMIN_TOKEN --env "$PRODUCTION_ENVIRONMENT" -R "$REPOSITORY"
  unset admin_token
  echo "Runtime Box Registry token rotated in Cloudflare and the production Environment."
}

if [[ "$ROTATE_REGISTRY_TOKEN" == "1" ]]; then
  rotate_registry_token
  exit 0
fi

# Creates an Environment once, then refuses unexpected branch-policy drift on later runs.
ensure_environment() {
  local environment="$1"
  if ! gh api "repos/$REPOSITORY/environments/$environment" >/dev/null 2>&1; then
    printf '%s' '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
      | gh api --method PUT "repos/$REPOSITORY/environments/$environment" --input - >/dev/null
  fi
  local custom_policy
  custom_policy="$(gh api "repos/$REPOSITORY/environments/$environment" --jq '.deployment_branch_policy.custom_branch_policies')"
  if [[ "$custom_policy" != "true" ]]; then
    echo "Environment $environment is not restricted by custom branch policy." >&2
    exit 1
  fi
  local policies
  policies="$(gh api --paginate "repos/$REPOSITORY/environments/$environment/deployment-branch-policies" --jq '.branch_policies[].name')"
  if ! grep -qx 'main' <<<"$policies"; then
    gh api --method POST "repos/$REPOSITORY/environments/$environment/deployment-branch-policies" \
      -f name=main -f type=branch >/dev/null
    policies="$(gh api --paginate "repos/$REPOSITORY/environments/$environment/deployment-branch-policies" --jq '.branch_policies[].name')"
  fi
  if [[ "$(grep -vcx 'main' <<<"$policies")" -ne 0 ]]; then
    echo "Environment $environment has an unexpected deployment branch policy." >&2
    exit 1
  fi
}

set_environment_variable() {
  local environment="$1"
  local name="$2"
  local value="$3"
  printf '%s' "$value" | gh variable set "$name" --env "$environment" -R "$REPOSITORY"
}

ensure_service_account() {
  local account_id="$1"
  local display_name="$2"
  local account_email="$account_id@$PROJECT_ID.iam.gserviceaccount.com"
  gcloud iam service-accounts describe "$account_email" --project "$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$account_id" --display-name "$display_name" \
      --project "$PROJECT_ID" --quiet >/dev/null
}

ensure_provider() {
  local provider_id="$1"
  local display_name="$2"
  local environment="$3"
  local workflow="$4"
  local condition
  condition="assertion.repository_id=='$REPOSITORY_ID' && assertion.repository=='$REPOSITORY' && assertion.ref=='refs/heads/main' && assertion.environment=='$environment' && assertion.workflow_ref=='$REPOSITORY/.github/workflows/$workflow@refs/heads/main' && assertion.event_name=='workflow_dispatch'"
  local mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref,attribute.event_name=assertion.event_name"
  if gcloud iam workload-identity-pools providers describe "$provider_id" \
    --workload-identity-pool "$POOL_ID" --location global --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam workload-identity-pools providers update-oidc "$provider_id" \
      --workload-identity-pool "$POOL_ID" --location global --project "$PROJECT_ID" \
      --display-name "$display_name" --issuer-uri https://token.actions.githubusercontent.com \
      --attribute-mapping "$mapping" --attribute-condition "$condition" --quiet >/dev/null
  else
    gcloud iam workload-identity-pools providers create-oidc "$provider_id" \
      --workload-identity-pool "$POOL_ID" --location global --project "$PROJECT_ID" \
      --display-name "$display_name" --issuer-uri https://token.actions.githubusercontent.com \
      --attribute-mapping "$mapping" --attribute-condition "$condition" --quiet >/dev/null
  fi
}

grant_project_role() {
  local account_email="$1"
  local role="$2"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$account_email" --role "$role" --quiet >/dev/null
}

assert_no_project_kms_role() {
  local account_email="$1"
  local roles
  roles="$(gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$account_email" \
    --format='value(bindings.role)')"
  if [[ "$roles" == *cloudkms* ]]; then
    echo "GitHub identity unexpectedly has a Cloud KMS role: $account_email" >&2
    exit 1
  fi
}

assert_no_key_kms_role() {
  local account_email="$1"
  local roles
  roles="$(gcloud kms keys get-iam-policy runtime-box-production \
    --keyring liatir-release-signing --location "$REGION" --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$account_email" \
    --format='value(bindings.role)')"
  if [[ "$roles" == *cloudkms* ]]; then
    echo "GitHub identity unexpectedly has a key-level Cloud KMS role: $account_email" >&2
    exit 1
  fi
}

REPOSITORY_ID="$(gh api "repos/$REPOSITORY" --jq '.id')"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SIGNER_URL="$(gcloud run services describe "$SIGNER_SERVICE" --region "$REGION" \
  --project "$PROJECT_ID" --format='value(status.url)')"
if [[ -z "$REPOSITORY_ID" || -z "$PROJECT_NUMBER" || -z "$SIGNER_URL" ]]; then
  echo "Cannot resolve the repository, project, or private signer identity." >&2
  exit 1
fi

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudkms.googleapis.com \
  --project "$PROJECT_ID" --quiet >/dev/null

ensure_environment "$PRODUCTION_ENVIRONMENT"
ensure_environment "$SIGNER_ENVIRONMENT"

if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location global \
  --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" --location global --project "$PROJECT_ID" \
    --display-name "Liatir GitHub Actions" --description "Environment-bound Runtime Box identities" \
    --quiet >/dev/null
fi

ensure_provider "$RELEASE_PROVIDER_ID" "Runtime Box production releases" \
  "$PRODUCTION_ENVIRONMENT" "runtime-box-release.yml"
ensure_provider "$SIGNER_PROVIDER_ID" "Runtime Box signer deployments" \
  "$SIGNER_ENVIRONMENT" "runtime-box-signer-deploy.yml"
# Revocation withdraws a published box, so it signs with the same production key and runs in the
# same Environment as a release — but it gets its own provider rather than sharing the release one.
# Each condition pins a single exact `workflow_ref`, which is what stops a token minted for one
# workflow from being usable by another; widening the release condition to name a second workflow
# would trade that guarantee for one fewer resource. No extra IAM follows from this: the principal
# set is keyed on `attribute.environment`, so this provider resolves to the release service account
# that already holds Cloud Run Invoker on the signer.
ensure_provider "$REVOCATION_PROVIDER_ID" "Runtime Box revocations" \
  "$PRODUCTION_ENVIRONMENT" "runtime-box-revoke.yml"

ensure_service_account "$RELEASE_SERVICE_ACCOUNT_ID" "Runtime Box release CI"
ensure_service_account "$SIGNER_SERVICE_ACCOUNT_ID" "Runtime Box signer deployment CI"

RELEASE_SERVICE_ACCOUNT="$RELEASE_SERVICE_ACCOUNT_ID@$PROJECT_ID.iam.gserviceaccount.com"
SIGNER_SERVICE_ACCOUNT="$SIGNER_SERVICE_ACCOUNT_ID@$PROJECT_ID.iam.gserviceaccount.com"
POOL_RESOURCE="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID"
RELEASE_PRINCIPAL="principalSet://iam.googleapis.com/$POOL_RESOURCE/attribute.environment/$PRODUCTION_ENVIRONMENT"
SIGNER_PRINCIPAL="principalSet://iam.googleapis.com/$POOL_RESOURCE/attribute.environment/$SIGNER_ENVIRONMENT"

gcloud iam service-accounts add-iam-policy-binding "$RELEASE_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" --member "$RELEASE_PRINCIPAL" --role roles/iam.workloadIdentityUser \
  --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RELEASE_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" --member "serviceAccount:$RELEASE_SERVICE_ACCOUNT" \
  --role roles/iam.serviceAccountOpenIdTokenCreator --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SIGNER_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" --member "$SIGNER_PRINCIPAL" --role roles/iam.workloadIdentityUser \
  --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SIGNER_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" --member "serviceAccount:$SIGNER_SERVICE_ACCOUNT" \
  --role roles/iam.serviceAccountOpenIdTokenCreator --quiet >/dev/null

gcloud run services add-iam-policy-binding "$SIGNER_SERVICE" --region "$REGION" \
  --project "$PROJECT_ID" --member "serviceAccount:$RELEASE_SERVICE_ACCOUNT" \
  --role roles/run.invoker --quiet >/dev/null
gcloud run services add-iam-policy-binding "$SIGNER_SERVICE" --region "$REGION" \
  --project "$PROJECT_ID" --member "serviceAccount:$SIGNER_SERVICE_ACCOUNT" \
  --role roles/run.invoker --quiet >/dev/null

grant_project_role "$SIGNER_SERVICE_ACCOUNT" roles/run.sourceDeveloper
grant_project_role "$SIGNER_SERVICE_ACCOUNT" roles/serviceusage.serviceUsageConsumer
gcloud iam service-accounts add-iam-policy-binding "$SIGNER_RUNTIME_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" --member "serviceAccount:$SIGNER_SERVICE_ACCOUNT" \
  --role roles/iam.serviceAccountUser --quiet >/dev/null

COMPUTE_SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud iam service-accounts describe "$COMPUTE_SERVICE_ACCOUNT" --project "$PROJECT_ID" >/dev/null
grant_project_role "$COMPUTE_SERVICE_ACCOUNT" roles/run.builder
gcloud iam service-accounts add-iam-policy-binding "$COMPUTE_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" --member "serviceAccount:$SIGNER_SERVICE_ACCOUNT" \
  --role roles/iam.serviceAccountUser --quiet >/dev/null

RELEASE_PROVIDER="$(gcloud iam workload-identity-pools providers describe "$RELEASE_PROVIDER_ID" \
  --workload-identity-pool "$POOL_ID" --location global --project "$PROJECT_ID" --format='value(name)')"
SIGNER_PROVIDER="$(gcloud iam workload-identity-pools providers describe "$SIGNER_PROVIDER_ID" \
  --workload-identity-pool "$POOL_ID" --location global --project "$PROJECT_ID" --format='value(name)')"
REVOCATION_PROVIDER="$(gcloud iam workload-identity-pools providers describe "$REVOCATION_PROVIDER_ID" \
  --workload-identity-pool "$POOL_ID" --location global --project "$PROJECT_ID" --format='value(name)')"

set_environment_variable "$PRODUCTION_ENVIRONMENT" GCP_PROJECT_ID "$PROJECT_ID"
set_environment_variable "$PRODUCTION_ENVIRONMENT" GCP_REGION "$REGION"
set_environment_variable "$PRODUCTION_ENVIRONMENT" LIATIR_RUNTIME_BOX_SIGNER_URL "$SIGNER_URL"
set_environment_variable "$PRODUCTION_ENVIRONMENT" GCP_WORKLOAD_IDENTITY_PROVIDER "$RELEASE_PROVIDER"
set_environment_variable "$PRODUCTION_ENVIRONMENT" GCP_REVOCATION_WORKLOAD_IDENTITY_PROVIDER "$REVOCATION_PROVIDER"
set_environment_variable "$PRODUCTION_ENVIRONMENT" GCP_RELEASE_SERVICE_ACCOUNT "$RELEASE_SERVICE_ACCOUNT"
set_environment_variable "$PRODUCTION_ENVIRONMENT" LIATIR_RUNTIME_BOX_REGISTRY https://models.liatir.com
set_environment_variable "$PRODUCTION_ENVIRONMENT" LIATIR_RUNTIME_BOX_BUCKET liatir-storage
set_environment_variable "$PRODUCTION_ENVIRONMENT" LIATIR_RUNTIME_BOX_PREFIX ai-runtime-boxes

set_environment_variable "$SIGNER_ENVIRONMENT" GCP_PROJECT_ID "$PROJECT_ID"
set_environment_variable "$SIGNER_ENVIRONMENT" GCP_REGION "$REGION"
set_environment_variable "$SIGNER_ENVIRONMENT" GCP_WORKLOAD_IDENTITY_PROVIDER "$SIGNER_PROVIDER"
set_environment_variable "$SIGNER_ENVIRONMENT" GCP_SIGNER_ADMIN_SERVICE_ACCOUNT "$SIGNER_SERVICE_ACCOUNT"
set_environment_variable "$SIGNER_ENVIRONMENT" GCP_SIGNER_BUILD_SERVICE_ACCOUNT "$COMPUTE_SERVICE_ACCOUNT"

assert_no_project_kms_role "$RELEASE_SERVICE_ACCOUNT"
assert_no_project_kms_role "$SIGNER_SERVICE_ACCOUNT"
assert_no_key_kms_role "$RELEASE_SERVICE_ACCOUNT"
assert_no_key_kms_role "$SIGNER_SERVICE_ACCOUNT"

echo "Runtime Box CI identities and protected Environment configuration are ready."
echo "Registry token was not rotated; pass --rotate-registry-token when rotation is intended."
