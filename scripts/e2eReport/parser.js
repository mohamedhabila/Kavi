const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const constants = require('./constants');
const { readFirstEnvValue, resolveE2eProviderSpec } = require('./provider');
const {
  EMPTY_TOKEN_BUCKETS,
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

function readEntries(partialPath) {
  if (!fs.existsSync(partialPath)) {
    return [];
  }
  const raw = fs.readFileSync(partialPath, 'utf8').trim();
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
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

function buildScenarioCache(entry) {
  const inputTokens = entry.usage?.inputTokens ?? 0;
  const cacheReadTokens = entry.usage?.cacheReadTokens ?? 0;
  const eligibleInputTokens = scenarioEligibleInputTokens(entry);
  const eligibleReadTokens = eligibleCacheReadTokens(cacheReadTokens, eligibleInputTokens);
  return {
    inputTokens,
    eligibleInputTokens,
    cacheReadTokens,
    cacheWriteTokens: entry.usage?.cacheWriteTokens ?? 0,
    cacheReadRate: safeRate(cacheReadTokens, inputTokens),
    eligibleCacheReadRate: safeRate(eligibleReadTokens, eligibleInputTokens),
    eligible: eligibleInputTokens > 0,
  };
}

function normalizeEntry(entry) {
  return {
    ...entry,
    tokenBuckets: entry.tokenBuckets ?? entry.usage?.tokenBuckets ?? EMPTY_TOKEN_BUCKETS,
    ...((entry.promptCache ?? entry.usage?.promptCache)
      ? { promptCache: entry.promptCache ?? entry.usage.promptCache }
      : {}),
    cache: entry.cache ?? buildScenarioCache(entry),
    rubricAudit: entry.rubricAudit ?? {
      rubricCount: 0,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      structuralSubstringRubricCount: 0,
      risks: [],
    },
    loopDiagnostics: entry.loopDiagnostics ?? {
      repeatedToolCalls: [],
      repeatedCatalogAfterActivationCount: 0,
      repeatedHoldReasons: [],
      passing: true,
    },
    benchmarkFamilies: Array.isArray(entry.benchmarkFamilies) ? entry.benchmarkFamilies : [],
    assessmentDimensions: Array.isArray(entry.assessmentDimensions)
      ? entry.assessmentDimensions
      : [],
  };
}

function resolveGitSha() {
  const configured =
    process.env.E2E_GIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.CI_COMMIT_SHA?.trim();
  if (configured) {
    return configured;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function resolveOptionalNumber(raw) {
  if (!raw?.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildRunMetadata() {
  const modelVersion = process.env.E2E_MODEL_VERSION?.trim();
  const temperature = resolveOptionalNumber(process.env.E2E_TEMPERATURE);
  const seed = process.env.E2E_SEED?.trim();
  const providerSpec = resolveE2eProviderSpec();
  return {
    gitSha: resolveGitSha(),
    provider: providerSpec.provider,
    providerId: providerSpec.id,
    model:
      readFirstEnvValue(process.env, providerSpec.modelEnv) ||
      providerSpec.defaultModel ||
      `unknown-${providerSpec.key}-model`,
    ...(modelVersion ? { modelVersion } : {}),
    providerBaseUrl:
      readFirstEnvValue(process.env, providerSpec.baseUrlEnv) ||
      providerSpec.defaultBaseUrl ||
      'unknown',
    ...(temperature !== undefined ? { temperature } : {}),
    ...(seed ? { seed } : {}),
    scenarioManifestVersion: SCENARIO_MANIFEST_VERSION,
    promptCacheMode: process.env.E2E_PROMPT_CACHE_MODE?.trim() || 'provider-default',
    nativeToolFixtureVersion: NATIVE_TOOL_FIXTURE_VERSION,
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
  readEntries,
  safeRate,
  eligibleCacheReadTokens,
  parseNonNegativeInteger,
  parseCacheFailureBuckets,
  readCacheCreateTelemetryFromEnv,
  scenarioEligibleInputTokens,
  buildScenarioCache,
  normalizeEntry,
  resolveGitSha,
  resolveOptionalNumber,
  buildRunMetadata,
  resolveMaxRetries,
};
