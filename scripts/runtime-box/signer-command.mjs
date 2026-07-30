#!/usr/bin/env node

/**
 * Liatir's private-signer adapter for Scrollcase.
 *
 * Scrollcase deliberately knows only an executable contract: payload bytes on stdin and one signed
 * JSON envelope on stdout. This module owns the Liatir-specific OIDC and Cloud Run details. It never
 * prints credentials, and Scrollcase independently rejects payload substitution or an invalid
 * signature before accepting the returned document.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, runResult as defaultRunResult } from './process.mjs';

function parseArgs(values) {
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) fail(`Unexpected signer argument: ${value}`);
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else {
      fail(`Signer argument --${name} requires a value.`);
    }
  }
  return flags;
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Reads the exact signer payload from a portable Node stream, including Node 26+. */
export async function readSignerPayload(input = process.stdin) {
  const chunks = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Quotes one argument for Scrollcase's shell-free external-command parser. */
export function quoteExternalCommandArgument(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Builds the exact command Scrollcase invokes for Liatir's private signing path. */
export function liatirSignerCommand({
  signerUrl,
  audience = null,
  nodeExecutable = process.execPath,
  signerScript = fileURLToPath(import.meta.url),
}) {
  if (!signerUrl) fail('A signer URL is required to build the Liatir signer command.');
  const args = [nodeExecutable, signerScript, '--signer', signerUrl];
  if (audience) args.push('--audience', audience);
  return args.map(quoteExternalCommandArgument).join(' ');
}

/** Obtains one short-lived audience-bound identity token without exposing it to output. */
export function signerIdentityToken({
  identityToken = process.env.LIATIR_RUNTIME_BOX_SIGNER_ID_TOKEN,
  audience = null,
  runResult = defaultRunResult,
} = {}) {
  const injected = String(identityToken || '').trim();
  if (injected) return injected;
  const args = audience
    ? ['auth', 'print-identity-token', `--audiences=${audience}`]
    : ['auth', 'print-identity-token'];
  const result = runResult('gcloud', args, { capture: true });
  if (result.error) fail(`gcloud failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`gcloud identity token failed with status ${result.status}.`);
  }
  const token = String(result.stdout || '').trim();
  if (!token) fail('gcloud returned an empty identity token.');
  return token;
}

/**
 * Calls the existing private signer with the exact payload received from Scrollcase.
 *
 * The returned envelope is intentionally not trusted here. Scrollcase checks both the echoed bytes
 * and the signature against the caller-selected public trust file.
 */
export async function signPayloadWithPrivateService(payloadBytes, {
  signerUrl,
  audience = null,
  identityToken = process.env.LIATIR_RUNTIME_BOX_SIGNER_ID_TOKEN,
  fetchImpl = fetch,
  runResult = defaultRunResult,
} = {}) {
  const signer = String(signerUrl || '').replace(/\/$/, '');
  if (!signer) fail('Liatir signer command requires --signer <private-cloud-run-url>.');
  const token = signerIdentityToken({ identityToken, audience, runResult });
  const request = {
    payloadBase64: Buffer.from(payloadBytes).toString('base64'),
    payloadSha256: sha256Bytes(payloadBytes),
  };
  const response = await fetchImpl(`${signer}/v1/sign`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    fail(`Private Runtime Box signing failed (${response.status}).`);
  }
  try {
    return await response.json();
  } catch (error) {
    fail(`Private Runtime Box signer returned malformed JSON: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const payloadBytes = await readSignerPayload();
  const document = await signPayloadWithPrivateService(payloadBytes, {
    signerUrl: flags.get('signer') || process.env.LIATIR_RUNTIME_BOX_SIGNER_URL,
    audience: flags.get('audience') || process.env.LIATIR_RUNTIME_BOX_SIGNER_AUDIENCE || null,
  });
  process.stdout.write(`${JSON.stringify(document)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`liatir-signer: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
