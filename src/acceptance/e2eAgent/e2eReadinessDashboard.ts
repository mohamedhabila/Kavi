// ---------------------------------------------------------------------------
// Kavi — readiness dashboard (continuous E2E improvement loop)
// ---------------------------------------------------------------------------
// The dashboard is derived from structural report fields only: rubric kinds,
// graph states, cache counters, benchmark tags, and manifest requirements. It
// intentionally avoids prompt/prose/error-text heuristics and prescribed tool paths.
// ---------------------------------------------------------------------------

import {
  auditE2EBenchmarkManifests,
  E2E_BENCHMARK_MANIFEST_VERSION,
  E2E_BENCHMARK_SOURCE_REFRESH_DATE,
  listE2EBenchmarkRequirements,
  type E2EBenchmarkRequirement,
} from './e2eBenchmarkManifest';
import type { E2EAssessmentAxisSummary, E2EAssessmentReport } from './e2eAssessmentReport';
import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import type { E2EBenchmarkFamily } from './e2eBenchmarkRegistry';
import type {
  E2ERunReportCacheSummary,
  E2ERunReportGraderAudit,
  E2ERunReportReliability,
  E2ERunReportRunMetadata,
  E2ERunReportScenarioEntry,
  E2ERunReportReadiness,
} from './e2eRunReport';
import type { E2ERubric } from './types';

export const E2E_READINESS_DASHBOARD_VERSION = '2026-06-12.phase8';
export const E2E_READINESS_ARTIFACT_RETENTION_RUNS = 90;

type E2ERubricKind = E2ERubric['kind'];

export type E2EReadinessFailureCategory =
  | 'discovery_miss'
  | 'wrong_tool'
  | 'wrong_args'
  | 'missing_clarification'
  | 'permission_failure'
  | 'goal_state_bug'
  | 'memory_retrieval_miss'
  | 'tool_poisoning_vulnerability'
  | 'cache_prefix_drift'
  | 'token_budget_overrun'
  | 'loop_control'
  | 'native_side_effect_failure'
  | 'external_runner_required'
  | 'grader_quality'
  | 'unknown_structural_failure';

export type E2EReadinessFailureCluster = {
  category: E2EReadinessFailureCategory;
  count: number;
  scenarioIds: string[];
  failedRubricKinds: string[];
  benchmarkFamilies: E2EBenchmarkFamily[];
  assessmentDimensions: E2EAssessmentDimension[];
  externalRequirementIds: string[];
};

export type E2EReadinessEvalCandidate = {
  id: string;
  sourceScenarioId: string;
  traceFingerprint: string;
  categories: E2EReadinessFailureCategory[];
  benchmarkFamilies: E2EBenchmarkFamily[];
  assessmentDimensions: E2EAssessmentDimension[];
  failedRubricKinds: string[];
  toolCallNames: string[];
  graphStatus: string | null;
  privacy: {
    rawPromptIncluded: false;
    rawToolArgsIncluded: false;
    rawToolResultsIncluded: false;
    rawAssistantTextIncluded: false;
  };
};

export type E2EReadinessDashboardFamily = {
  id: string;
  label: string;
  passRate: number;
  pass1Rate: number;
  passKRate: number;
  p95DurationMs: number;
  p95TotalTokens: number;
  cacheEligibleReadRate: number;
  failedScenarioIds: string[];
};

export type E2EReadinessDashboardRefreshCadence = {
  sourceGroup: string;
  cadenceDays: number;
  lastReviewedAt: string;
};

export type E2EReadinessDashboard = {
  version: string;
  generatedAt: string;
  sourceRefreshDate: string;
  benchmarkManifestVersion: string;
  runMetadata: Pick<
    E2ERunReportRunMetadata,
    'gitSha' | 'provider' | 'providerId' | 'model' | 'modelVersion' | 'collectMode'
  >;
  overall: {
    passing: boolean;
    failedCriteria: string[];
    scenarioPassRate: number;
    pass1Rate: number;
    passKRate: number;
    evidenceScore: number;
  };
  familyReadiness: E2EReadinessDashboardFamily[];
  reliability: {
    k: number;
    pass1Rate: number;
    passKRate: number;
    retriedScenarioCount: number;
  };
  tokenCostLatency: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    p95ScenarioTotalTokens: number;
    p95ScenarioDurationMs: number;
    estimatedCostUsd: number | null;
    costStatus: 'provider_pricing_not_configured';
  };
  cache: {
    eligibleInputTokens: number;
    providerManagedReadinessTokens: number;
    eligibleCacheReadRate: number;
    targetEligibleCacheReadRate: number;
    providerManagedReadinessObserved: boolean;
    cacheCreateFailureCount: number;
    cacheCreateTelemetryAvailable: boolean;
    passing: boolean;
  };
  mobileNative: {
    scenarioCount: number;
    passedCount: number;
    passRate: number;
    externalRequirementIds: string[];
  };
  security: {
    benignUtilityRate: number | null;
    utilityUnderAttackRate: number | null;
    targetedAttackSuccessRate: number | null;
    status: 'external_required' | 'measured';
    externalRequirementIds: string[];
  };
  failureTaxonomy: E2EReadinessFailureCluster[];
  minedEvalCandidates: E2EReadinessEvalCandidate[];
  benchmarkRequirements: {
    implemented: number;
    externalRequired: number;
    externalRequirementIds: string[];
  };
  artifactRetention: {
    defaultRetainedRuns: number;
    artifactKinds: string[];
  };
  refreshCadence: E2EReadinessDashboardRefreshCadence[];
  humanAuditCalibration: {
    llmJudgeComponentCount: number;
    status: 'not_required_structural_graders_only' | 'required';
  };
};

export type BuildE2EReadinessDashboardParams = {
  generatedAt: string;
  runMetadata: E2ERunReportRunMetadata;
  entries: ReadonlyArray<E2ERunReportScenarioEntry>;
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
  };
  cache: E2ERunReportCacheSummary;
  graderAudit: E2ERunReportGraderAudit;
  assessment: E2EAssessmentReport;
  reliability: E2ERunReportReliability;
  readiness: E2ERunReportReadiness;
};

const RUBRIC_KINDS: ReadonlySet<E2ERubricKind> = new Set([
  'workspace_file',
  'workspace_file_absent',
  'goals_bootstrapped',
  'goal_evidence_satisfied',
  'graph_status',
  'graph_terminal_success',
  'completion_gate_hold',
  'memory_fact',
  'memory_fact_absent',
  'token_budget',
  'cache_read_tokens',
  'cache_prefix_readiness',
  'cache_eligible_read_rate',
  'min_user_turns',
  'goal_status',
  'ingestion_job_completed',
  'memory_episode_count',
  'native_fixture_state',
  'file_hash',
  'goal_criterion',
  'working_block_token',
  'graph_audit_observed',
]);

const FAILURE_CATEGORIES: ReadonlyArray<E2EReadinessFailureCategory> = [
  'discovery_miss',
  'wrong_tool',
  'wrong_args',
  'missing_clarification',
  'permission_failure',
  'goal_state_bug',
  'memory_retrieval_miss',
  'tool_poisoning_vulnerability',
  'cache_prefix_drift',
  'token_budget_overrun',
  'loop_control',
  'native_side_effect_failure',
  'external_runner_required',
  'grader_quality',
  'unknown_structural_failure',
];

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function eligibleCacheReadTokens(cacheReadTokens: number, eligibleInputTokens: number): number {
  return Math.min(Math.max(0, cacheReadTokens), Math.max(0, eligibleInputTokens));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stableFingerprint(value: unknown): string {
  const input = stableJson(value);
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => fnv1a32(input, seed))
    .join('');
}

function percentile(values: ReadonlyArray<number>, percentileRank: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function parseRubricKind(fixtureId: string): E2ERubricKind | null {
  const rawKind = fixtureId.split(':').at(-1);
  if (rawKind && RUBRIC_KINDS.has(rawKind as E2ERubricKind)) {
    return rawKind as E2ERubricKind;
  }
  return null;
}

function rubricFailureCategories(
  entry: E2ERunReportScenarioEntry,
  rubricKind: E2ERubricKind,
): E2EReadinessFailureCategory[] {
  switch (rubricKind) {
    case 'workspace_file_absent':
      if (entry.assessmentDimensions.includes('privacy_safety')) {
        return ['tool_poisoning_vulnerability'];
      }
      return ['wrong_args'];
    case 'workspace_file':
    case 'file_hash':
      if (entry.assessmentDimensions.includes('privacy_safety')) {
        return ['permission_failure'];
      }
      if (entry.assessmentDimensions.includes('mobile_native')) {
        return ['native_side_effect_failure'];
      }
      return ['wrong_args'];
    case 'native_fixture_state':
      if (entry.assessmentDimensions.includes('privacy_safety')) {
        return ['permission_failure'];
      }
      return ['native_side_effect_failure'];
    case 'goal_evidence_satisfied':
    case 'graph_status':
    case 'graph_terminal_success':
    case 'completion_gate_hold':
    case 'goal_status':
    case 'goal_criterion':
    case 'goals_bootstrapped':
    case 'graph_audit_observed':
      return ['goal_state_bug'];
    case 'memory_fact':
    case 'memory_fact_absent':
    case 'memory_episode_count':
    case 'ingestion_job_completed':
    case 'working_block_token':
      return ['memory_retrieval_miss'];
    case 'cache_read_tokens':
    case 'cache_prefix_readiness':
    case 'cache_eligible_read_rate':
      return ['cache_prefix_drift'];
    case 'token_budget':
      return ['token_budget_overrun'];
    case 'min_user_turns':
      return ['missing_clarification'];
  }
}

function inferFailureCategories(
  entry: E2ERunReportScenarioEntry,
  cacheTargetEligibleReadRate: number,
): E2EReadinessFailureCategory[] {
  const categories = new Set<E2EReadinessFailureCategory>();

  for (const failure of entry.failedRubrics ?? []) {
    const rubricKind = parseRubricKind(failure.fixtureId);
    if (!rubricKind) {
      categories.add('unknown_structural_failure');
      continue;
    }
    for (const category of rubricFailureCategories(entry, rubricKind)) {
      categories.add(category);
    }
  }

  if (!entry.loopDiagnostics.passing) {
    categories.add('loop_control');
  }
  if (
    entry.cache?.eligible &&
    (entry.cache.providerManagedReadinessTokens ?? 0) === 0 &&
    entry.cache.eligibleCacheReadRate < cacheTargetEligibleReadRate
  ) {
    categories.add('cache_prefix_drift');
  }
  if (
    entry.rubricAudit.assistantProseRubricCount > 0 ||
    entry.rubricAudit.weakPatternRubricCount > 0
  ) {
    categories.add('grader_quality');
  }
  if (!entry.passed && categories.size === 0) {
    categories.add('unknown_structural_failure');
  }

  return Array.from(categories).sort();
}

function buildFailureTaxonomy(params: {
  entries: ReadonlyArray<E2ERunReportScenarioEntry>;
  cacheTargetEligibleReadRate: number;
  externalRequirements: ReadonlyArray<E2EBenchmarkRequirement>;
}): E2EReadinessFailureCluster[] {
  const clusters = new Map<
    E2EReadinessFailureCategory,
    {
      scenarioIds: Set<string>;
      failedRubricKinds: Set<string>;
      benchmarkFamilies: Set<E2EBenchmarkFamily>;
      assessmentDimensions: Set<E2EAssessmentDimension>;
      externalRequirementIds: Set<string>;
    }
  >();

  for (const category of FAILURE_CATEGORIES) {
    clusters.set(category, {
      scenarioIds: new Set(),
      failedRubricKinds: new Set(),
      benchmarkFamilies: new Set(),
      assessmentDimensions: new Set(),
      externalRequirementIds: new Set(),
    });
  }

  for (const entry of params.entries) {
    const categories = inferFailureCategories(entry, params.cacheTargetEligibleReadRate);
    const failedRubricKinds = (entry.failedRubrics ?? [])
      .map((failure) => parseRubricKind(failure.fixtureId))
      .filter((kind): kind is E2ERubricKind => Boolean(kind));

    for (const category of categories) {
      const cluster = clusters.get(category)!;
      cluster.scenarioIds.add(entry.fixtureId);
      for (const rubricKind of failedRubricKinds) {
        cluster.failedRubricKinds.add(rubricKind);
      }
      for (const family of entry.benchmarkFamilies) {
        cluster.benchmarkFamilies.add(family);
      }
      for (const dimension of entry.assessmentDimensions) {
        cluster.assessmentDimensions.add(dimension);
      }
    }
  }

  const externalRunnerCluster = clusters.get('external_runner_required')!;
  for (const requirement of params.externalRequirements) {
    externalRunnerCluster.externalRequirementIds.add(requirement.id);
  }

  return FAILURE_CATEGORIES.map((category) => {
    const cluster = clusters.get(category)!;
    return {
      category,
      count: cluster.scenarioIds.size + cluster.externalRequirementIds.size,
      scenarioIds: Array.from(cluster.scenarioIds).sort(),
      failedRubricKinds: Array.from(cluster.failedRubricKinds).sort(),
      benchmarkFamilies: Array.from(cluster.benchmarkFamilies).sort(),
      assessmentDimensions: Array.from(cluster.assessmentDimensions).sort(),
      externalRequirementIds: Array.from(cluster.externalRequirementIds).sort(),
    };
  });
}

function buildMinedEvalCandidates(params: {
  entries: ReadonlyArray<E2ERunReportScenarioEntry>;
  cacheTargetEligibleReadRate: number;
}): E2EReadinessEvalCandidate[] {
  const candidates: E2EReadinessEvalCandidate[] = [];

  for (const entry of params.entries) {
    const categories = inferFailureCategories(entry, params.cacheTargetEligibleReadRate);
    if (categories.length === 0) {
      continue;
    }
    const failedRubricKinds = (entry.failedRubrics ?? [])
      .map((failure) => parseRubricKind(failure.fixtureId))
      .filter((kind): kind is E2ERubricKind => Boolean(kind))
      .sort();
    const toolCallNames = Array.from(
      new Set(entry.loopDiagnostics.repeatedToolCalls.map((call) => call.name)),
    ).sort();
    const traceFingerprint = stableFingerprint({
      fixtureId: entry.fixtureId,
      graphStatus: entry.graphStatus,
      categories,
      failedRubricKinds,
      toolCallNames,
      benchmarkFamilies: entry.benchmarkFamilies,
      assessmentDimensions: entry.assessmentDimensions,
    });
    candidates.push({
      id: `candidate:${entry.fixtureId}:${traceFingerprint}`,
      sourceScenarioId: entry.fixtureId,
      traceFingerprint,
      categories,
      benchmarkFamilies: [...entry.benchmarkFamilies].sort(),
      assessmentDimensions: [...entry.assessmentDimensions].sort(),
      failedRubricKinds,
      toolCallNames,
      graphStatus: entry.graphStatus,
      privacy: {
        rawPromptIncluded: false,
        rawToolArgsIncluded: false,
        rawToolResultsIncluded: false,
        rawAssistantTextIncluded: false,
      },
    });
  }

  return candidates;
}

function familyEntries(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  family: E2EAssessmentAxisSummary,
): E2ERunReportScenarioEntry[] {
  const scenarioIds = new Set(family.scenarioIds);
  return entries.filter((entry) => scenarioIds.has(entry.fixtureId));
}

function buildFamilyReadiness(params: {
  entries: ReadonlyArray<E2ERunReportScenarioEntry>;
  assessment: E2EAssessmentReport;
  reliability: E2ERunReportReliability;
}): E2EReadinessDashboardFamily[] {
  const reliabilityByScenario = new Map(
    params.reliability.scenarios.map((scenario) => [scenario.fixtureId, scenario]),
  );

  return params.assessment.benchmarkFamilies.map((family) => {
    const entries = familyEntries(params.entries, family);
    const pass1Count = entries.filter(
      (entry) => reliabilityByScenario.get(entry.fixtureId)?.passAt1,
    ).length;
    const passKCount = entries.filter(
      (entry) => reliabilityByScenario.get(entry.fixtureId)?.passAtK,
    ).length;
    const eligibleInputTokens = entries.reduce(
      (sum, entry) => sum + entry.cache.eligibleInputTokens,
      0,
    );
    const eligibleReadTokens = entries.reduce(
      (sum, entry) =>
        sum + eligibleCacheReadTokens(entry.cache.cacheReadTokens, entry.cache.eligibleInputTokens),
      0,
    );

    return {
      id: family.id,
      label: family.label,
      passRate: family.passRate,
      pass1Rate: safeRate(pass1Count, entries.length),
      passKRate: safeRate(passKCount, entries.length),
      p95DurationMs: percentile(
        entries.map((entry) => entry.durationMs),
        95,
      ),
      p95TotalTokens: percentile(
        entries.map((entry) => entry.usage.totalTokens),
        95,
      ),
      cacheEligibleReadRate: safeRate(eligibleReadTokens, eligibleInputTokens),
      failedScenarioIds: [...family.failedScenarioIds],
    };
  });
}

function externalRequirementsBySource(
  requirements: ReadonlyArray<E2EBenchmarkRequirement>,
  sourceNeedles: ReadonlyArray<string>,
): string[] {
  const normalizedNeedles = sourceNeedles.map((needle) => needle.toLowerCase());
  return requirements
    .filter(
      (requirement) =>
        requirement.coverageStatus === 'external_required' &&
        normalizedNeedles.some((needle) => requirement.source.toLowerCase().includes(needle)),
    )
    .map((requirement) => requirement.id)
    .sort();
}

function buildMobileNativeSummary(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  externalRequirements: ReadonlyArray<E2EBenchmarkRequirement>,
): E2EReadinessDashboard['mobileNative'] {
  const mobileEntries = entries.filter((entry) =>
    entry.assessmentDimensions.includes('mobile_native'),
  );
  return {
    scenarioCount: mobileEntries.length,
    passedCount: mobileEntries.filter((entry) => entry.passed).length,
    passRate: safeRate(mobileEntries.filter((entry) => entry.passed).length, mobileEntries.length),
    externalRequirementIds: externalRequirementsBySource(externalRequirements, [
      'androidworld',
      'mobileagentbench',
      'simuwob',
    ]),
  };
}

function buildSecuritySummary(
  externalRequirements: ReadonlyArray<E2EBenchmarkRequirement>,
): E2EReadinessDashboard['security'] {
  const externalRequirementIds = externalRequirementsBySource(externalRequirements, [
    'agentdojo',
    'mcptox',
  ]);
  return {
    benignUtilityRate: null,
    utilityUnderAttackRate: null,
    targetedAttackSuccessRate: null,
    status: externalRequirementIds.length > 0 ? 'external_required' : 'measured',
    externalRequirementIds,
  };
}

export function buildE2EReadinessDashboard(
  params: BuildE2EReadinessDashboardParams,
): E2EReadinessDashboard {
  const requirements = listE2EBenchmarkRequirements();
  const externalRequirements = requirements.filter(
    (requirement) => requirement.coverageStatus === 'external_required',
  );
  const manifestAudit = auditE2EBenchmarkManifests(undefined, requirements);
  const scenarioTokenTotals = params.entries.map((entry) => entry.usage.totalTokens);
  const scenarioDurations = params.entries.map((entry) => entry.durationMs);

  return {
    version: E2E_READINESS_DASHBOARD_VERSION,
    generatedAt: params.generatedAt,
    sourceRefreshDate: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
    benchmarkManifestVersion: E2E_BENCHMARK_MANIFEST_VERSION,
    runMetadata: {
      gitSha: params.runMetadata.gitSha,
      provider: params.runMetadata.provider,
      ...(params.runMetadata.providerId ? { providerId: params.runMetadata.providerId } : {}),
      model: params.runMetadata.model,
      ...(params.runMetadata.modelVersion ? { modelVersion: params.runMetadata.modelVersion } : {}),
      collectMode: params.runMetadata.collectMode,
    },
    overall: {
      passing: params.readiness.passing && manifestAudit.passing,
      failedCriteria: [
        ...params.readiness.failedCriteria,
        ...(manifestAudit.passing ? [] : ['benchmark_manifest_audit']),
      ],
      scenarioPassRate: params.readiness.scenarioPassRate,
      pass1Rate: params.readiness.pass1Rate,
      passKRate: params.readiness.passKRate,
      evidenceScore: params.assessment.evidenceScore,
    },
    familyReadiness: buildFamilyReadiness({
      entries: params.entries,
      assessment: params.assessment,
      reliability: params.reliability,
    }),
    reliability: {
      k: params.reliability.k,
      pass1Rate: params.reliability.pass1Rate,
      passKRate: params.reliability.passKRate,
      retriedScenarioCount: params.reliability.retriedScenarioCount,
    },
    tokenCostLatency: {
      inputTokens: params.totals.inputTokens,
      outputTokens: params.totals.outputTokens,
      totalTokens: params.totals.totalTokens,
      p95ScenarioTotalTokens: percentile(scenarioTokenTotals, 95),
      p95ScenarioDurationMs: percentile(scenarioDurations, 95),
      estimatedCostUsd: null,
      costStatus: 'provider_pricing_not_configured',
    },
    cache: {
      eligibleInputTokens: params.cache.eligibleInputTokens,
      providerManagedReadinessTokens: params.cache.providerManagedReadinessTokens,
      eligibleCacheReadRate: params.cache.eligibleCacheReadRate,
      targetEligibleCacheReadRate: params.cache.targetEligibleCacheReadRate,
      providerManagedReadinessObserved: params.cache.providerManagedReadinessObserved,
      cacheCreateFailureCount: params.cache.cacheCreateFailureCount,
      cacheCreateTelemetryAvailable: params.cache.cacheCreateTelemetryAvailable,
      passing: params.cache.passing,
    },
    mobileNative: buildMobileNativeSummary(params.entries, externalRequirements),
    security: buildSecuritySummary(externalRequirements),
    failureTaxonomy: buildFailureTaxonomy({
      entries: params.entries,
      cacheTargetEligibleReadRate: params.cache.targetEligibleCacheReadRate,
      externalRequirements,
    }),
    minedEvalCandidates: buildMinedEvalCandidates({
      entries: params.entries,
      cacheTargetEligibleReadRate: params.cache.targetEligibleCacheReadRate,
    }),
    benchmarkRequirements: {
      implemented: manifestAudit.implementedRequirementCount,
      externalRequired: manifestAudit.externalRequirementCount,
      externalRequirementIds: externalRequirements.map((requirement) => requirement.id).sort(),
    },
    artifactRetention: {
      defaultRetainedRuns: E2E_READINESS_ARTIFACT_RETENTION_RUNS,
      artifactKinds: ['run_report', 'readiness_dashboard', 'stdout_stderr_log'],
    },
    refreshCadence: [
      {
        sourceGroup: 'provider_docs',
        cadenceDays: 30,
        lastReviewedAt: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
      },
      {
        sourceGroup: 'bfcl_tau_agentdojo_security',
        cadenceDays: 90,
        lastReviewedAt: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
      },
      {
        sourceGroup: 'mobile_benchmarks',
        cadenceDays: 90,
        lastReviewedAt: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
      },
    ],
    humanAuditCalibration: {
      llmJudgeComponentCount:
        params.graderAudit.assistantProseRubricCount + params.graderAudit.weakPatternRubricCount,
      status:
        params.graderAudit.assistantProseRubricCount === 0 &&
        params.graderAudit.weakPatternRubricCount === 0
          ? 'not_required_structural_graders_only'
          : 'required',
    },
  };
}

export function formatE2EReadinessDashboardSummary(dashboard: E2EReadinessDashboard): string {
  return [
    `[e2e-readiness-dashboard] passing=${dashboard.overall.passing} failedCriteria=${dashboard.overall.failedCriteria.join(',') || 'none'}`,
    `[e2e-readiness-dashboard] passRate=${dashboard.overall.scenarioPassRate.toFixed(3)} pass1=${dashboard.overall.pass1Rate.toFixed(3)} pass^${dashboard.reliability.k}=${dashboard.overall.passKRate.toFixed(3)} evidence=${dashboard.overall.evidenceScore.toFixed(3)}`,
    `[e2e-readiness-dashboard] tokens total=${dashboard.tokenCostLatency.totalTokens} p95ScenarioTokens=${dashboard.tokenCostLatency.p95ScenarioTotalTokens} p95DurationMs=${dashboard.tokenCostLatency.p95ScenarioDurationMs}`,
    `[e2e-readiness-dashboard] cache eligibleRate=${dashboard.cache.eligibleCacheReadRate.toFixed(3)} target=${dashboard.cache.targetEligibleCacheReadRate.toFixed(3)} providerManagedReadinessTokens=${dashboard.cache.providerManagedReadinessTokens} passing=${dashboard.cache.passing}`,
    `[e2e-readiness-dashboard] mobile pass=${dashboard.mobileNative.passedCount}/${dashboard.mobileNative.scenarioCount} security=${dashboard.security.status} externalRequirements=${dashboard.benchmarkRequirements.externalRequired}`,
    `[e2e-readiness-dashboard] minedEvalCandidates=${dashboard.minedEvalCandidates.length}`,
  ].join('\n');
}
