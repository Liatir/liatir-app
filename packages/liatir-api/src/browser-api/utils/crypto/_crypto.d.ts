declare function digestHex(input: string, algorithm: "SHA-1" | "SHA-256" | "SHA-512"): Promise<string>;
declare function hmacSha256Hex(key: string, message: string): Promise<string>;
/**
 * Simple  32-bit hash for change detection.
 * Do NOT use for security-sensitive purposes.
 */
export declare function nonCryptographicHash(input: string): string;
export declare function sha256(input: string, nonCryptographicFallback?: boolean): Promise<string>;
declare function encodeBase64(input: string): string;
declare function decodeBase64(base64: string): string;
declare function generateRandomInitializationVector(): Uint8Array;
declare function aesGcmEncrypt(plaintext: string, key: CryptoKey, iv: BufferSource): Promise<Uint8Array>;
declare function aesGcmDecrypt(ciphertext: BufferSource, key: CryptoKey, iv: BufferSource): Promise<string>;
export declare const cryptoTools: {
    digest: {
        digestHex: typeof digestHex;
        sha256: typeof sha256;
        hmacSha256Hex: typeof hmacSha256Hex;
        nonCryptographicHash: typeof nonCryptographicHash;
    };
    base64: {
        encode: typeof encodeBase64;
        decode: typeof decodeBase64;
    };
    AES: {
        encode: typeof aesGcmEncrypt;
        decode: typeof aesGcmDecrypt;
        randomInitializationVector: typeof generateRandomInitializationVector;
    };
};
export {};
