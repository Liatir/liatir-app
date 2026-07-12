#!/usr/bin/env node

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const signer = String(process.argv[2] ?? process.env.LIATIR_RUNTIME_BOX_SIGNER_URL ?? '').replace(/\/$/, '');
if (!signer) throw new Error('Pass the private Cloud Run signer URL as the first argument.');

const tokenResult = spawnSync('gcloud', ['auth', 'print-identity-token'], { encoding: 'utf8' });
if (tokenResult.status !== 0) throw new Error(`Cannot obtain Google identity token: ${tokenResult.stderr}`);

const sha = 'a'.repeat(64);
const payload = {
  schemaVersion: 1,
  kind: 'liatir.runtime-box.release',
  boxId: 'geneformer-v1-10m',
  modelId: 'ctheodoris-geneformer-v1-10m',
  runtimeId: 'single-cell-foundation-geneformer-v1-10m',
  version: '0.0.0-signer-smoke',
  target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
  compatibility: { minLiatirVersion: '0.2.1', minMacosVersion: '13.0', minRamGb: 8 },
  archive: {
    format: 'zip',
    url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/geneformer-v1-10m/0.0.0-signer-smoke/macos-aarch64-metal/${sha}.zip`,
    sha256: sha,
    sizeBytes: 1,
  },
  pythonEntryPoint: 'venv/bin/python',
  modelCacheSubdir: 'model-cache/geneformer-v1-10m',
  selfTest: { pythonImports: ['torch'], timeoutSeconds: 180 },
  provenance: {
    recipeId: 'geneformer-v1-10m-macos-arm64-metal',
    recipeVersion: '1.0.0',
    builderRevision: 'signer-smoke',
    sourceTreeDirty: false,
    sourceRevision: 'signer-smoke',
    pythonVersion: '3.11.9',
    uvVersion: '0.11.28',
    dependencyLockSha256: 'b'.repeat(64),
    builtAt: new Date().toISOString(),
  },
};
const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
const payloadSha256 = createHash('sha256').update(payloadBytes).digest('hex');
const response = await fetch(`${signer}/v1/sign`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${tokenResult.stdout.trim()}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ payloadBase64: payloadBytes.toString('base64'), payloadSha256 }),
});
if (!response.ok) throw new Error(`Signer returned HTTP ${response.status}: ${await response.text()}`);
const document = await response.json();
if (document.payloadSha256 !== payloadSha256 || document.payloadBase64 !== payloadBytes.toString('base64')) {
  throw new Error('Signer changed the submitted payload.');
}
const trust = JSON.parse(await readFile(resolve('runtime-boxes/trust/production-public.json'), 'utf8'));
const signature = document.signatures?.find((candidate) => candidate.keyId === 'liatir-runtime-box-kms-2026');
const key = trust.keys?.find((candidate) => candidate.keyId === signature?.keyId);
if (!key || !verify(null, payloadBytes, createPublicKey(key.publicKeyPem), Buffer.from(signature.signatureBase64, 'base64'))) {
  throw new Error('KMS signature did not verify against the embedded production public key.');
}
console.log(`Verified private Runtime Box signer and KMS key ${key.keyId}.`);
