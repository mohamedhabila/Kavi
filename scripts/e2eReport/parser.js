const path = require('path');
const { execFileSync } = require('child_process');
const constants = require('./constants');
const { readFirstEnvValue, resolveE2eProviderSpec } = require('./provider');
const {
  assertGitSha,
  assertPublicHostedFamily,
  assertPublicRevision,
  digestProviderEndpoint,
  resolveHostedFamily,
  resolveOptionalPublicRevision,
  resolveOptionalSeed,
  resolvePromptCacheMode,
  resolvePublicModelIdentity,
} = require('./provenance');
const {
  NATIVE_TOOL_FIXTURE_VERSION,
  PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  SCENARIO_MANIFEST_VERSION,
} = constants;

function resolvePartialPath(reportPath) {
  const configured = process.env.E2E_REPORT_PARTIAL_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return `${path.resolve(reportPath)}.partial.json`;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function eligibleCacheReadTokens(cacheReadTokens, eligibleInputTokens) {
  return Math.min(Math.max(0, cacheReadTokens), Math.max(0, eligibleInputTokens));
}

function parseNonNegativeInteger(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseCacheFailureBuckets(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((bucket) => ({
        providerStatus: String(bucket?.providerStatus ?? '').trim(),
        count: parseNonNegativeInteger(String(bucket?.count ?? '')),
      }))
      .filter((bucket) => bucket.providerStatus && bucket.count !== undefined)
      .sort((left, right) => left.providerStatus.localeCompare(right.providerStatus));
  } catch {
    return [];
  }
}

function readCacheCreateTelemetryFromEnv() {
  const buckets = parseCacheFailureBuckets(process.env.E2E_CACHE_CREATE_FAILURES_JSON);
  const attempts = parseNonNegativeInteger(process.env.E2E_CACHE_CREATE_ATTEMPTS);
  const configuredFailureCount = parseNonNegativeInteger(
    process.env.E2E_CACHE_CREATE_FAILURE_COUNT,
  );
  const failureCount =
    configuredFailureCount ?? buckets.reduce((total, bucket) => total + bucket.count, 0);
  const telemetryAvailable =
    process.env.E2E_CACHE_CREATE_TELEMETRY_AVAILABLE === '1' ||
    attempts !== undefined ||
    configuredFailureCount !== undefined ||
    buckets.length > 0;

  return {
    cacheCreateAttempts: attempts ?? 0,
    cacheCreateFailureCount: failureCount,
    cacheCreateFailuresByProviderStatus: buckets,
    cacheCreateTelemetryAvailable: telemetryAvailable,
  };
}

function scenarioEligibleInputTokens(entry) {
  if (entry.cache && Number.isFinite(entry.cache.eligibleInputTokens)) {
    return entry.cache.eligibleInputTokens;
  }
  const inputTokens = entry.usage?.inputTokens ?? 0;
  return inputTokens >= PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS ? inputTokens : 0;
}

function resolveGitSha() {
  const configured =
    process.env.E2E_GIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.CI_COMMIT_SHA?.trim();
  if (configured) {
    return assertGitSha(configured);
  }
  try {
    return assertGitSha(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return 'unknown';
  }
}

function resolveOptionalNumber(raw) {
  if (!raw?.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error('E2E temperature must be a finite number');
  }
  return parsed;
}

function requireMetadataValue(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required for public E2E run provenance`);
  }
  return normalized;
}

function buildRunMetadata() {
  const modelVersion = resolveOptionalPublicRevision(
    process.env.E2E_MODEL_VERSION,
    'Model version',
  );
  const temperature = resolveOptionalNumber(process.env.E2E_TEMPERATURE);
  const seed = resolveOptionalSeed(process.env.E2E_SEED);
  const providerSpec = resolveE2eProviderSpec();
  const modelLocator = requireMetadataValue(
    readFirstEnvValue(process.env, providerSpec.modelEnv) || providerSpec.defaultModel,
    'Model locator',
  );
  const modelIdentity = resolvePublicModelIdentity({
    providerKey: providerSpec.key,
    modelLocator,
    publicModelId: process.env.E2E_PUBLIC_MODEL_ID,
  });
  const hostedFamily = process.env.E2E_PUBLIC_HOSTED_FAMILY?.trim()
    ? assertPublicHostedFamily(process.env.E2E_PUBLIC_HOSTED_FAMILY)
    : resolveHostedFamily(modelLocator);
  const endpoint = requireMetadataValue(
    readFirstEnvValue(process.env, providerSpec.baseUrlEnv) || providerSpec.defaultBaseUrl,
    'Provider endpoint',
  );
  return {
    gitSha: resolveGitSha(),
    provider: providerSpec.provider,
    providerId: providerSpec.id,
    hostedFamily,
    ...modelIdentity,
    ...(modelVersion ? { modelVersion } : {}),
    endpointSha256: digestProviderEndpoint(endpoint),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(seed !== undefined ? { seed } : {}),
    scenarioManifestVersion: assertPublicRevision(
      SCENARIO_MANIFEST_VERSION,
      'Scenario manifest version',
    ),
    promptCacheMode: resolvePromptCacheMode(process.env.E2E_PROMPT_CACHE_MODE),
    nativeToolFixtureVersion: assertPublicRevision(
      NATIVE_TOOL_FIXTURE_VERSION,
      'Native tool fixture version',
    ),
    collectMode: process.env.E2E_COLLECT_MODE === '1',
  };
}

function resolveMaxRetries() {
  const raw = process.env.E2E_MAX_SCENARIO_RETRIES?.trim();
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 3);
}

module.exports = {
  ...constants,
  resolvePartialPath,
  safeRate,
  eligibleCacheReadTokens,
  parseNonNegativeInteger,
  parseCacheFailureBuckets,
  readCacheCreateTelemetryFromEnv,
  scenarioEligibleInputTokens,
  resolveGitSha,
  resolveOptionalNumber,
  buildRunMetadata,
  resolveMaxRetries,
};
