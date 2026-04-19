// ---------------------------------------------------------------------------
// Tests — Web Shared Utilities
// ---------------------------------------------------------------------------

import {
  resolveTimeoutSeconds,
  resolveCacheTtlMs,
  normalizeCacheKey,
  readCache,
  writeCache,
  readResponseText,
  CacheEntry,
  withTimeout,
} from '../../src/engine/tools/web-shared';

describe('resolveTimeoutSeconds', () => {
  it('returns value for valid number', () => {
    expect(resolveTimeoutSeconds(10, 30)).toBe(10);
  });

  it('returns fallback for non-number', () => {
    expect(resolveTimeoutSeconds('abc', 30)).toBe(30);
  });

  it('clamps to minimum 1', () => {
    expect(resolveTimeoutSeconds(0, 30)).toBe(1);
    expect(resolveTimeoutSeconds(-5, 30)).toBe(1);
  });
});

describe('resolveCacheTtlMs', () => {
  it('converts minutes to ms', () => {
    expect(resolveCacheTtlMs(5, 15)).toBe(5 * 60000);
  });

  it('uses fallback for non-number', () => {
    expect(resolveCacheTtlMs('bad', 15)).toBe(15 * 60000);
  });

  it('clamps negative to 0', () => {
    expect(resolveCacheTtlMs(-1, 15)).toBe(0);
  });
});

describe('normalizeCacheKey', () => {
  it('trims and lowercases', () => {
    expect(normalizeCacheKey('  Hello World  ')).toBe('hello world');
  });
});

describe('cache read/write', () => {
  let cache: Map<string, CacheEntry<string>>;

  beforeEach(() => {
    cache = new Map();
  });

  it('returns null for missing key', () => {
    expect(readCache(cache, 'missing')).toBeNull();
  });

  it('returns cached value', () => {
    writeCache(cache, 'key', 'value', 60000);
    const result = readCache(cache, 'key');
    expect(result).toEqual({ value: 'value', cached: true });
  });

  it('returns null for expired entry', () => {
    cache.set('key', { value: 'old', expiresAt: Date.now() - 1000, insertedAt: Date.now() - 2000 });
    expect(readCache(cache, 'key')).toBeNull();
    expect(cache.has('key')).toBe(false); // Also deleted
  });

  it('does not write with ttl <= 0', () => {
    writeCache(cache, 'key', 'value', 0);
    expect(cache.size).toBe(0);
  });

  it('evicts oldest when at capacity', () => {
    // Write 100 entries (default max)
    for (let i = 0; i < 100; i++) {
      writeCache(cache, `key${i}`, `val${i}`, 60000);
    }
    expect(cache.size).toBe(100);
    // One more should evict oldest
    writeCache(cache, 'newkey', 'newval', 60000);
    expect(cache.size).toBe(100);
    expect(cache.has('key0')).toBe(false);
  });
});

describe('readResponseText', () => {
  it('reads full text', async () => {
    const res = { text: jest.fn().mockResolvedValue('hello world') } as any;
    const result = await readResponseText(res);
    expect(result).toEqual({ text: 'hello world', truncated: false, bytesRead: 11 });
  });

  it('truncates at maxBytes', async () => {
    const res = { text: jest.fn().mockResolvedValue('hello world longer text') } as any;
    const result = await readResponseText(res, { maxBytes: 5 });
    expect(result.text).toBe('hello');
    expect(result.truncated).toBe(true);
  });

  it('handles read error', async () => {
    const res = { text: jest.fn().mockRejectedValue(new Error('fail')) } as any;
    const result = await readResponseText(res);
    expect(result).toEqual({ text: '', truncated: false, bytesRead: 0 });
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts when the timeout elapses', () => {
    const timeout = withTimeout(undefined, 1000);

    expect(timeout.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(1000);

    expect(timeout.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('disposes the pending timer without aborting the signal', () => {
    const timeout = withTimeout(undefined, 1000);

    expect(jest.getTimerCount()).toBe(1);

    timeout.dispose();
    jest.advanceTimersByTime(1000);

    expect(timeout.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
