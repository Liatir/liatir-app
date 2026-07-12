import {
  isLiatirSignedRuntimeBoxDocument,
  type LiatirRuntimeBoxChannelManifest,
  type LiatirRuntimeBoxRevocationsManifest,
  type LiatirSignedRuntimeBoxDocument,
} from '../../../packages/liatir-core/src/runtime-box';

const MAX_CONTROL_DOCUMENT_BYTES = 1024 * 1024;
const TRUSTED_KEYS_OBJECT = 'control/trusted-keys.json';
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

interface TrustedSigningKey {
  algorithm: 'ed25519';
  keyId: string;
  publicKeyBase64: string;
}

interface TrustedSigningKeys {
  schemaVersion: 1;
  keys: TrustedSigningKey[];
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  return Response.json(body, { status, headers });
}

function safeSegment(value: string): string | null {
  return SEGMENT_PATTERN.test(value) ? value : null;
}

function objectKey(env: Env, key: string): string {
  const prefix = env.OBJECT_PREFIX.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${key}` : key;
}

function validReleaseManifestUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function timingSafeTokenMatch(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_CONTROL_DOCUMENT_BYTES) throw new Error('control_document_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CONTROL_DOCUMENT_BYTES) {
    throw new Error('control_document_too_large');
  }
  return JSON.parse(text);
}

async function trustedKeys(env: Env): Promise<TrustedSigningKey[]> {
  const object = await env.RUNTIME_BOXES.get(objectKey(env, TRUSTED_KEYS_OBJECT));
  if (!object) return [];
  const document = await object.json<TrustedSigningKeys>();
  if (document.schemaVersion !== 1 || !Array.isArray(document.keys)) return [];
  return document.keys.filter((key) =>
    key.algorithm === 'ed25519'
    && typeof key.keyId === 'string'
    && typeof key.publicKeyBase64 === 'string'
  );
}

async function verifySignedDocument(
  env: Env,
  document: LiatirSignedRuntimeBoxDocument,
): Promise<Record<string, unknown> | null> {
  const payload = bytesFromBase64(document.payloadBase64);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  if (hex(digest) !== document.payloadSha256) return null;
  const keys = await trustedKeys(env);
  for (const signature of document.signatures) {
    const trusted = keys.find((key) => key.keyId === signature.keyId);
    if (!trusted) continue;
    const publicKey = await crypto.subtle.importKey(
      'raw',
      bytesFromBase64(trusted.publicKeyBase64),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    if (await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      bytesFromBase64(signature.signatureBase64),
      payload,
    )) {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    }
  }
  return null;
}

async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || !env.ADMIN_TOKEN) return false;
  return timingSafeTokenMatch(authorization.slice('Bearer '.length), env.ADMIN_TOKEN);
}

async function serveObject(request: Request, env: Env, key: string): Promise<Response> {
  const object = await env.RUNTIME_BOXES.get(objectKey(env, key));
  if (!object) return json({ error: 'not_found' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', key.startsWith('channels/') ? 'public, max-age=60' : 'public, max-age=300');
  headers.set('access-control-allow-origin', '*');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

function validateChannelRoute(
  payload: Record<string, unknown>,
  channel: string,
  boxId: string,
  target: string,
): payload is Record<string, unknown> & LiatirRuntimeBoxChannelManifest {
  if (payload.kind !== 'liatir.runtime-box.channel') return false;
  if (payload.channel !== channel || payload.boxId !== boxId) return false;
  if (!payload.target || typeof payload.target !== 'object') return false;
  const targetRecord = payload.target as Record<string, unknown>;
  if (typeof targetRecord.platform !== 'string'
    || typeof targetRecord.arch !== 'string'
    || typeof targetRecord.accelerator !== 'string') return false;
  if (!Array.isArray(payload.releases) || payload.releases.length === 0) return false;
  const routeTarget = `${targetRecord.platform}-${targetRecord.arch}-${targetRecord.accelerator}${
    typeof targetRecord.cudaVersion === 'string' ? `-cuda${targetRecord.cudaVersion}` : ''
  }`;
  return routeTarget === target
    && payload.releases.every((release: unknown) =>
      Boolean(release)
      && typeof release === 'object'
      && Number.isInteger((release as Record<string, unknown>).rolloutPercentage)
      && Number((release as Record<string, unknown>).rolloutPercentage) >= 1
      && Number((release as Record<string, unknown>).rolloutPercentage) <= 100
      && validReleaseManifestUrl((release as Record<string, unknown>).releaseManifestUrl)
    );
}

function isRevocationsManifest(
  payload: Record<string, unknown>,
): payload is Record<string, unknown> & LiatirRuntimeBoxRevocationsManifest {
  return payload.kind === 'liatir.runtime-box.revocations'
    && payload.schemaVersion === 1
    && typeof payload.updatedAt === 'string'
    && Array.isArray(payload.revocations);
}

async function promoteChannel(
  request: Request,
  env: Env,
  channel: string,
  boxId: string,
  target: string,
): Promise<Response> {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  let input: unknown;
  try {
    input = await readBoundedJson(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid_json' }, 400);
  }
  if (!isLiatirSignedRuntimeBoxDocument(input)) return json({ error: 'invalid_signed_document' }, 400);
  const payload = await verifySignedDocument(env, input);
  if (!payload) return json({ error: 'untrusted_signature' }, 400);
  if (!validateChannelRoute(payload, channel, boxId, target)) return json({ error: 'channel_route_mismatch' }, 400);
  const key = `channels/${channel}/${boxId}/${target}.json`;
  const body = `${JSON.stringify(input, null, 2)}\n`;
  await env.RUNTIME_BOXES.put(objectKey(env, key), body, {
    httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=60' },
    customMetadata: { payloadSha256: input.payloadSha256 },
  });
  console.log(JSON.stringify({ event: 'runtime_box_channel_promoted', channel, boxId, target }));
  return json({ ok: true, key });
}

async function promoteRevocations(request: Request, env: Env): Promise<Response> {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  let input: unknown;
  try {
    input = await readBoundedJson(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid_json' }, 400);
  }
  if (!isLiatirSignedRuntimeBoxDocument(input)) return json({ error: 'invalid_signed_document' }, 400);
  const payload = await verifySignedDocument(env, input);
  if (!payload || !isRevocationsManifest(payload)) return json({ error: 'invalid_revocations' }, 400);
  await env.RUNTIME_BOXES.put(objectKey(env, 'control/revocations.json'), `${JSON.stringify(input, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' },
    customMetadata: { payloadSha256: input.payloadSha256 },
  });
  console.log(JSON.stringify({ event: 'runtime_box_revocations_promoted', count: payload.revocations.length }));
  return json({ ok: true, key: 'control/revocations.json' });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'liatir-runtime-box-registry', environment: env.ENVIRONMENT });
    }
    if (request.method === 'GET' && url.pathname === '/v1/revocations') {
      return serveObject(request, env, 'control/revocations.json');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && parts.length === 5 && parts[0] === 'v1' && parts[1] === 'channels') {
      const channel = safeSegment(parts[2]);
      const boxId = safeSegment(parts[3]);
      const target = safeSegment(parts[4]);
      if (!channel || !boxId || !target) return json({ error: 'invalid_route' }, 400);
      return serveObject(request, env, `channels/${channel}/${boxId}/${target}.json`);
    }
    if (request.method === 'PUT' && parts.length === 6 && parts[0] === 'v1' && parts[1] === 'admin' && parts[2] === 'channels') {
      const channel = safeSegment(parts[3]);
      const boxId = safeSegment(parts[4]);
      const target = safeSegment(parts[5]);
      if (!channel || !boxId || !target) return json({ error: 'invalid_route' }, 400);
      return promoteChannel(request, env, channel, boxId, target);
    }
    if (request.method === 'PUT' && url.pathname === '/v1/admin/revocations') {
      return promoteRevocations(request, env);
    }
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
