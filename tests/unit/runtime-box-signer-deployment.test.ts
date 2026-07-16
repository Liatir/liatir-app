import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const deployScript = readFileSync(resolve('scripts/deploy-runtime-box-signer.sh'), 'utf8');
const configureScript = readFileSync(resolve('scripts/configure-runtime-box-ci.sh'), 'utf8');
const deploymentWorkflow = readFileSync(
  resolve('.github/workflows/runtime-box-signer-deploy.yml'),
  'utf8',
);

describe('Runtime Box signer deployment boundary', () => {
  it('keeps direct KMS access out of the GitHub deploy-only identity', () => {
    const deployOnlyBranch = deployScript.match(
      /if \[\[ "\$DEPLOY_ONLY" == "1" \]\]; then([\s\S]*?)\nelse/,
    )?.[1];

    expect(deployOnlyBranch).toBeDefined();
    expect(deployOnlyBranch).toContain('gcloud iam service-accounts describe');
    expect(deployOnlyBranch).not.toContain('gcloud kms');
  });

  it('retains direct key inspection only for manual administrative deployment', () => {
    const administrativeBranch = deployScript.match(
      /if \[\[ "\$DEPLOY_ONLY" == "1" \]\]; then[\s\S]*?\nelse([\s\S]*?)\nfi/,
    )?.[1];
    const postDeployAdministrativeBranch = deployScript.match(
      /if \[\[ "\$DEPLOY_ONLY" != "1" \]\]; then([\s\S]*?)\nfi/,
    )?.[1];

    expect(administrativeBranch).toContain('gcloud kms keys versions describe');
    expect(postDeployAdministrativeBranch).toContain('gcloud kms keys versions get-public-key');
  });

  it('pins the Cloud Run build identity and grants only the required act-as relationship', () => {
    expect(deployScript).toContain(
      '--build-service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SERVICE_ACCOUNT"',
    );
    expect(deploymentWorkflow).toContain(
      'LIATIR_SIGNER_BUILD_SERVICE_ACCOUNT: ${{ vars.GCP_SIGNER_BUILD_SERVICE_ACCOUNT }}',
    );
    expect(configureScript).toMatch(
      /add-iam-policy-binding "\$COMPUTE_SERVICE_ACCOUNT"[\s\S]*?"serviceAccount:\$SIGNER_SERVICE_ACCOUNT"[\s\S]*?roles\/iam\.serviceAccountUser/,
    );
  });
});
