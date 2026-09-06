import {
  isProviderEmbeddingVector,
  parseStoredProviderEmbeddingVector,
  providerEmbeddingCosineSimilarity,
  PROVIDER_EMBEDDING_MAXIMUM_DIMENSIONS,
  PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS,
  requireProviderEmbeddingVector,
  sameProviderEmbeddingModel,
  serializeProviderEmbeddingVector,
  type ProviderEmbeddingVector,
} from '../../../src/services/memory/providerSimilarity';

const DIMENSIONS = PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS;

/** Pads `head` with zeros out to `DIMENSIONS` values. */
function padded(head: number[]): number[] {
  return [...head, ...Array(DIMENSIONS - head.length).fill(0)];
}

function vector(overrides: Partial<ProviderEmbeddingVector> = {}): ProviderEmbeddingVector {
  return {
    model: 'text-embedding-3-small',
    dimensions: DIMENSIONS,
    values: padded([0.6, 0.8]),
    ...overrides,
  };
}

describe('isProviderEmbeddingVector', () => {
  it('accepts a well-formed vector', () => {
    expect(isProviderEmbeddingVector(vector())).toBe(true);
  });

  it('rejects a length/dimensions mismatch', () => {
    expect(isProviderEmbeddingVector(vector({ values: [1, 0] }))).toBe(false);
  });

  it('rejects a non-finite or out-of-bound value', () => {
    expect(isProviderEmbeddingVector(vector({ values: padded([Number.NaN, 0]) }))).toBe(false);
    expect(isProviderEmbeddingVector(vector({ values: padded([1e6, 0]) }))).toBe(false);
  });

  it('rejects dimensions below the supported minimum', () => {
    expect(
      isProviderEmbeddingVector(vector({ dimensions: 8, values: Array(8).fill(0) })),
    ).toBe(false);
  });

  it('rejects dimensions above the supported maximum', () => {
    expect(
      isProviderEmbeddingVector(
        vector({
          dimensions: PROVIDER_EMBEDDING_MAXIMUM_DIMENSIONS + 1,
          values: Array(PROVIDER_EMBEDDING_MAXIMUM_DIMENSIONS + 1).fill(0),
        }),
      ),
    ).toBe(false);
  });

  it('rejects an empty or overlong model id', () => {
    expect(isProviderEmbeddingVector(vector({ model: '' }))).toBe(false);
    expect(isProviderEmbeddingVector(vector({ model: 'x'.repeat(129) }))).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isProviderEmbeddingVector(null)).toBe(false);
    expect(isProviderEmbeddingVector(undefined)).toBe(false);
  });
});

describe('requireProviderEmbeddingVector', () => {
  it('returns the vector when valid and throws when invalid', () => {
    expect(requireProviderEmbeddingVector(vector())).toEqual(vector());
    expect(() => requireProviderEmbeddingVector(vector({ values: [1] }))).toThrow(
      'memory_provider_embedding_vector_invalid',
    );
  });
});

describe('sameProviderEmbeddingModel', () => {
  it('requires both model and dimensions to match', () => {
    expect(sameProviderEmbeddingModel(vector(), vector())).toBe(true);
    expect(sameProviderEmbeddingModel(vector(), vector({ model: 'text-embedding-004' }))).toBe(
      false,
    );
    expect(sameProviderEmbeddingModel(vector(), vector({ dimensions: DIMENSIONS + 1 }))).toBe(
      false,
    );
  });
});

describe('serializeProviderEmbeddingVector / parseStoredProviderEmbeddingVector', () => {
  it('round-trips a valid vector', () => {
    const serialized = serializeProviderEmbeddingVector(vector());
    const parsed = parseStoredProviderEmbeddingVector({
      model: 'text-embedding-3-small',
      dimensions: DIMENSIONS,
      serializedValues: serialized,
    });
    expect(parsed).toEqual(vector());
  });

  it('rejects a dimensions/vector-length mismatch instead of parsing inconsistent stored data', () => {
    const serialized = serializeProviderEmbeddingVector(vector());
    expect(
      parseStoredProviderEmbeddingVector({
        model: 'text-embedding-3-small',
        dimensions: DIMENSIONS + 1,
        serializedValues: serialized,
      }),
    ).toBeNull();
  });

  it('parses a stored model id verbatim — model identity is the caller\'s job via sameProviderEmbeddingModel', () => {
    // `parseStoredProviderEmbeddingVector` parses one row in isolation; it has
    // no second vector to compare `model` against, so any structurally valid
    // model id parses. Cross-vector compatibility is `sameProviderEmbeddingModel`'s
    // job (see the describe block above), applied by callers before scoring.
    const serialized = serializeProviderEmbeddingVector(vector());
    expect(
      parseStoredProviderEmbeddingVector({
        model: 'a-different-model',
        dimensions: DIMENSIONS,
        serializedValues: serialized,
      }),
    ).toEqual({ model: 'a-different-model', dimensions: DIMENSIONS, values: vector().values });
  });

  it('returns null for missing or malformed stored values', () => {
    expect(
      parseStoredProviderEmbeddingVector({ model: null, dimensions: null, serializedValues: null }),
    ).toBeNull();
    expect(
      parseStoredProviderEmbeddingVector({
        model: 'text-embedding-3-small',
        dimensions: DIMENSIONS,
        serializedValues: 'not-json',
      }),
    ).toBeNull();
    expect(
      parseStoredProviderEmbeddingVector({
        model: 'text-embedding-3-small',
        dimensions: DIMENSIONS,
        serializedValues: '[1,2]',
      }),
    ).toBeNull();
  });

  it('throws when serializing an invalid vector', () => {
    expect(() => serializeProviderEmbeddingVector(vector({ values: [1] }))).toThrow(
      'memory_provider_embedding_vector_invalid',
    );
  });
});

describe('providerEmbeddingCosineSimilarity', () => {
  it('computes cosine similarity for identical-model vectors', () => {
    const query = vector({ values: padded([1, 0]) });
    const same = vector({ values: padded([1, 0]) });
    const orthogonal = vector({ values: padded([0, 1]) });
    expect(providerEmbeddingCosineSimilarity(query, same)).toBeCloseTo(1, 10);
    expect(providerEmbeddingCosineSimilarity(query, orthogonal)).toBeCloseTo(0, 10);
  });

  it('returns 0 for a different-model comparison instead of a misleading score', () => {
    const query = vector({ values: padded([1, 0]) });
    const differentModel = vector({ model: 'text-embedding-004', values: padded([1, 0]) });
    expect(providerEmbeddingCosineSimilarity(query, differentModel)).toBe(0);
  });

  it('returns 0 for a zero vector without dividing by zero', () => {
    const query = vector({ values: Array(DIMENSIONS).fill(0) });
    const candidate = vector({ values: padded([1, 0]) });
    expect(providerEmbeddingCosineSimilarity(query, candidate)).toBe(0);
  });
});
