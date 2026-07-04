import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Ed25519 signing for `.lia` bundles. Signing happens here in the CLI; the
 * desktop app verifies with ed25519-dalek (see bridge/lia_plugins.rs). The
 * signed digest is derived identically on both sides so a signed bundle whose
 * content changed after signing fails verification (tamper-evidence).
 *
 * Uses Node's built-in `crypto` (Ed25519 is native) — no npm dependency.
 */

const SIG_ENTRY_ALG = "_sig_alg";
const SIG_ENTRY_PUBKEY = "_pubkey";
const SIG_ENTRY_SIGNATURE = "_signature";
const SIG_ALG = "ed25519";

const SIG_META_ENTRIES = new Set([SIG_ENTRY_ALG, SIG_ENTRY_PUBKEY, SIG_ENTRY_SIGNATURE]);

export interface BundleEntry {
  name: string;
  content: Buffer;
}

export interface SigningEntry {
  name: string;
  content: Buffer;
}

/** Default location of the developer's signing key. */
export function defaultKeyPath(): string {
  return process.env["LIATIR_SIGNING_KEY"]
    ?? path.join(os.homedir(), ".liatir", "keys", "signing-key.pem");
}

/**
 * Canonical digest, kept byte-for-byte in sync with `bundle_signing_digest` in
 * the Rust verifier: for every entry except the signature-meta ones, sorted by
 * name, append `"{name}\n{sha256hex(content)}\n"`, then SHA-256 the whole.
 */
export function bundleSigningDigest(entries: BundleEntry[]): Buffer {
  const rows = entries
    .filter((entry) => !SIG_META_ENTRIES.has(entry.name) && !entry.name.endsWith("/"))
    .map((entry) => ({
      name: entry.name,
      contentHash: crypto.createHash("sha256").update(entry.content).digest("hex"),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const outer = crypto.createHash("sha256");
  for (const row of rows) {
    outer.update(row.name, "utf8");
    outer.update("\n");
    outer.update(row.contentHash, "utf8");
    outer.update("\n");
  }
  return outer.digest();
}

/** Raw 32-byte Ed25519 public key for a private key object. */
function rawPublicKey(privateKey: crypto.KeyObject): Buffer {
  const jwk = crypto.createPublicKey(privateKey).export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("Signing key is not an Ed25519 key.");
  return Buffer.from(jwk.x, "base64url");
}

/**
 * Load the signing key from `keyPath`, or return null if it does not exist.
 * A present-but-invalid key throws — a misconfigured key must not silently
 * produce an unsigned bundle.
 */
export async function loadSigningKey(keyPath: string): Promise<crypto.KeyObject | null> {
  let pem: string;
  try {
    pem = await fs.readFile(keyPath, "utf8");
  } catch {
    return null;
  }
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Signing key at ${keyPath} is not an Ed25519 key.`);
  }
  return key;
}

/** Produce the three signature-meta zip entries for a set of bundle entries. */
export function buildSignatureEntries(
  entries: BundleEntry[],
  privateKey: crypto.KeyObject,
): { entries: SigningEntry[]; fingerprint: string } {
  const digest = bundleSigningDigest(entries);
  const signature = crypto.sign(null, digest, privateKey); // raw 64-byte Ed25519 sig
  const publicKey = rawPublicKey(privateKey);
  return {
    entries: [
      { name: SIG_ENTRY_ALG, content: Buffer.from(SIG_ALG, "utf8") },
      { name: SIG_ENTRY_PUBKEY, content: Buffer.from(publicKey.toString("base64"), "utf8") },
      { name: SIG_ENTRY_SIGNATURE, content: Buffer.from(signature.toString("base64"), "utf8") },
    ],
    fingerprint: publicKeyFingerprint(publicKey),
  };
}

/** Short, human-readable fingerprint of a raw public key. */
export function publicKeyFingerprint(publicKeyRaw: Buffer): string {
  const hash = crypto.createHash("sha256").update(publicKeyRaw).digest("hex");
  return hash.slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");
}

export interface GeneratedKeypair {
  privateKeyPem: string;
  publicKeyRaw: Buffer;
  fingerprint: string;
}

/** Generate a fresh Ed25519 keypair. */
export function generateKeypair(): GeneratedKeypair {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyRaw = rawPublicKey(privateKey);
  return { privateKeyPem, publicKeyRaw, fingerprint: publicKeyFingerprint(publicKeyRaw) };
}

/** Write a private key to disk with owner-only permissions, never overwriting. */
export async function writePrivateKey(keyPath: string, privateKeyPem: string): Promise<void> {
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  // wx: fail if it already exists — never clobber an existing signing key.
  await fs.writeFile(keyPath, privateKeyPem, { mode: 0o600, flag: "wx" });
}
