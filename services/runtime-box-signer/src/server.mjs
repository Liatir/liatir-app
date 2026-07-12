import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { validateSigningPayload } from './policy.mjs';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 128 * 1024;
const policy = JSON.parse(await readFile(new URL('../policy.json', import.meta.url), 'utf8'));
const keyVersion = process.env.KMS_KEY_VERSION;
const keyId = process.env.RUNTIME_BOX_KEY_ID;

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

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

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0x82f63b78 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function accessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!response.ok) throw new Error(`metadata token request failed with HTTP ${response.status}`);
  return (await response.json()).access_token;
}

async function kmsSign(payloadBytes) {
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

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, { ok: true, service: 'liatir-runtime-box-signer' });
    }
    if (request.method !== 'POST' || request.url !== '/v1/sign') return json(response, 404, { error: 'not_found' });
    const input = JSON.parse((await bodyBytes(request)).toString('utf8'));
    const payloadBytes = Buffer.from(input.payloadBase64 ?? '', 'base64');
    if (payloadBytes.length === 0 || payloadBytes.toString('base64') !== input.payloadBase64) throw new Error('invalid canonical payload encoding');
    if (payloadBytes.length > MAX_PAYLOAD_BYTES) throw new Error('canonical payload exceeds the KMS signing limit');
    const payloadSha256 = createHash('sha256').update(payloadBytes).digest('hex');
    if (payloadSha256 !== input.payloadSha256) throw new Error('payload SHA-256 mismatch');
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    validateSigningPayload(policy, payload);
    const signatureBase64 = await kmsSign(payloadBytes);
    console.log(JSON.stringify({ event: 'runtime_box_document_signed', kind: payload.kind, boxId: payload.boxId ?? null, payloadSha256 }));
    return json(response, 200, {
      schemaVersion: 1,
      payloadEncoding: 'base64-json-utf8',
      payloadBase64: input.payloadBase64,
      payloadSha256,
      signatures: [{ algorithm: 'ed25519', keyId, signatureBase64 }],
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'runtime_box_signing_rejected', message: error instanceof Error ? error.message : String(error) }));
    return json(response, 400, { error: 'signing_rejected', message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
