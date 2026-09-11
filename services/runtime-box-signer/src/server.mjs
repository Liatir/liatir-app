/**
 * AI Runtime Box signing service.
 *
 * The one place that can turn a manifest into a *trusted* document. It is the first link of the
 * chain: this service signs, the Cloudflare Worker stores and serves, the desktop app verifies.
 *
 * The private key never exists here. Signing is delegated to Google Cloud KMS, which holds the
 * key material and only ever returns signatures, so compromising this process does not leak the
 * key — it only grants the ability to ask KMS to sign, which the policy below constrains.
 *
 * Every request is checked against `policy.json` before it is signed. That is the substantive
 * guard: it is what stops a caller with access to this service from signing an arbitrary
 * document (for instance a release pointing at an attacker-controlled archive URL).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { runtimeBoxPolicyFingerprint, validateSigningPayload } from './policy.mjs';

/** KMS asymmetricSign takes at most 64 KiB of data; control documents are far smaller anyway. */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** The JSON envelope carrying that payload is allowed to be somewhat larger. */
const MAX_BODY_BYTES = 128 * 1024;
// Loaded once at startup: the policy is part of the deployment, not something a request can vary.
const policy = JSON.parse(await readFile(new URL('../policy.json', import.meta.url), 'utf8'));
// A fingerprint of the *deployed* policy, exposed on /health so a release can detect before it
// spends a run that the live service is serving a policy older than the committed one.
const policyFingerprint = runtimeBoxPolicyFingerprint(policy);
/** Fully-qualified KMS key *version* — pinning the version, not just the key, matters below. */
const keyVersion = process.env.KMS_KEY_VERSION;
/** The key ID as it appears in the signature, matching an entry in the clients' trust list. */
const keyId = process.env.RUNTIME_BOX_KEY_ID;

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

/** Buffers the request body, aborting as soon as the cap is passed rather than after the fact. */
async function bodyBytes(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * CRC32C (Castagnoli) — the checksum Cloud KMS uses to detect data corrupted in transit.
 *
 * Implemented here because Node has no built-in CRC32C. Note the polynomial (0x82f63b78) is the
 * reflected Castagnoli one, which is what makes this CRC32C rather than the more common CRC32.
 */
function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0x82f63b78 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Fetches a short-lived OAuth token from the GCE metadata server, using the service account the
 * process runs as. No credentials are stored or configured anywhere — the identity comes from
 * the runtime environment, so there is no key file that could be copied out.
 */
async function accessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!response.ok) throw new Error(`metadata token request failed with HTTP ${response.status}`);
  return (await response.json()).access_token;
}

/**
 * Asks Cloud KMS to sign the exact payload bytes and returns the base64 signature.
 *
 * The checksums are the point of the extra bookkeeping. A signature over *corrupted* data would
 * still be a valid signature — clients would accept it, and the box would be broken but trusted.
 * So the round trip is verified in both directions:
 *   - `dataCrc32c` is sent, and KMS confirms via `verifiedDataCrc32c` that it signed what we sent;
 *   - `signatureCrc32c` is recomputed locally to confirm the signature came back intact;
 *   - `result.name` must equal the requested key version, proving it was signed by the key we
 *     intended and not some other version of it.
 * Any mismatch aborts rather than emitting a document that cannot be trusted.
 */
async function kmsSign(payloadBytes) {
  // Refuse to run half-configured: silently signing with the wrong identity would be worse.
  if (!keyVersion || !keyId) throw new Error('signer key configuration is missing');
  const dataCrc32c = crc32c(payloadBytes);
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ data: payloadBytes.toString('base64'), dataCrc32c: String(dataCrc32c) }),
  });
  if (!response.ok) throw new Error(`KMS signing failed with HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json();
  if (result.name !== keyVersion || result.verifiedDataCrc32c !== true) throw new Error('KMS did not verify the requested key version and payload checksum');
  const signature = Buffer.from(result.signature, 'base64');
  if (crc32c(signature) !== Number(result.signatureCrc32c)) throw new Error('KMS signature checksum mismatch');
  return result.signature;
}

/**
 * `POST /v1/sign` — validate a canonical payload, then have KMS sign it.
 *
 * Returns the complete signed envelope, in exactly the shape the Worker stores and the app
 * verifies. Every failure funnels into one `catch`: the response is always a generic
 * `signing_rejected`, and the detail goes to the logs.
 */
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, { ok: true, service: 'liatir-runtime-box-signer', policyFingerprint });
    }
    if (request.method !== 'POST' || request.url !== '/v1/sign') return json(response, 404, { error: 'not_found' });
    const input = JSON.parse((await bodyBytes(request)).toString('utf8'));
    const payloadBytes = Buffer.from(input.payloadBase64 ?? '', 'base64');
    // Re-encoding must reproduce the input exactly. Base64 decoding is lenient — several encodings
    // decode to the same bytes — so without this round-trip the bytes that get signed could differ
    // from the string the client keeps and later publishes, and the signature would not verify.
    if (payloadBytes.length === 0 || payloadBytes.toString('base64') !== input.payloadBase64) throw new Error('invalid canonical payload encoding');
    if (payloadBytes.length > MAX_PAYLOAD_BYTES) throw new Error('canonical payload exceeds the KMS signing limit');
    // The caller states what it thinks it is submitting; signing something else would be a silent
    // substitution, so the digest is recomputed and compared.
    const payloadSha256 = createHash('sha256').update(payloadBytes).digest('hex');
    if (payloadSha256 !== input.payloadSha256) throw new Error('payload SHA-256 mismatch');
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    // The real gate: only documents the deployment policy allows ever reach the key.
    validateSigningPayload(policy, payload);
    const signatureBase64 = await kmsSign(payloadBytes);
    // One structured line per signature: this is the audit record of everything ever signed.
    console.log(JSON.stringify({ event: 'runtime_box_document_signed', kind: payload.kind, boxId: payload.boxId ?? null, payloadSha256 }));
    return json(response, 200, {
      schemaVersion: 3,
      payloadEncoding: 'base64-json-utf8',
      // Echoed back verbatim, not re-encoded: this is the exact string the signature covers.
      payloadBase64: input.payloadBase64,
      payloadSha256,
      signatures: [{ algorithm: 'ed25519', keyId, signatureBase64 }],
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'runtime_box_signing_rejected', message: error instanceof Error ? error.message : String(error) }));
    return json(response, 400, { error: 'signing_rejected', message: error instanceof Error ? error.message : String(error) });
  }
});

// Binds to all interfaces on the port the platform assigns (Cloud Run convention).
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
