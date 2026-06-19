const {
  EXTERNAL_BENCHMARK_REQUIREMENTS,
  FAILURE_CATEGORIES,
  RUBRIC_KINDS,
} = require('./constants');

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a32(input, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stableFingerprint(value) {
  const input = stableJson(value);
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => fnv1a32(input, seed))
    .join('');
}

function parseRubricKind(fixtureId) {
  const rawKind = String(fixtureId ?? '')
    .split(':')
    .pop();
  return RUBRIC_KINDS.has(rawKind) ? rawKind : null;
}

function rubricFailureCategories(entry, rubricKind) {
  switch (rubricKind) {
    case 'workspace_file':
    case 'file_hash':
    case 'json_field':
      if (entry.assessmentDimensions.includes('privacy_safety')) {
        return ['permission_failure'];
      }
      if (entry.assessmentDimensions.includes('mobile_native')) {
        return ['native_side_effect_failure'];
      }
      return ['wrong_args'];
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
    case 'memory_episode_count':
    case 'ingestion_job_completed':
    case 'working_block_token':
      return ['memory_retrieval_miss'];
    case 'cache_read_tokens':
      return ['cache_prefix_drift'];
    case 'token_budget':
      return ['token_budget_overrun'];
    case 'min_user_turns':
      return ['missing_clarification'];
    default:
      return ['unknown_structural_failure'];
  }
}

function inferFailureCategories(entry, cacheTargetEligibleReadRate) {
  const categories = new Set();

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

  if (!entry.loopDiagnostics?.passing) {
    categories.add('loop_control');
  }
  if (entry.cache?.eligible && entry.cache.eligibleCacheReadRate < cacheTargetEligibleReadRate) {
    categories.add('cache_prefix_drift');
  }
  if (
    (entry.rubricAudit?.assistantProseRubricCount ?? 0) > 0 ||
    (entry.rubricAudit?.weakPatternRubricCount ?? 0) > 0
  ) {
    categories.add('grader_quality');
  }
  if (!entry.passed && categories.size === 0) {
    categories.add('unknown_structural_failure');
  }

  return Array.from(categories).sort();
}

function buildFailureTaxonomy(entries, cacheTargetEligibleReadRate) {
  const clusters = new Map(
    FAILURE_CATEGORIES.map((category) => [
      category,
      {
        scenarioIds: new Set(),
        failedRubricKinds: new Set(),
        benchmarkFamilies: new Set(),
        assessmentDimensions: new Set(),
        externalRequirementIds: new Set(),
      },
    ]),
  );

  for (const entry of entries) {
    const categories = inferFailureCategories(entry, cacheTargetEligibleReadRate);
    const failedRubricKinds = (entry.failedRubrics ?? [])
      .map((failure) => parseRubricKind(failure.fixtureId))
      .filter(Boolean);
    for (const category of categories) {
      const cluster = clusters.get(category);
      cluster.scenarioIds.add(entry.fixtureId);
      for (const rubricKind of failedRubricKinds) {
        cluster.failedRubricKinds.add(rubricKind);
      }
      for (const family of entry.benchmarkFamilies ?? []) {
        cluster.benchmarkFamilies.add(family);
      }
      for (const dimension of entry.assessmentDimensions ?? []) {
        cluster.assessmentDimensions.add(dimension);
      }
    }
  }

  const externalRunnerCluster = clusters.get('external_runner_required');
  for (const requirement of EXTERNAL_BENCHMARK_REQUIREMENTS) {
    externalRunnerCluster.externalRequirementIds.add(requirement.id);
  }

  return FAILURE_CATEGORIES.map((category) => {
    const cluster = clusters.get(category);
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

function buildMinedEvalCandidates(entries, cacheTargetEligibleReadRate) {
  return entries
    .map((entry) => {
      const categories = inferFailureCategories(entry, cacheTargetEligibleReadRate);
      if (categories.length === 0) {
        return null;
      }
      const failedRubricKinds = (entry.failedRubrics ?? [])
        .map((failure) => parseRubricKind(failure.fixtureId))
        .filter(Boolean)
        .sort();
      const toolCallNames = Array.from(
        new Set((entry.loopDiagnostics?.repeatedToolCalls ?? []).map((call) => call.name)),
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
      return {
        id: `candidate:${entry.fixtureId}:${traceFingerprint}`,
        sourceScenarioId: entry.fixtureId,
        traceFingerprint,
        categories,
        benchmarkFamilies: [...(entry.benchmarkFamilies ?? [])].sort(),
        assessmentDimensions: [...(entry.assessmentDimensions ?? [])].sort(),
        failedRubricKinds,
        toolCallNames,
        graphStatus: entry.graphStatus ?? null,
        privacy: {
          rawPromptIncluded: false,
          rawToolArgsIncluded: false,
          rawToolResultsIncluded: false,
          rawAssistantTextIncluded: false,
        },
      };
    })
    .filter(Boolean);
}

module.exports = {
  stableJson,
  stableFingerprint,
  parseRubricKind,
  rubricFailureCategories,
  inferFailureCategories,
  buildFailureTaxonomy,
  buildMinedEvalCandidates,
};
