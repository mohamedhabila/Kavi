jest.mock('../../../src/services/memory/embeddingProviderSelection', () => ({
  resolveEmbeddingProviderPath: jest.fn(),
}));

jest.mock('../../../src/services/memory/embeddings', () => ({
  getEmbeddingCached: jest.fn(),
}));

import { resolveEmbeddingProviderPath } from '../../../src/services/memory/embeddingProviderSelection';
import { getEmbeddingCached } from '../../../src/services/memory/embeddings';
import {
  getQueryProviderEmbeddingVector,
  QUERY_PROVIDER_EMBEDDING_TIMEOUT_MS,
} from '../../../src/services/memory/providerQueryEmbedding';
import { PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS } from '../../../src/services/memory/providerSimilarity';

const resolveEmbeddingProviderPathMock = resolveEmbeddingProviderPath as jest.MockedFunction<
  typeof resolveEmbeddingProviderPath
>;
const getEmbeddingCachedMock = getEmbeddingCached as jest.MockedFunction<typeof getEmbeddingCached>;

const DIMENSIONS = PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS;

/** Pads `head` with zeros out to `DIMENSIONS` values — a well-formed vector. */
function padded(head: number[]): number[] {
  return [...head, ...Array(DIMENSIONS - head.length).fill(0)];
}

const RESOLVED_PATH = {
  providerId: 'openai-provider',
  providerFamily: 'openai' as const,
  config: { provider: 'openai' as const, model: 'text-embedding-3-small', dimensions: DIMENSIONS },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('getQueryProviderEmbeddingVector', () => {
  it('returns null without calling any provider path for blank text', async () => {
    expect(await getQueryProviderEmbeddingVector('   ')).toBeNull();
    expect(resolveEmbeddingProviderPathMock).not.toHaveBeenCalled();
  });

  it('returns null when no embedding provider is resolved', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValue(null);
    expect(await getQueryProviderEmbeddingVector('hello world')).toBeNull();
    expect(getEmbeddingCachedMock).not.toHaveBeenCalled();
  });

  it('returns a compatible vector on success', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValue(RESOLVED_PATH);
    const values = padded([0.1, 0.2, 0.3, 0.4]);
    getEmbeddingCachedMock.mockResolvedValue(values);

    const vector = await getQueryProviderEmbeddingVector('hello world');
    expect(vector).toEqual({
      model: 'text-embedding-3-small',
      dimensions: DIMENSIONS,
      values,
    });
    expect(getEmbeddingCachedMock).toHaveBeenCalledWith('hello world', RESOLVED_PATH.config);
  });

  it('returns null instead of throwing when the provider call fails', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValue(RESOLVED_PATH);
    getEmbeddingCachedMock.mockRejectedValue(new Error('network_down'));

    await expect(getQueryProviderEmbeddingVector('hello world')).resolves.toBeNull();
  });

  it('returns null and never throws when the resulting vector is malformed', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValue(RESOLVED_PATH);
    // Length mismatch against the resolved config's declared dimensions.
    getEmbeddingCachedMock.mockResolvedValue([0.1, 0.2]);

    await expect(getQueryProviderEmbeddingVector('hello world')).resolves.toBeNull();
  });

  it('falls back to null within the hard timeout budget instead of blocking the turn', async () => {
    jest.useFakeTimers();
    resolveEmbeddingProviderPathMock.mockResolvedValue(RESOLVED_PATH);
    // A provider call that never resolves — the hard timeout must still win.
    getEmbeddingCachedMock.mockReturnValue(new Promise<number[]>(() => {}));

    const pending = getQueryProviderEmbeddingVector('hello world');
    let settled: unknown;
    pending.then((value) => {
      settled = { value };
    });

    await jest.advanceTimersByTimeAsync(QUERY_PROVIDER_EMBEDDING_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();

    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toEqual({ value: null });
    jest.useRealTimers();
  });

  it('re-embeds instead of reusing a stale result when the resolved model changes between calls', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValueOnce(RESOLVED_PATH);
    getEmbeddingCachedMock.mockResolvedValueOnce(padded([0.1, 0.2, 0.3, 0.4]));
    const first = await getQueryProviderEmbeddingVector('same query text');
    expect(first?.model).toBe('text-embedding-3-small');

    const otherModelPath = {
      providerId: 'gemini-provider',
      providerFamily: 'gemini' as const,
      config: { provider: 'gemini' as const, model: 'text-embedding-004', dimensions: DIMENSIONS },
    };
    const secondValues = padded([0.5, 0.6, 0.7]);
    resolveEmbeddingProviderPathMock.mockResolvedValueOnce(otherModelPath);
    getEmbeddingCachedMock.mockResolvedValueOnce(secondValues);
    const second = await getQueryProviderEmbeddingVector('same query text');

    expect(second).toEqual({
      model: 'text-embedding-004',
      dimensions: DIMENSIONS,
      values: secondValues,
    });
    // The cache-key concern (config.provider/model/dimensions) is delegated to
    // `getEmbeddingCached` itself — this module must pass the *current*
    // resolved config on every call rather than memoizing its own result.
    expect(getEmbeddingCachedMock).toHaveBeenNthCalledWith(1, 'same query text', RESOLVED_PATH.config);
    expect(getEmbeddingCachedMock).toHaveBeenNthCalledWith(
      2,
      'same query text',
      otherModelPath.config,
    );
  });
});
