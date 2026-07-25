/**
 * Reference implementation of the scrollcase signed-document envelope.
 *
 * Signed documents carry their payload as exact base64-encoded JSON rather than canonicalized JSON.
 * That choice is deliberate: verifying a signature then means hashing bytes that were transmitted
 * verbatim, so Node, Rust, a Worker, and any future client agree without each maintaining a
 * canonical-JSON implementation — historically the richest source of cross-language signature bugs.
 *
 * The `kind` strings below are wire identifiers baked into published boxes, deployed registries, and
 * already-installed clients. They read `liatir.runtime-box.*` for historical reasons and are kept
 * verbatim: renaming them is a breaking format change, and would have to arrive with a new
 * `schemaVersion`, never as a silent edit.
 */

import { createHash } from 'node:crypto';

/** Format version carried by every document this contract describes. */
export const RUNTIME_BOX_SCHEMA_VERSION = 1;

/** The only payload encoding the format defines. */
export const PAYLOAD_ENCODING = 'base64-json-utf8';

/** The only signature algorithm the format defines. */
export const SIGNATURE_ALGORITHM = 'ed25519';

/** Wire `kind` discriminators, one per document the format defines. */
export const DOCUMENT_KINDS = Object.freeze({
  release: 'liatir.runtime-box.release',
  channel: 'liatir.runtime-box.channel',
  revocations: 'liatir.runtime-box.revocations',
});

/** Channels a box may be published to, ordered from least to most stable. */
export const CHANNELS = Object.freeze(['development', 'beta', 'stable']);

/**
 * Reports whether a value is a structurally valid signed envelope.
 *
 * This is a shape check, not a verification: it says the document is worth attempting to verify,
 * never that its signature is good. Callers must still verify the payload hash and at least one
 * signature against a trusted key before acting on the contents.
 */
export function isSignedRuntimeBoxDocument(value) {
  if (!value || typeof value !== 'object') return false;
  return value.schemaVersion === RUNTIME_BOX_SCHEMA_VERSION
    && value.payloadEncoding === PAYLOAD_ENCODING
    && typeof value.payloadBase64 === 'string'
    && typeof value.payloadSha256 === 'string'
    && Array.isArray(value.signatures)
    && value.signatures.length > 0
    && value.signatures.every((signature) => signature?.algorithm === SIGNATURE_ALGORITHM
      && typeof signature.keyId === 'string'
      && typeof signature.signatureBase64 === 'string');
}

/**
 * Decodes an envelope's payload without verifying any signature.
 *
 * Throws when the envelope is malformed or when the embedded payload hash does not match the bytes,
 * which catches a truncated or edited document before its contents are ever read.
 */
export function decodeDocumentPayload(document) {
  if (!isSignedRuntimeBoxDocument(document)) {
    throw new TypeError('Not a signed Runtime Box document');
  }
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== document.payloadSha256) {
    throw new Error('Signed Runtime Box payload hash does not match its bytes');
  }
  return JSON.parse(bytes.toString('utf8'));
}
