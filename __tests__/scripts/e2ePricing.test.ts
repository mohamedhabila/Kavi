import { estimateE2ETokenCostUsd, resolveE2EPricing } from '../../scripts/e2eReport/pricing';

const COMPLETE_ENV = {
  E2E_PRICING_INPUT_USD_PER_MILLION: '2',
  E2E_PRICING_OUTPUT_USD_PER_MILLION: '10',
  E2E_PRICING_CACHE_READ_USD_PER_MILLION: '0.2',
  E2E_PRICING_CACHE_WRITE_USD_PER_MILLION: '2.5',
  E2E_PRICING_SNAPSHOT_DATE: '2026-07-10',
  E2E_PRICING_SOURCE_SHA256: 'a'.repeat(64),
};

describe('E2E pricing evidence', () => {
  it('keeps missing pricing explicit instead of assuming zero', () => {
    const pricing = resolveE2EPricing({});

    expect(pricing).toEqual({ status: 'missing', snapshot: null });
    expect(estimateE2ETokenCostUsd({ inputTokens: 10, outputTokens: 5 }, pricing)).toBeNull();
  });

  it('prices uncached, cache-read, cache-write, and output tokens separately', () => {
    const pricing = resolveE2EPricing(COMPLETE_ENV);

    expect(pricing).toEqual(
      expect.objectContaining({
        status: 'configured',
        snapshot: expect.objectContaining({
          snapshotDate: '2026-07-10',
          sourceSha256: 'a'.repeat(64),
        }),
      }),
    );
    expect(
      estimateE2ETokenCostUsd(
        {
          inputTokens: 1_000_000,
          outputTokens: 100_000,
          cacheReadTokens: 250_000,
          cacheWriteTokens: 100_000,
        },
        pricing,
      ),
    ).toBeCloseTo(2.6, 10);
  });

  it('rejects partial, malformed, or negative pricing evidence', () => {
    expect(() => resolveE2EPricing({ E2E_PRICING_INPUT_USD_PER_MILLION: '1' })).toThrow(
      'configure every rate',
    );
    expect(() =>
      resolveE2EPricing({
        ...COMPLETE_ENV,
        E2E_PRICING_OUTPUT_USD_PER_MILLION: '-1',
      }),
    ).toThrow('E2E_PRICING_OUTPUT_USD_PER_MILLION');
    expect(() =>
      resolveE2EPricing({ ...COMPLETE_ENV, E2E_PRICING_SNAPSHOT_DATE: '2026-02-30' }),
    ).toThrow('snapshot date');
    expect(() =>
      resolveE2EPricing({ ...COMPLETE_ENV, E2E_PRICING_SOURCE_SHA256: 'not-a-digest' }),
    ).toThrow('source digest');
  });
});
