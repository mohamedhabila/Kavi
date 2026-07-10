import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';

export const CryptoDigestAlgorithm = Object.freeze({
  SHA256: 'SHA-256',
});

export async function digestStringAsync(algorithm: string, value: string): Promise<string> {
  if (algorithm !== CryptoDigestAlgorithm.SHA256) {
    throw new Error(`Unsupported benchmark digest algorithm: ${algorithm}`);
  }
  if (typeof value !== 'string') {
    throw new TypeError('Benchmark digest input must be a string.');
  }
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomUUID(): string {
  return nodeRandomUUID();
}
