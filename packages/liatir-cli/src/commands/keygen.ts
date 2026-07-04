import {
  defaultKeyPath,
  generateKeypair,
  loadSigningKey,
  publicKeyFingerprint,
  writePrivateKey,
} from "../signing.js";
import * as crypto from "crypto";

function usage(): string {
  return `liatir keygen — create an Ed25519 signing key for .lia plugins

Usage:
  liatir keygen                 Create the default signing key if missing
  liatir keygen --path <file>   Write the key to a specific path
  liatir keygen --force         Replace an existing key (old signatures stop verifying)

The private key is written with owner-only permissions and never leaves your
machine. Signed plugins carry only the public key. Keep the private key safe:
losing it means you can no longer sign updates that verify against it.
`;
}

/** Raw 32-byte Ed25519 public key from a loaded private key. */
function rawPublicKey(privateKey: crypto.KeyObject): Buffer {
  const jwk = crypto.createPublicKey(privateKey).export({ format: "jwk" }) as { x?: string };
  return Buffer.from(jwk?.x ?? "", "base64url");
}

export async function keygen(args: string[] = []): Promise<void> {
  let keyPath = defaultKeyPath();
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--path") {
      const value = args[i + 1];
      if (!value) throw new Error("Missing value after --path.");
      keyPath = value;
      i += 1;
    } else if (arg.startsWith("--path=")) {
      keyPath = arg.slice("--path=".length);
    } else {
      throw new Error(`Unknown option "${arg}".`);
    }
  }

  const existing = await loadSigningKey(keyPath).catch(() => null);
  if (existing && !force) {
    console.log(
      `A signing key already exists at ${keyPath}\n` +
      `  fingerprint: ${publicKeyFingerprint(rawPublicKey(existing))}\n\n` +
      `Use --force to replace it (existing signatures will stop verifying).`,
    );
    return;
  }

  const keypair = generateKeypair();
  if (existing && force) {
    // wx would refuse to overwrite; the caller explicitly asked to replace.
    const { rm } = await import("fs/promises");
    await rm(keyPath, { force: true });
  }
  await writePrivateKey(keyPath, keypair.privateKeyPem);

  console.log(
    `Created Ed25519 signing key at ${keyPath}\n` +
    `  fingerprint: ${keypair.fingerprint}\n\n` +
    `\`liatir build\` now signs your plugin automatically. Share the plugin, not the key.`,
  );
}
