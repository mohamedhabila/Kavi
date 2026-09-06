// ---------------------------------------------------------------------------
// Kavi — Provider-backed embedding vector storage helpers
// ---------------------------------------------------------------------------
// Structural validate/serialize/parse helpers for provider embedding vectors
// (OpenAI, Gemini, Voyage, Mistral, Ollama, ...). Unlike the fixed-model local
// n-gram vector, a provider vector's model id and dimensionality vary by which
// embedding provider is currently configured, so every helper here is keyed
// by the vector's own `model`/`dimensions` pair rather than one constant.
//
// Comparison across two vectors is only meaningful when both share the exact
// same `model` id — cosine similarity between embeddings from two different
// models is not a valid signal. Callers must check `model` equality (this
// module's `sameProviderEmbeddingModel`) before scoring.
// ---------------------------------------------------------------------------

export const PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS = 64;
export const PROVIDER_EMBEDDING_MAXIMUM_DIMENSIONS = 3_072;
export const PROVIDER_EMBEDDING_MAXIMUM_SERIALIZED_CHARS = 40_000;
// Providers do not guarantee unit-normalized output; bound generously to
// catch corrupted/garbage payloads without rejecting legitimate embeddings.
const PROVIDER_EMBEDDING_MAXIMUM_ABSOLUTE_VALUE = 100;

export interface ProviderEmbeddingVector {
  model: string;
  dimensions: number;
  values: ReadonlyArray<number>;
}

export interface StoredProviderEmbeddingVector {
  model: string | null | undefined;
  dimensions: number | null | undefined;
  serializedValues: string | null | undefined;
}

function isValidModelId(model: unknown): model is string {
  return typeof model === 'string' && model.trim().length > 0 && model.length <= 128;
}

function isValidDimensions(dimensions: unknown): dimensions is number {
  return (
    typeof dimensions === 'number' &&
    Number.isInteger(dimensions) &&
    dimensions >= PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS &&
    dimensions <= PROVIDER_EMBEDDING_MAXIMUM_DIMENSIONS
  );
}

function isValidValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= PROVIDER_EMBEDDING_MAXIMUM_ABSOLUTE_VALUE
  );
}

export function isProviderEmbeddingVector(
  vector: ProviderEmbeddingVector | null | undefined,
): vector is ProviderEmbeddingVector {
  if (!vector) return false;
  return (
    isValidModelId(vector.model) &&
    isValidDimensions(vector.dimensions) &&
    vector.values.length === vector.dimensions &&
    vector.values.every(isValidValue)
  );
}

export function requireProviderEmbeddingVector(
  vector: ProviderEmbeddingVector,
): ProviderEmbeddingVector {
  if (!isProviderEmbeddingVector(vector)) {
    throw new Error('memory_provider_embedding_vector_invalid');
  }
  return vector;
}

/** Two vectors are only comparable when they came from the exact same embedding model. */
export function sameProviderEmbeddingModel(
  left: Pick<ProviderEmbeddingVector, 'model' | 'dimensions'>,
  right: Pick<ProviderEmbeddingVector, 'model' | 'dimensions'>,
): boolean {
  return left.model === right.model && left.dimensions === right.dimensions;
}

export function serializeProviderEmbeddingVector(vector: ProviderEmbeddingVector): string {
  const validated = requireProviderEmbeddingVector(vector);
  const serialized = JSON.stringify(validated.values);
  if (serialized.length > PROVIDER_EMBEDDING_MAXIMUM_SERIALIZED_CHARS) {
    throw new Error('memory_provider_embedding_storage_budget_exceeded');
  }
  return serialized;
}

export function parseStoredProviderEmbeddingVector(
  stored: StoredProviderEmbeddingVector,
): ProviderEmbeddingVector | null {
  if (
    !isValidModelId(stored.model) ||
    !isValidDimensions(stored.dimensions) ||
    !stored.serializedValues ||
    stored.serializedValues.length > PROVIDER_EMBEDDING_MAXIMUM_SERIALIZED_CHARS
  ) {
    return null;
  }
  try {
    const values: unknown = JSON.parse(stored.serializedValues);
    if (
      !Array.isArray(values) ||
      values.length !== stored.dimensions ||
      !values.every(isValidValue)
    ) {
      return null;
    }
    return Object.freeze({
      model: stored.model,
      dimensions: stored.dimensions,
      values: Object.freeze(values) as ReadonlyArray<number>,
    });
  } catch {
    return null;
  }
}

/**
 * Cosine similarity between two provider vectors from the same model. Callers
 * must confirm `sameProviderEmbeddingModel` first — this only guards length.
 */
export function providerEmbeddingCosineSimilarity(
  query: ProviderEmbeddingVector,
  candidate: ProviderEmbeddingVector,
): number {
  if (
    !sameProviderEmbeddingModel(query, candidate) ||
    query.values.length !== candidate.values.length ||
    query.values.length === 0
  ) {
    return 0;
  }
  let dot = 0;
  let normQuery = 0;
  let normCandidate = 0;
  for (let index = 0; index < query.values.length; index += 1) {
    const a = query.values[index] ?? 0;
    const b = candidate.values[index] ?? 0;
    dot += a * b;
    normQuery += a * a;
    normCandidate += b * b;
  }
  const denominator = Math.sqrt(normQuery) * Math.sqrt(normCandidate);
  return denominator === 0 ? 0 : dot / denominator;
}
