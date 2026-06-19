const path = require('path');
const { E2E_PROVIDER_SPECS, readFirstEnvValue } = require('./provider');

const PROVIDER_MATRIX_VERSION = '2026-06-15.provider-matrix';
const DEFAULT_PROVIDER_MATRIX_PROVIDER_KEYS = ['gemini', 'openai'];
const DEFAULT_PROVIDER_MATRIX_BATCH_IDS = ['provider-core'];

const PROVIDER_MATRIX_BATCHES = [
  {
    id: 'provider-core',
    label: 'Provider core stability',
    description:
      'Small cross-provider batch covering long-context cache telemetry, mobile calendar mutation, and graph-owned delegation evidence.',
    scenarioIds: [
      'bench-prompt-cache-long-horizon',
      'bench-androidworld-calendar-mutation',
      'delegation-worker-evidence-chain',
    ],
  },
  {
    id: 'memory-long-run',
    label: 'Long-run memory',
    description:
      'LongMemEval, LOCOMO, and BEAM-inspired mobile memory probes for update, temporal, and multi-probe recall.',
    scenarioIds: [
      'bench-longmem-knowledge-update-recall',
      'direct-longmemeval-v2-mobile-preference-update',
      'direct-locomo-temporal-conversation-memory',
      'direct-beam-long-dialogue-multi-probe',
    ],
  },
  {
    id: 'mobile-native',
    label: 'Mobile native workflows',
    description:
      'AndroidWorld, MobileWorld, and MobileAgentBench-inspired native task completion across contacts, messaging, permissions, and media state.',
    scenarioIds: [
      'bench-mobileworld-discover-contact-message',
      'direct-mobileworld-cross-app-contact-message',
      'bench-mobileagent-contact-message-draft',
      'bench-androidworld-permission-denial',
      'bench-mobileagent-media-state',
    ],
  },
  {
    id: 'capability-chain',
    label: 'Capability chain robustness',
    description:
      'AgentBench, BFCL, and ToolSandbox-inspired result-driven state and capability chaining without preselected tools.',
    scenarioIds: [
      'bench-agentbench-tool-chain',
      'bench-bfcl-parallel-file-read',
      'bench-bfcl-sequential-memory-chain',
      'direct-toolsandbox-state-dependency',
    ],
  },
];

function unique(values) {
  return Array.from(new Set(values));
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function eligibleCacheReadTokens(cacheReadTokens, eligibleInputTokens) {
  return Math.min(Math.max(0, cacheReadTokens), Math.max(0, eligibleInputTokens));
}

function resolveEligibleCacheReadTokensFromCache(cache, fallbackCacheReadTokens, eligibleInputTokens) {
  const rate = cache?.eligibleCacheReadRate;
  if (Number.isFinite(rate) && eligibleInputTokens > 0) {
    return Math.min(eligibleInputTokens, Math.max(0, Math.round(rate * eligibleInputTokens)));
  }
  return eligibleCacheReadTokens(fallbackCacheReadTokens, eligibleInputTokens);
}

function parseCsvEnv(rawValue) {
  if (!rawValue?.trim()) {
    return [];
  }
  return unique(
    rawValue
      .split(/[,\s]+/u)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function findProviderSpec(providerKeyOrAlias) {
  const normalized = String(providerKeyOrAlias || '').trim().toLowerCase();
  return E2E_PROVIDER_SPECS.find(
    (spec) => spec.key === normalized || spec.aliases.includes(normalized),
  );
}

function resolveProviderKeys(env = process.env) {
  const configured = parseCsvEnv(env.E2E_PROVIDER_MATRIX_PROVIDERS || env.E2E_PROVIDER_MATRIX);
  const requested = configured.length > 0 ? configured : DEFAULT_PROVIDER_MATRIX_PROVIDER_KEYS;
  return unique(
    requested.map((providerKeyOrAlias) => {
      const spec = findProviderSpec(providerKeyOrAlias);
      if (!spec) {
        throw new Error(`Unknown E2E provider for matrix run: ${providerKeyOrAlias}`);
      }
      return spec.key;
    }),
  );
}

function resolveBatchSelection(env = process.env) {
  const configured = parseCsvEnv(env.E2E_PROVIDER_MATRIX_BATCHES);
  const requested = configured.length > 0 ? configured : DEFAULT_PROVIDER_MATRIX_BATCH_IDS;
  if (requested.some((batchId) => batchId.toLowerCase() === 'all')) {
    return PROVIDER_MATRIX_BATCHES;
  }

  return requested.map((batchId) => {
    const batch = PROVIDER_MATRIX_BATCHES.find((candidate) => candidate.id === batchId);
    if (!batch) {
      throw new Error(`Unknown E2E provider matrix batch: ${batchId}`);
    }
    return batch;
  });
}

function sanitizeRunIdPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function resolveMatrixRunId(env = process.env, generatedAt = new Date().toISOString()) {
  return sanitizeRunIdPart(env.E2E_PROVIDER_MATRIX_RUN_ID?.trim() || generatedAt);
}

function resolveMatrixReportDir(projectRoot, env = process.env, runId = resolveMatrixRunId(env)) {
  const configured = env.E2E_PROVIDER_MATRIX_REPORT_DIR?.trim();
  if (configured) {
    return path.resolve(projectRoot, configured);
  }
  return path.join(projectRoot, '.artifacts', 'e2e-provider-matrix', runId);
}

function buildMatrixRunPlan(options) {
  const projectRoot = options.projectRoot;
  const env = options.env || process.env;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = resolveMatrixRunId(env, generatedAt);
  const reportDir = resolveMatrixReportDir(projectRoot, env, runId);
  const providerKeys = resolveProviderKeys(env);
  const batches = resolveBatchSelection(env);
  const runs = providerKeys.flatMap((providerKey) =>
    batches.map((batch) => ({
      providerKey,
      batchId: batch.id,
      scenarioIds: [...batch.scenarioIds],
      reportPath: path.join(reportDir, `${providerKey}-${batch.id}.json`),
    })),
  );

  return {
    version: PROVIDER_MATRIX_VERSION,
    generatedAt,
    runId,
    reportDir,
    providerKeys,
    batches: batches.map((batch) => ({
      id: batch.id,
      label: batch.label,
      description: batch.description,
      scenarioIds: [...batch.scenarioIds],
    })),
    runs,
  };
}

function resolveProviderCredentialStatus(providerKey, env = process.env) {
  const spec = findProviderSpec(providerKey);
  if (!spec) {
    throw new Error(`Unknown E2E provider for matrix run: ${providerKey}`);
  }

  const apiKey = readFirstEnvValue(env, spec.apiKeyEnv);
  const model = readFirstEnvValue(env, spec.modelEnv) || spec.defaultModel;
  const baseUrl = readFirstEnvValue(env, spec.baseUrlEnv) || spec.defaultBaseUrl;
  const missing = [];
  if (!apiKey) {
    missing.push(spec.apiKeyEnv.join(' or '));
  }
  if (!model) {
    missing.push(spec.modelEnv.join(' or '));
  }
  if (!baseUrl) {
    missing.push(spec.baseUrlEnv.join(' or '));
  }

  return {
    providerKey: spec.key,
    configured: missing.length === 0,
    missing,
    model,
    baseUrl,
  };
}

function buildSkippedProviderBatchSummary(params) {
  return {
    providerKey: params.providerKey,
    batchId: params.batchId,
    scenarioIds: [...params.scenarioIds],
    reportPath: params.reportPath,
    status: 'skipped',
    metricsPassing: false,
    passing: false,
    reason: params.reason,
    scenarioCount: 0,
    passedCount: 0,
    failedCount: 0,
    passRate: 0,
    pass1Rate: 0,
    cacheReadRate: 0,
    eligibleCacheReadRate: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    scenarioOutcomes: [],
    failedScenarioIds: [],
  };
}

function buildProviderBatchSummary(params) {
  const report = params.report;
  if (!report) {
    return {
      providerKey: params.providerKey,
      batchId: params.batchId,
      scenarioIds: [...params.scenarioIds],
      reportPath: params.reportPath,
      status: 'failed',
      exitStatus: params.exitStatus ?? 1,
      metricsPassing: false,
      passing: false,
      reason: params.reason || 'report_missing',
      scenarioCount: 0,
      passedCount: 0,
      failedCount: 0,
      passRate: 0,
      pass1Rate: 0,
      cacheReadRate: 0,
      eligibleCacheReadRate: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      scenarioOutcomes: [],
      failedScenarioIds: [],
    };
  }

  const totals = report.totals || {};
  const reliability = report.reliability || {};
  const cache = report.cache || {};
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const scenarioCount = totals.scenarioCount ?? scenarios.length;
  const passedCount =
    totals.passedCount ?? scenarios.filter((scenario) => Boolean(scenario.passed)).length;
  const failedCount = totals.failedCount ?? Math.max(0, scenarioCount - passedCount);
  const reliabilityScenarioCount = reliability.scenarioCount ?? scenarioCount;
  const pass1PassedCount =
    reliability.pass1PassedCount ??
    scenarios.filter((scenario) => Boolean(scenario.passed) && (scenario.attemptCount ?? 1) === 1)
      .length;
  const metricsPassing =
    params.exitStatus === 0 && Boolean(report.metricsPassing) && failedCount === 0;
  const scenarioOutcomes = scenarios.map((scenario) => ({
    fixtureId: scenario.fixtureId,
    passed: Boolean(scenario.passed),
    attemptCount: scenario.attemptCount ?? 1,
    inputTokens: scenario.usage?.inputTokens ?? 0,
    outputTokens: scenario.usage?.outputTokens ?? 0,
    totalTokens: scenario.usage?.totalTokens ?? 0,
    cacheReadTokens: scenario.usage?.cacheReadTokens ?? 0,
    eligibleInputTokens: scenario.cache?.eligibleInputTokens ?? 0,
    eligibleCacheReadTokens: resolveEligibleCacheReadTokensFromCache(
      scenario.cache,
      scenario.usage?.cacheReadTokens ?? 0,
      scenario.cache?.eligibleInputTokens ?? 0,
    ),
  }));
  const batchEligibleInputTokens = cache.eligibleInputTokens ?? 0;
  const batchCacheReadTokens = cache.cacheReadTokens ?? totals.cacheReadTokens ?? 0;

  return {
    providerKey: params.providerKey,
    provider: report.runMetadata?.provider || params.providerKey,
    providerId: report.runMetadata?.providerId,
    model: report.runMetadata?.model,
    batchId: params.batchId,
    scenarioIds: [...params.scenarioIds],
    reportPath: params.reportPath,
    status: metricsPassing ? 'passed' : 'failed',
    exitStatus: params.exitStatus ?? 0,
    metricsPassing,
    passing: metricsPassing,
    scenarioCount,
    passedCount,
    failedCount,
    passRate: safeRate(passedCount, scenarioCount),
    pass1Rate:
      reliability.pass1Rate !== undefined
        ? reliability.pass1Rate
        : safeRate(pass1PassedCount, reliabilityScenarioCount),
    passKRate: reliability.passKRate ?? safeRate(reliability.passKPassedCount ?? 0, scenarioCount),
    retriedScenarioCount: reliability.retriedScenarioCount ?? 0,
    cacheReadRate: cache.cacheReadRate ?? safeRate(totals.cacheReadTokens ?? 0, totals.inputTokens ?? 0),
    eligibleCacheReadRate:
      cache.eligibleCacheReadRate ??
      safeRate(cache.cacheReadTokens ?? totals.cacheReadTokens ?? 0, cache.eligibleInputTokens ?? 0),
    eligibleInputTokens: batchEligibleInputTokens,
    cacheReadTokens: batchCacheReadTokens,
    eligibleCacheReadTokens: resolveEligibleCacheReadTokensFromCache(
      cache,
      batchCacheReadTokens,
      batchEligibleInputTokens,
    ),
    cachePassing: Boolean(cache.passing),
    evidenceScore: report.assessment?.evidenceScore ?? 0,
    inputTokens: totals.inputTokens ?? 0,
    outputTokens: totals.outputTokens ?? 0,
    totalTokens: totals.totalTokens ?? 0,
    scenarioOutcomes,
    failedScenarioIds: scenarioOutcomes
      .filter((scenario) => !scenario.passed)
      .map((scenario) => scenario.fixtureId)
      .sort(),
  };
}

function buildProviderSummaries(results) {
  const byProvider = new Map();
  for (const result of results) {
    if (!byProvider.has(result.providerKey)) {
      byProvider.set(result.providerKey, {
        providerKey: result.providerKey,
        batchRunCount: 0,
        skippedBatchRunCount: 0,
        scenarioCount: 0,
        passedCount: 0,
        failedCount: 0,
        pass1PassedCount: 0,
        reliabilityScenarioCount: 0,
        eligibleInputTokens: 0,
        cacheReadTokens: 0,
        eligibleCacheReadTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        failedScenarioIds: [],
        passing: true,
      });
    }

    const summary = byProvider.get(result.providerKey);
    summary.batchRunCount += 1;
    summary.skippedBatchRunCount += result.status === 'skipped' ? 1 : 0;
    summary.scenarioCount += result.scenarioCount;
    summary.passedCount += result.passedCount;
    summary.failedCount += result.failedCount;
    summary.pass1PassedCount += Math.round(result.pass1Rate * result.scenarioCount);
    summary.reliabilityScenarioCount += result.scenarioCount;
    summary.eligibleInputTokens += result.eligibleInputTokens ?? 0;
    summary.cacheReadTokens += result.cacheReadTokens ?? 0;
    summary.eligibleCacheReadTokens += result.eligibleCacheReadTokens ?? 0;
    summary.inputTokens += result.inputTokens;
    summary.outputTokens += result.outputTokens;
    summary.totalTokens += result.totalTokens;
    summary.failedScenarioIds.push(...result.failedScenarioIds);
    summary.passing = summary.passing && result.passing;
  }

  return Array.from(byProvider.values())
    .map((summary) => ({
      ...summary,
      failedScenarioIds: unique(summary.failedScenarioIds).sort(),
      passRate: safeRate(summary.passedCount, summary.scenarioCount),
      pass1Rate: safeRate(summary.pass1PassedCount, summary.reliabilityScenarioCount),
      eligibleCacheReadRate: safeRate(
        summary.eligibleCacheReadTokens,
        summary.eligibleInputTokens,
      ),
      cacheReadRate: safeRate(summary.cacheReadTokens, summary.inputTokens),
    }))
    .sort((left, right) => left.providerKey.localeCompare(right.providerKey));
}

function buildScenarioComparisons(providerKeys, results) {
  const outcomesByScenario = new Map();
  for (const result of results) {
    for (const scenario of result.scenarioOutcomes) {
      if (!outcomesByScenario.has(scenario.fixtureId)) {
        outcomesByScenario.set(scenario.fixtureId, new Map());
      }
      outcomesByScenario.get(scenario.fixtureId).set(result.providerKey, {
        passed: scenario.passed,
        attemptCount: scenario.attemptCount,
        totalTokens: scenario.totalTokens,
        cacheReadTokens: scenario.cacheReadTokens,
        eligibleInputTokens: scenario.eligibleInputTokens,
      });
    }
  }

  return Array.from(outcomesByScenario.entries())
    .map(([fixtureId, providerOutcomes]) => {
      const outcomes = providerKeys.map((providerKey) => ({
        providerKey,
        ...(providerOutcomes.get(providerKey) || { passed: false, missing: true }),
      }));
      const failedProviders = outcomes
        .filter((outcome) => !outcome.passed)
        .map((outcome) => outcome.providerKey);
      return {
        fixtureId,
        providerCount: outcomes.length,
        passedProviderCount: outcomes.filter((outcome) => outcome.passed).length,
        failedProviders,
        passingAcrossProviders: failedProviders.length === 0,
        outcomes,
      };
    })
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
}

function summarizeMatrixReport(plan, results) {
  const scenarioCount = results.reduce((total, result) => total + result.scenarioCount, 0);
  const passedCount = results.reduce((total, result) => total + result.passedCount, 0);
  const failedCount = results.reduce((total, result) => total + result.failedCount, 0);
  const inputTokens = results.reduce((total, result) => total + result.inputTokens, 0);
  const outputTokens = results.reduce((total, result) => total + result.outputTokens, 0);
  const totalTokens = results.reduce((total, result) => total + result.totalTokens, 0);
  const eligibleInputTokens = results.reduce(
    (total, result) => total + (result.eligibleInputTokens ?? 0),
    0,
  );
  const cacheReadTokens = results.reduce(
    (total, result) => total + (result.cacheReadTokens ?? 0),
    0,
  );
  const eligibleCacheReadTokensTotal = results.reduce(
    (total, result) => total + (result.eligibleCacheReadTokens ?? 0),
    0,
  );
  const failedBatchRunCount = results.filter((result) => result.status === 'failed').length;
  const skippedBatchRunCount = results.filter((result) => result.status === 'skipped').length;
  const scenarioComparisons = buildScenarioComparisons(plan.providerKeys, results);

  return {
    version: plan.version,
    generatedAt: plan.generatedAt,
    runId: plan.runId,
    reportDir: plan.reportDir,
    providerKeys: plan.providerKeys,
    batches: plan.batches,
    results,
    providerSummaries: buildProviderSummaries(results),
    scenarioComparisons,
    overall: {
      batchRunCount: results.length,
      failedBatchRunCount,
      skippedBatchRunCount,
      scenarioCount,
      passedCount,
      failedCount,
      passRate: safeRate(passedCount, scenarioCount),
      inputTokens,
      outputTokens,
      totalTokens,
      eligibleInputTokens,
      cacheReadTokens,
      eligibleCacheReadTokens: eligibleCacheReadTokensTotal,
      cacheReadRate: safeRate(cacheReadTokens, inputTokens),
      eligibleCacheReadRate: safeRate(eligibleCacheReadTokensTotal, eligibleInputTokens),
      passing:
        results.length > 0 &&
        failedBatchRunCount === 0 &&
        skippedBatchRunCount === 0 &&
        scenarioComparisons.every((comparison) => comparison.passingAcrossProviders),
    },
  };
}

module.exports = {
  DEFAULT_PROVIDER_MATRIX_BATCH_IDS,
  DEFAULT_PROVIDER_MATRIX_PROVIDER_KEYS,
  PROVIDER_MATRIX_BATCHES,
  PROVIDER_MATRIX_VERSION,
  buildMatrixRunPlan,
  buildProviderBatchSummary,
  buildSkippedProviderBatchSummary,
  parseCsvEnv,
  resolveBatchSelection,
  resolveMatrixReportDir,
  resolveMatrixRunId,
  resolveProviderCredentialStatus,
  resolveProviderKeys,
  summarizeMatrixReport,
};
