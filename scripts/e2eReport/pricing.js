const PRICING_ENV = Object.freeze({
  input: 'E2E_PRICING_INPUT_USD_PER_MILLION',
  output: 'E2E_PRICING_OUTPUT_USD_PER_MILLION',
  cacheRead: 'E2E_PRICING_CACHE_READ_USD_PER_MILLION',
  cacheWrite: 'E2E_PRICING_CACHE_WRITE_USD_PER_MILLION',
  snapshotDate: 'E2E_PRICING_SNAPSHOT_DATE',
  sourceSha256: 'E2E_PRICING_SOURCE_SHA256',
});

const PRICING_KEYS = Object.freeze(Object.values(PRICING_ENV));
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TOKEN_RATE_UNIT = 1_000_000;

function readConfiguredValue(env, key) {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseRate(env, key) {
  const raw = readConfiguredValue(env, key);
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid or missing evaluation pricing rate: ${key}`);
  }
  return value;
}

function resolveE2EPricing(env = process.env) {
  const configuredKeys = PRICING_KEYS.filter((key) => readConfiguredValue(env, key) !== undefined);
  if (configuredKeys.length === 0) {
    return { status: 'missing', snapshot: null };
  }
  if (configuredKeys.length !== PRICING_KEYS.length) {
    throw new Error('Evaluation pricing must configure every rate and provenance field together.');
  }

  const snapshotDate = readConfiguredValue(env, PRICING_ENV.snapshotDate);
  const sourceSha256 = readConfiguredValue(env, PRICING_ENV.sourceSha256)?.toLowerCase();
  if (!snapshotDate || !ISO_DATE_PATTERN.test(snapshotDate)) {
    throw new Error(`Invalid evaluation pricing snapshot date: ${PRICING_ENV.snapshotDate}`);
  }
  const parsedDate = new Date(`${snapshotDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== snapshotDate
  ) {
    throw new Error(`Invalid evaluation pricing snapshot date: ${PRICING_ENV.snapshotDate}`);
  }
  if (!sourceSha256 || !SHA256_PATTERN.test(sourceSha256)) {
    throw new Error(`Invalid evaluation pricing source digest: ${PRICING_ENV.sourceSha256}`);
  }

  return {
    status: 'configured',
    snapshot: {
      currency: 'USD',
      unitTokens: TOKEN_RATE_UNIT,
      inputUsdPerMillion: parseRate(env, PRICING_ENV.input),
      outputUsdPerMillion: parseRate(env, PRICING_ENV.output),
      cacheReadUsdPerMillion: parseRate(env, PRICING_ENV.cacheRead),
      cacheWriteUsdPerMillion: parseRate(env, PRICING_ENV.cacheWrite),
      snapshotDate,
      sourceSha256,
    },
  };
}

function nonNegativeCount(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid evaluation token count: ${label}`);
  }
  return value;
}

function estimateE2ETokenCostUsd(totals, pricing) {
  if (pricing.status !== 'configured' || !pricing.snapshot) return null;
  const inputTokens = nonNegativeCount(totals.inputTokens, 'inputTokens');
  const outputTokens = nonNegativeCount(totals.outputTokens, 'outputTokens');
  const cacheReadTokens = Math.min(
    inputTokens,
    nonNegativeCount(totals.cacheReadTokens ?? 0, 'cacheReadTokens'),
  );
  const remainingInputTokens = inputTokens - cacheReadTokens;
  const cacheWriteTokens = Math.min(
    remainingInputTokens,
    nonNegativeCount(totals.cacheWriteTokens ?? 0, 'cacheWriteTokens'),
  );
  const uncachedInputTokens = remainingInputTokens - cacheWriteTokens;
  const rates = pricing.snapshot;
  return (
    (uncachedInputTokens * rates.inputUsdPerMillion +
      outputTokens * rates.outputUsdPerMillion +
      cacheReadTokens * rates.cacheReadUsdPerMillion +
      cacheWriteTokens * rates.cacheWriteUsdPerMillion) /
    TOKEN_RATE_UNIT
  );
}

module.exports = {
  PRICING_ENV,
  resolveE2EPricing,
  estimateE2ETokenCostUsd,
};
