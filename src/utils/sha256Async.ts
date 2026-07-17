import * as Crypto from 'expo-crypto';

const SHA256_BYTE_LENGTH = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hashes the exact UTF-8 bytes of a JavaScript string.
 *
 * The byte-oriented Expo API is intentional: native string bridges may treat
 * embedded NUL code points as terminators, while durable identities and user
 * content must be hashed without truncation.
 */
export async function sha256HexUtf8Async(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, input);
  const bytes = new Uint8Array(digest);
  if (bytes.byteLength !== SHA256_BYTE_LENGTH) {
    throw new Error('sha256_digest_length_invalid');
  }
  return bytesToHex(bytes);
}
