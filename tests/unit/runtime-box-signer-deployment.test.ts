import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const deployScript = readFileSync(resolve('scripts/deploy-runtime-box-signer.sh'), 'utf8');

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
});
