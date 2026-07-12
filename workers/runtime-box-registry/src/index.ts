/**
 * AI Runtime Box registry — the Cloudflare Worker that serves the control plane.
 *
 * It is the middle link of the distribution chain of runtime boxes:
 *   signer service (holds the KMS key, signs)  ->  this Worker (stores + serves)  ->  the app
 *   (`src-tauri/src/bridge/runtime_boxes.rs`, which verifies before installing anything).
 *
 * Two surfaces:
 *   - public GET routes, serving signed channel and revocation documents straight from R2;
 *   - admin PUT routes, which *promote* a new document (make it live).
 *
 * The Worker never signs anything and holds no private key. On promotion it re-verifies the
 * signature against the trusted keys in R2 and checks the document actually matches the route
 * it is being uploaded to, so a compromised admin token alone cannot publish a box: it can only
 * publish something the offline signer already approved.
 *
 * The types come from `liatir-core`, the shared contract — the same definitions the app is
 * built against, so the two ends cannot drift apart.
 */
import {
  isLiatirSignedRuntimeBoxDocument,
  type LiatirRuntimeBoxChannelManifest,
  type LiatirRuntimeBoxRevocationsManifest,
  type LiatirSignedRuntimeBoxDocument,
} from '../../../packages/liatir-core/src/runtime-box';

const MAX_CONTROL_DOCUMENT_BYTES = 1024 * 1024;
/** R2 object holding the Ed25519 public keys this registry accepts signatures from. */
const TRUSTED_KEYS_OBJECT = 'control/trusted-keys.json';
/**
 * Every URL segment used to build an R2 key must match this: lowercase, bounded length, and no
 * `/` or `.` sequences. That makes path traversal into another object impossible by construction.
 */
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

/** JSON response helper. `nosniff` is set everywhere so a response body is never re-interpreted. */
function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  return Response.json(body, { status, headers });
}

/** Returns the segment only if it is safe to interpolate into an object key, else null. */
function safeSegment(value: string): string | null {
  return SEGMENT_PATTERN.test(value) ? value : null;
}

/**
 * Namespaces every object under a configured prefix, so staging and production can share one
 * bucket without either being able to read or overwrite the other's documents.
 */
function objectKey(env: Env, key: string): string {
  const prefix = env.OBJECT_PREFIX.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${key}` : key;
}

/** Mirrors the app's URL rule: HTTPS only, with loopback HTTP tolerated for local testing. */
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

/**
 * Constant-time comparison of the admin token.
 *
 * Both sides are hashed first for two reasons: `timingSafeEqual` requires equal-length inputs,
 * and comparing fixed-size digests means the comparison time reveals nothing about the real
 * token's length either. A plain `===` would leak the shared secret one character at a time.
 */
async function timingSafeTokenMatch(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

/**
 * Reads a request body with a hard size cap. Checked twice, because `content-length` is a claim
 * by the client: the header lets us reject early, the real byte length is what actually enforces it.
 */
async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_CONTROL_DOCUMENT_BYTES) throw new Error('control_document_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CONTROL_DOCUMENT_BYTES) {
    throw new Error('control_document_too_large');
  }
  return JSON.parse(text);
}

/**
 * Loads the accepted signing keys from R2.
 *
 * Fails closed: a missing, malformed or empty key file yields an empty list, which makes every
 * signature unverifiable and so rejects every promotion. Malformed individual entries are
 * filtered out rather than trusted.
 */
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

/**
 * Verifies a signed document and returns its decoded payload, or null if it cannot be trusted.
 *
 * Same shape of check the desktop app performs: confirm the checksum, then accept the document
 * if any one signature verifies against a known key. Signatures naming an unknown key are
 * skipped, which is what lets a document signed by both an old and a new key validate during a
 * key rotation.
 */
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

/** Bearer-token gate on the admin routes. An unset `ADMIN_TOKEN` denies rather than allows. */
async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || !env.ADMIN_TOKEN) return false;
  return timingSafeTokenMatch(authorization.slice('Bearer '.length), env.ADMIN_TOKEN);
}

/**
 * Streams a stored document back to the client.
 *
 * These objects are public and self-authenticating — the signature inside them, not the
 * transport, is what makes them trustworthy — so they can be cached and served with open CORS.
 * Channels get a short TTL because a rollout percentage change should reach users quickly;
 * revocations are cached longer since they are appended to rarely.
 */
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

/**
 * Checks that a signed channel manifest belongs at the route it is being promoted to.
 *
 * The signature proves the document is authentic, not that it is being filed in the right place.
 * Without this, a genuinely signed manifest for one box/target could be uploaded to another
 * box's path and would be served to the wrong machines. Rebuilding the target slug from the
 * payload and comparing it to the URL segment closes that gap; the rollout percentages and
 * release URLs are sanity-checked at the same time.
 */
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
  // Must produce the same slug the app's `target_id()` builds, e.g. `macos-aarch64-metal`.
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

/**
 * Publishes a channel manifest, making a release live for everyone on that channel and target.
 *
 * Four gates, in order: admin token, size limit, signature, and route match. Only then is the
 * document written — and it is stored exactly as received (signature envelope and all), because
 * the app will verify that same envelope itself.
 */
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
    // Recorded alongside the object so a stored document can be identified without parsing it.
    customMetadata: { payloadSha256: input.payloadSha256 },
  });
  // Structured, one line per event: promotions are the audit trail of what went live and when.
  console.log(JSON.stringify({ event: 'runtime_box_channel_promoted', channel, boxId, target }));
  return json({ ok: true, key });
}

/**
 * Publishes the revocation list — the mechanism for pulling a bad box after it has shipped.
 *
 * Single fixed key: the list is replaced wholesale rather than appended to, so what is published
 * is always the complete, signed set of revocations.
 */
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
  /**
   * Router. Paths are matched by exact segment count and shape rather than by prefix, so an
   * unexpected path falls through to 404 instead of accidentally matching an admin route.
   */
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'liatir-runtime-box-registry', environment: env.ENVIRONMENT });
    }
    if (request.method === 'GET' && url.pathname === '/v1/revocations') {
      return serveObject(request, env, 'control/revocations.json');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    // GET /v1/channels/:channel/:boxId/:target — what the app calls to start an install.
    // Every segment is validated before it reaches an object key.
    if (request.method === 'GET' && parts.length === 5 && parts[0] === 'v1' && parts[1] === 'channels') {
      const channel = safeSegment(parts[2]);
      const boxId = safeSegment(parts[3]);
      const target = safeSegment(parts[4]);
      if (!channel || !boxId || !target) return json({ error: 'invalid_route' }, 400);
      return serveObject(request, env, `channels/${channel}/${boxId}/${target}.json`);
    }
    // PUT /v1/admin/channels/:channel/:boxId/:target — release promotion (admin only).
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
