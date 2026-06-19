import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import type { E2EBenchmarkRequirement } from './e2eBenchmarkManifest';
import type { E2EBenchmarkFamily } from './e2eBenchmarkRegistry';
import type {
  E2EReadinessEvalCandidate,
  E2EReadinessFailureCategory,
  E2EReadinessFailureCluster,
} from './e2eReadinessDashboard';
import type { E2ERunReportScenarioEntry } from './e2eRunReport';
import type { E2ERubric } from './types';

type E2ERubricKind = E2ERubric['kind'];

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

export function buildFailureTaxonomy(params: {
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

export function buildMinedEvalCandidates(params: {
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
