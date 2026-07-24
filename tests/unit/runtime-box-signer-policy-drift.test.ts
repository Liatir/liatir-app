import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { verifyDeployedSignerPolicy } from '../../scripts/runtime-box-ci.mjs';
import { runtimeBoxPolicyFingerprint } from '../../services/runtime-box-signer/src/policy.mjs';

// The exact committed policy the deployed signer is supposed to be serving.
const policyText = readFileSync(
  fileURLToPath(new URL('../../services/runtime-box-signer/policy.json', import.meta.url)),
  'utf8',
);
const committedFingerprint = runtimeBoxPolicyFingerprint(JSON.parse(policyText));

/** A fake `/health` returning a chosen fingerprint, so the drift check is tested without GCP. */
function healthFetch(body: unknown, ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;
}

describe('deployed signer policy drift check', () => {
  it('passes when the deployed fingerprint matches the committed policy', async () => {
    const result = await verifyDeployedSignerPolicy({
      signerUrl: 'https://signer.example/',
      identityToken: 'token',
      policyText,
      fetchImpl: healthFetch({ ok: true, policyFingerprint: committedFingerprint }),
    });
    expect(result.fingerprint).toBe(committedFingerprint);
  });

  it('fails with an actionable message when the deployed policy is stale', async () => {
    await expect(verifyDeployedSignerPolicy({
      signerUrl: 'https://signer.example',
      identityToken: 'token',
      policyText,
      fetchImpl: healthFetch({ ok: true, policyFingerprint: 'a'.repeat(64) }),
    })).rejects.toThrow(/Deployed signer policy is stale.*runtime-box:signer:deploy/s);
  });

  it('fails when the deployed signer reports no fingerprint (older revision)', async () => {
    await expect(verifyDeployedSignerPolicy({
      signerUrl: 'https://signer.example',
      identityToken: 'token',
      policyText,
      fetchImpl: healthFetch({ ok: true }),
    })).rejects.toThrow(/does not report a policy fingerprint/);
  });

  it('surfaces a non-200 health response instead of silently passing', async () => {
    await expect(verifyDeployedSignerPolicy({
      signerUrl: 'https://signer.example',
      identityToken: 'token',
      policyText,
      fetchImpl: healthFetch({ error: 'forbidden' }, false, 403),
    })).rejects.toThrow(/health check failed \(403\)/);
  });

  it('requires both a signer URL and an identity token', async () => {
    await expect(verifyDeployedSignerPolicy({
      signerUrl: '',
      identityToken: 'token',
      policyText,
      fetchImpl: healthFetch({}),
    })).rejects.toThrow(/signer URL is required/);
    await expect(verifyDeployedSignerPolicy({
      signerUrl: 'https://signer.example',
      identityToken: '',
      policyText,
      fetchImpl: healthFetch({}),
    })).rejects.toThrow(/identity token is required/);
  });

  it('is wired into the release workflow before the paid build', () => {
    const release = readFileSync(
      fileURLToPath(new URL('../../.github/workflows/runtime-box-release.yml', import.meta.url)),
      'utf8',
    );
    expect(release).toContain('verify-signer-policy');
    // It must run before signing, so a stale policy fails fast rather than after the build.
    expect(release.indexOf('verify-signer-policy'))
      .toBeLessThan(release.indexOf('Build with the private KMS signer'));
  });
});
