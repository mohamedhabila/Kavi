import type { EmbeddingConfig } from '../../src/types/memory';

const DEFAULT_DIMENSIONS = 384;
const LOCAL_FEATURE_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
const LOCAL_FEATURE_CODE_POINT_PATTERN = /[\p{L}\p{N}]/u;
const MODEL = 'unicode-char-ngram-v1';

export const DEFAULT_LOCAL_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'local',
  model: MODEL,
  dimensions: DEFAULT_DIMENSIONS,
};

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const hash = hashString(feature);
  const index = hash % vector.length;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function normalizedText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase();
}

function sequenceCodePoints(sequence: string): string[] {
  return Array.from(sequence).filter((char) => LOCAL_FEATURE_CODE_POINT_PATTERN.test(char));
}

export function getLocalTextEmbedding(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const normalized = normalizedText(text);
  let featureCount = 0;

  LOCAL_FEATURE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of normalized.matchAll(LOCAL_FEATURE_SEQUENCE_PATTERN)) {
    const sequence = match[0];
    const chars = sequenceCodePoints(sequence);
    if (chars.length === 0) continue;
    addFeature(vector, `seq:${sequence}`, 0.8);
    featureCount += 1;
    for (const width of [2, 3, 4]) {
      if (chars.length < width) continue;
      const weight = 1 / width;
      for (let index = 0; index <= chars.length - width; index += 1) {
        addFeature(vector, `${width}:${chars.slice(index, index + width).join('')}`, weight);
        featureCount += 1;
      }
    }
  }

  if (featureCount === 0) return vector;
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export const embedText = getLocalTextEmbedding;

export async function getEmbedding(text: string, config: EmbeddingConfig) {
  return {
    embedding: getLocalTextEmbedding(text, config.dimensions ?? DEFAULT_DIMENSIONS),
    model: config.model || MODEL,
  };
}

export async function getEmbeddingCached(text: string, config: EmbeddingConfig): Promise<number[]> {
  return getLocalTextEmbedding(text, config.dimensions ?? DEFAULT_DIMENSIONS);
}

export function isLocalEmbeddingConfig(config: EmbeddingConfig | undefined): boolean {
  return config?.provider === 'local';
}
