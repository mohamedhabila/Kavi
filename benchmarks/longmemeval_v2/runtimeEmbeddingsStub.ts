import type { EmbeddingConfig } from '../../src/types/memory';

export async function getEmbeddingCached(
  _text: string,
  _config: EmbeddingConfig,
): Promise<number[]> {
  throw new Error('Kavi LongMemEval runtime is configured for text-only SQLite memory search.');
}
