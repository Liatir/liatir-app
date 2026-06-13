// encryption-utils.ts

// ==============================
// 🔒 Hash / Digest
// ==============================

async function digestHex(
  input: string,
  algorithm: "SHA-1" | "SHA-256" | "SHA-512"
): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest(algorithm, data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ==============================
// 🔐 HMAC (digest con chiave)
// ==============================

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(key);
  const msgData = enc.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Simple  32-bit hash for change detection.
 * Do NOT use for security-sensitive purposes.
 */
export function nonCryptographicHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  // convert to unsigned and hex
  return (hash >>> 0).toString(16);
}

export async function sha256(
  input: string,
  nonCryptographicFallback: boolean = true
): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    if (!nonCryptographicFallback) throw "crypto not found in this contex";
    console.warn(
      `[crypto not found] using unsafe non-cryptographic fallback, useful only as weak "checksum"`
    );
    return nonCryptographicHash(input);
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ==============================
// 📦 Base64
// ==============================

function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  const chunkSize = 0x8000; // 32 KB per evitare troppi argomenti a String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeBase64(base64: string): string {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ==============================
// 🔐 AES-GCM (reversibile)
// ==============================

async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

function generateRandomInitializationVector(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
}

async function aesGcmEncrypt(
  plaintext: string,
  key: CryptoKey,
  iv: BufferSource
): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  return new Uint8Array(ciphertext);
}

async function aesGcmDecrypt(
  ciphertext: BufferSource,
  key: CryptoKey,
  iv: BufferSource
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export const cryptoTools = {
  digest: {
    digestHex,
    sha256,
    hmacSha256Hex,
    nonCryptographicHash
  },
  base64: {
    encode: encodeBase64,
    decode: decodeBase64,
  },
  AES: {
    encode: aesGcmEncrypt,
    decode: aesGcmDecrypt,
    randomInitializationVector: generateRandomInitializationVector,
  },
};
