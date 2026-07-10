const LOCAL_SIMILARITY_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
const LOCAL_SIMILARITY_CODE_POINT_PATTERN = /[\p{L}\p{N}]/u;

export const LOCAL_SIMILARITY_MODEL = 'unicode-char-ngram-v1';
export const LOCAL_SIMILARITY_DIMENSIONS = 384;
export const LOCAL_SIMILARITY_MINIMUM_DIMENSIONS = 64;
export const LOCAL_SIMILARITY_MAXIMUM_DIMENSIONS = 2_048;
export const LOCAL_SIMILARITY_MAXIMUM_INPUT_CHARS = 4_096;

export interface LocalSimilarityVector {
  model: typeof LOCAL_SIMILARITY_MODEL;
  dimensions: typeof LOCAL_SIMILARITY_DIMENSIONS;
  values: number[];
}

export interface StoredLocalSimilarityVector {
  model: string | null | undefined;
  dimensions: number | null | undefined;
  serializedValues: string | null | undefined;
}

function hashString32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addHashedFeature(vector: number[], feature: string, weight: number): void {
  const hash = hashString32(feature);
  const index = hash % vector.length;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase();
}

function sequenceCodePoints(sequence: string): string[] {
  return Array.from(sequence).filter((character) =>
    LOCAL_SIMILARITY_CODE_POINT_PATTERN.test(character),
  );
}

function clampDimensions(dimensions: number | undefined): number {
  if (!Number.isFinite(dimensions ?? Number.NaN)) return LOCAL_SIMILARITY_DIMENSIONS;
  return Math.max(
    LOCAL_SIMILARITY_MINIMUM_DIMENSIONS,
    Math.min(
      Math.floor(dimensions ?? LOCAL_SIMILARITY_DIMENSIONS),
      LOCAL_SIMILARITY_MAXIMUM_DIMENSIONS,
    ),
  );
}

/**
 * Build the deterministic character n-gram vector used by local similarity.
 * Custom dimensions are reserved for generic embedding-service callers; the
 * persisted fact index always uses `createCurrentLocalSimilarityVector`.
 */
export function createCharacterNgramVector(
  text: string,
  dimensions = LOCAL_SIMILARITY_DIMENSIONS,
): number[] {
  const resolvedDimensions = clampDimensions(dimensions);
  const vector = Array.from({ length: resolvedDimensions }, () => 0);
  const normalized = normalizeText(text.slice(0, LOCAL_SIMILARITY_MAXIMUM_INPUT_CHARS));
  let featureCount = 0;

  LOCAL_SIMILARITY_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of normalized.matchAll(LOCAL_SIMILARITY_SEQUENCE_PATTERN)) {
    const sequence = match[0];
    const characters = sequenceCodePoints(sequence);
    if (characters.length === 0) continue;
    addHashedFeature(vector, `seq:${sequence}`, 0.8);
    featureCount += 1;
    for (const width of [2, 3, 4]) {
      if (characters.length < width) continue;
      const weight = 1 / width;
      for (let index = 0; index <= characters.length - width; index += 1) {
        addHashedFeature(
          vector,
          `${width}:${characters.slice(index, index + width).join('')}`,
          weight,
        );
        featureCount += 1;
      }
    }
  }

  if (featureCount === 0) return vector;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function createCurrentLocalSimilarityVector(text: string): LocalSimilarityVector {
  return {
    model: LOCAL_SIMILARITY_MODEL,
    dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    values: createCharacterNgramVector(text, LOCAL_SIMILARITY_DIMENSIONS),
  };
}

export function buildFactLocalSimilarityText(input: {
  predicate: string;
  objectText: string;
  sourceSummary?: string | null;
}): string {
  return [input.predicate, input.objectText, input.sourceSummary ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}

export function requireCurrentLocalSimilarityVector(
  vector: LocalSimilarityVector,
): LocalSimilarityVector {
  if (vector.model !== LOCAL_SIMILARITY_MODEL) {
    throw new Error('memory_local_similarity_model_invalid');
  }
  if (vector.dimensions !== LOCAL_SIMILARITY_DIMENSIONS) {
    throw new Error('memory_local_similarity_dimensions_invalid');
  }
  if (
    vector.values.length !== LOCAL_SIMILARITY_DIMENSIONS ||
    !vector.values.every((value) => Number.isFinite(value))
  ) {
    throw new Error('memory_local_similarity_vector_invalid');
  }
  return vector;
}

export function isCurrentLocalSimilarityVector(
  vector: LocalSimilarityVector,
): vector is LocalSimilarityVector {
  return (
    vector.model === LOCAL_SIMILARITY_MODEL &&
    vector.dimensions === LOCAL_SIMILARITY_DIMENSIONS &&
    vector.values.length === LOCAL_SIMILARITY_DIMENSIONS &&
    vector.values.every((value) => Number.isFinite(value))
  );
}

export function parseCurrentLocalSimilarityVector(
  stored: StoredLocalSimilarityVector,
): LocalSimilarityVector | null {
  if (
    stored.model !== LOCAL_SIMILARITY_MODEL ||
    stored.dimensions !== LOCAL_SIMILARITY_DIMENSIONS ||
    !stored.serializedValues
  ) {
    return null;
  }
  try {
    const values: unknown = JSON.parse(stored.serializedValues);
    if (
      !Array.isArray(values) ||
      values.length !== LOCAL_SIMILARITY_DIMENSIONS ||
      !values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      return null;
    }
    return {
      model: LOCAL_SIMILARITY_MODEL,
      dimensions: LOCAL_SIMILARITY_DIMENSIONS,
      values,
    };
  } catch {
    return null;
  }
}
