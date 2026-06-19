// ---------------------------------------------------------------------------
// Benchmark-grade E2E manifests
// ---------------------------------------------------------------------------
// Manifests are derived from structural scenarios and benchmark lineage. They
// intentionally avoid target tool lists so assessments stay result-driven.
// ---------------------------------------------------------------------------

import { DELEGATION_E2E_SCENARIOS, E2E_AGENT_SCENARIOS } from './scenarios';
import {
  E2E_BENCHMARK_FAMILY_META,
  lookupE2EScenarioBenchmarkMeta,
  type E2EBenchmarkFamily,
} from './e2eBenchmarkRegistry';
import { listE2EBenchmarkRequirements } from './e2eBenchmarkRequirements';
import {
  E2E_DEFAULT_MAX_TOKENS,
  E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
  E2E_SCENARIO_MANIFEST_VERSION,
  E2E_SCENARIO_TOKEN_BUDGETS,
} from './thresholds';
import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import type { E2ERubric, E2EScenario } from './types';

export const E2E_BENCHMARK_MANIFEST_VERSION = '2026-06-14.long-run-direct-shards';
export const E2E_BENCHMARK_SOURCE_REFRESH_DATE = '2026-06-14';

type E2ERubricKind = E2ERubric['kind'];

export type E2EBenchmarkCoverageStatus = 'implemented' | 'external_required';

export type E2EBenchmarkEnvironmentKind =
  | 'node_fixture'
  | 'native_fixture'
  | 'android_emulator'
  | 'mobile_gui'
  | 'simulated_mobile_web'
  | 'provider_matrix'
  | 'security_fixture';

export type E2EBenchmarkStructuralEvidenceKind =
  | 'graph_state'
  | 'workspace_artifact'
  | 'artifact_hash'
  | 'memory_store'
  | 'native_fixture_state'
  | 'token_accounting'
  | 'cache_event';

export type E2EBenchmarkEvaluatorKind = 'final_state' | 'trajectory' | 'resource_budget';

export type E2EBenchmarkProviderMatrixEntry = {
  providerFamily: 'gemini' | 'openai' | 'anthropic' | 'openai_compatible' | 'local_mock';
  role: 'default' | 'comparison' | 'ci_deterministic';
  requiredForReleaseGate: boolean;
};

export type E2EBenchmarkRubricEvaluator = {
  rubricKind: E2ERubricKind;
  evaluatorKind: E2EBenchmarkEvaluatorKind;
  evidenceKind: E2EBenchmarkStructuralEvidenceKind;
  fingerprint: string;
};

export type E2EBenchmarkExternalRequirement = {
  environmentKind: E2EBenchmarkEnvironmentKind;
  reason: string;
};

export type E2EBenchmarkManifest = {
  id: string;
  scenarioId: string;
  version: string;
  sourceRefreshDate: string;
  scenarioManifestVersion: string;
  benchmarkFamilies: ReadonlyArray<E2EBenchmarkFamily>;
  benchmarkReferences: ReadonlyArray<string>;
  assessmentDimensions: ReadonlyArray<E2EAssessmentDimension>;
  seed: string;
  environmentKind: E2EBenchmarkEnvironmentKind;
  initialState: {
    conversationId: string;
    userTurnCount: number;
    nativeFixtureRequired: boolean;
  };
  hiddenGroundTruth: {
    visibleToAgent: false;
    fingerprintAlgorithm: 'stable-fnv1a-256';
    fingerprint: string;
  };
  finalStateEvaluators: ReadonlyArray<E2EBenchmarkRubricEvaluator>;
  trajectoryEvaluators: ReadonlyArray<E2EBenchmarkRubricEvaluator>;
  resourceBudgetEvaluators: ReadonlyArray<E2EBenchmarkRubricEvaluator>;
  tokenBudget: {
    maxTotalTokens: number;
    cacheEligibleInputThreshold: number;
    targetEligibleCacheReadRate: number;
  };
  reset: {
    required: true;
    procedure: ReadonlyArray<string>;
  };
  traceRequirements: {
    modelProviderAndVersion: true;
    promptSectionsAndTokenBuckets: true;
    toolSurfacePerTurn: true;
    toolCallsAndResults: true;
    graphStateHoldsAndResolutions: true;
    cacheEligibilityAndEvents: true;
    nativePermissionState: boolean;
    uiTreeAndScreenshots: boolean;
  };
  providerMatrix: ReadonlyArray<E2EBenchmarkProviderMatrixEntry>;
  externalRequirements: ReadonlyArray<E2EBenchmarkExternalRequirement>;
};

export type E2EBenchmarkRequirement = {
  id: string;
  source: string;
  objective: string;
  coverageStatus: E2EBenchmarkCoverageStatus;
  scenarioIds: ReadonlyArray<string>;
  environmentKinds: ReadonlyArray<E2EBenchmarkEnvironmentKind>;
  requiredEvidence: ReadonlyArray<E2EBenchmarkStructuralEvidenceKind>;
};

export type E2EBenchmarkManifestAuditIssue = {
  severity: 'error' | 'warning';
  code: string;
  detail: string;
  manifestId?: string;
  requirementId?: string;
};

export type E2EBenchmarkManifestAudit = {
  manifestCount: number;
  requirementCount: number;
  implementedRequirementCount: number;
  externalRequirementCount: number;
  sourceRefreshDate: string;
  issues: E2EBenchmarkManifestAuditIssue[];
  passing: boolean;
};

const PROVIDER_MATRIX: ReadonlyArray<E2EBenchmarkProviderMatrixEntry> = [
  { providerFamily: 'gemini', role: 'default', requiredForReleaseGate: true },
  { providerFamily: 'openai', role: 'comparison', requiredForReleaseGate: false },
  { providerFamily: 'anthropic', role: 'comparison', requiredForReleaseGate: false },
  { providerFamily: 'openai_compatible', role: 'comparison', requiredForReleaseGate: false },
  { providerFamily: 'local_mock', role: 'ci_deterministic', requiredForReleaseGate: true },
];

const FINAL_STATE_RUBRICS: ReadonlySet<E2ERubricKind> = new Set([
  'workspace_file',
  'workspace_file_absent',
  'file_hash',
  'goal_evidence_satisfied',
  'graph_status',
  'graph_terminal_success',
  'memory_fact',
  'memory_fact_absent',
  'goal_status',
  'native_fixture_state',
  'goal_criterion',
  'working_block_token',
]);

const TRAJECTORY_RUBRICS: ReadonlySet<E2ERubricKind> = new Set([
  'goals_bootstrapped',
  'completion_gate_hold',
  'min_user_turns',
  'ingestion_job_completed',
  'memory_episode_count',
  'cache_read_tokens',
  'cache_prefix_readiness',
  'cache_eligible_read_rate',
]);

const RESOURCE_BUDGET_RUBRICS: ReadonlySet<E2ERubricKind> = new Set(['token_budget']);

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

function hashJson(value: unknown): string {
  const input = stableJson(value);
  return [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ]
    .map((seed) => fnv1a32(input, seed))
    .join('');
}

function buildSeed(scenarioId: string): string {
  return hashJson({
    scenarioId,
    version: E2E_BENCHMARK_MANIFEST_VERSION,
  }).slice(0, 16);
}

function structuralEvidenceKindForRubric(rubric: E2ERubric): E2EBenchmarkStructuralEvidenceKind {
  switch (rubric.kind) {
    case 'workspace_file':
    case 'workspace_file_absent':
      return 'workspace_artifact';
    case 'file_hash':
      return 'artifact_hash';
    case 'native_fixture_state':
      return 'native_fixture_state';
    case 'memory_fact':
    case 'memory_fact_absent':
    case 'memory_episode_count':
    case 'ingestion_job_completed':
    case 'working_block_token':
      return 'memory_store';
    case 'token_budget':
      return 'token_accounting';
    case 'cache_read_tokens':
    case 'cache_prefix_readiness':
    case 'cache_eligible_read_rate':
      return 'cache_event';
    case 'goals_bootstrapped':
    case 'goal_evidence_satisfied':
    case 'graph_status':
    case 'graph_terminal_success':
    case 'completion_gate_hold':
    case 'min_user_turns':
    case 'goal_status':
    case 'goal_criterion':
    case 'graph_audit_observed':
      return 'graph_state';
  }
}

function rubricEvaluator(
  rubric: E2ERubric,
  evaluatorKind: E2EBenchmarkEvaluatorKind,
): E2EBenchmarkRubricEvaluator {
  return {
    rubricKind: rubric.kind,
    evaluatorKind,
    evidenceKind: structuralEvidenceKindForRubric(rubric),
    fingerprint: hashJson(rubric),
  };
}

function resolveEnvironmentKind(
  families: ReadonlyArray<E2EBenchmarkFamily>,
  dimensions: ReadonlyArray<E2EAssessmentDimension>,
): E2EBenchmarkEnvironmentKind {
  if (
    dimensions.includes('mobile_native') ||
    families.includes('androidworld-adapted') ||
    families.includes('androidworld-direct')
  ) {
    return 'native_fixture';
  }
  return 'node_fixture';
}

function resolveExternalRequirements(
  families: ReadonlyArray<E2EBenchmarkFamily>,
): E2EBenchmarkExternalRequirement[] {
  const requirements: E2EBenchmarkExternalRequirement[] = [];
  if (families.includes('androidworld-adapted') || families.includes('androidworld-direct')) {
    requirements.push({
      environmentKind: 'android_emulator',
      reason: 'Physical AndroidWorld parity requires emulator/device app-state execution.',
    });
  }
  if (families.includes('mobile-agent-bench-adapted') || families.includes('spa-bench-direct')) {
    requirements.push({
      environmentKind: 'mobile_gui',
      reason: 'Mobile GUI benchmark parity requires Accessibility/UI tree and screenshot capture.',
    });
  }
  if (families.includes('mobileworld-adapted') || families.includes('mobileworld-direct')) {
    requirements.push({
      environmentKind: 'mobile_gui',
      reason: 'MobileWorld parity requires GUI/user-interaction/MCP task execution.',
    });
  }
  if (families.includes('knowu-bench-adapted')) {
    requirements.push({
      environmentKind: 'android_emulator',
      reason: 'KnowU-Bench parity requires hidden-profile personalized mobile tasks.',
    });
  }
  if (families.includes('longmemeval-v2-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason: 'LongMemEval-V2 parity requires full long-history haystacks and latency scoring.',
    });
  }
  if (families.includes('bfcl-v4-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason: 'BFCL V4 parity requires the upstream executable leaderboard suite.',
    });
  }
  if (families.includes('tau-bench-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason: 'τ-bench parity requires the upstream user simulator, policy, and domain state.',
    });
  }
  if (families.includes('toolsandbox-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason: 'ToolSandbox parity requires the upstream stateful simulator and milestone scoring.',
    });
  }
  if (families.includes('agentdojo-direct')) {
    requirements.push({
      environmentKind: 'security_fixture',
      reason: 'AgentDojo parity requires the upstream task suite and attack/defense runtime.',
    });
  }
  if (families.includes('locomo-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason:
        'LoCoMo parity requires full long conversation histories, temporal QA, and human-labeled memory scoring.',
    });
  }
  if (families.includes('beam-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason:
        'BEAM parity requires long coherent interaction traces and full memory probe scoring beyond the fast-suite envelope.',
    });
  }
  if (families.includes('provider-prompt-cache-direct')) {
    requirements.push({
      environmentKind: 'provider_matrix',
      reason:
        'Prompt-cache parity requires provider-family runs because cache thresholds, routing, and read/write telemetry are provider-specific.',
    });
  }
  return requirements;
}

function resolveTokenBudget(scenario: E2EScenario): number {
  const rubricBudget = scenario.rubrics.find(
    (rubric): rubric is Extract<E2ERubric, { kind: 'token_budget' }> =>
      rubric.kind === 'token_budget',
  )?.maxTotalTokens;
  return (
    rubricBudget ??
    E2E_SCENARIO_TOKEN_BUDGETS[scenario.id] ??
    scenario.maxTokens ??
    E2E_DEFAULT_MAX_TOKENS
  );
}

function resetProcedureForManifest(
  environmentKind: E2EBenchmarkEnvironmentKind,
): ReadonlyArray<string> {
  if (environmentKind === 'native_fixture') {
    return [
      'reset deterministic native fixture state',
      'reset conversation graph state',
      'reset workspace and memory stores for fixture conversation',
    ];
  }
  return [
    'reset conversation graph state',
    'reset workspace and memory stores for fixture conversation',
  ];
}

export function buildE2EBenchmarkManifest(scenario: E2EScenario): E2EBenchmarkManifest {
  const benchmarkMeta = lookupE2EScenarioBenchmarkMeta(scenario.id);
  const environmentKind = resolveEnvironmentKind(
    benchmarkMeta.benchmarkFamilies,
    benchmarkMeta.assessmentDimensions,
  );
  const finalStateEvaluators = scenario.rubrics
    .filter((rubric) => FINAL_STATE_RUBRICS.has(rubric.kind))
    .map((rubric) => rubricEvaluator(rubric, 'final_state'));
  const trajectoryEvaluators = scenario.rubrics
    .filter((rubric) => TRAJECTORY_RUBRICS.has(rubric.kind))
    .map((rubric) => rubricEvaluator(rubric, 'trajectory'));
  const resourceBudgetEvaluators = scenario.rubrics
    .filter((rubric) => RESOURCE_BUDGET_RUBRICS.has(rubric.kind))
    .map((rubric) => rubricEvaluator(rubric, 'resource_budget'));

  return {
    id: `benchmark:${scenario.id}`,
    scenarioId: scenario.id,
    version: E2E_BENCHMARK_MANIFEST_VERSION,
    sourceRefreshDate: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
    scenarioManifestVersion: E2E_SCENARIO_MANIFEST_VERSION,
    benchmarkFamilies: [...benchmarkMeta.benchmarkFamilies],
    benchmarkReferences: benchmarkMeta.benchmarkFamilies.map(
      (family) => E2E_BENCHMARK_FAMILY_META[family].externalReference,
    ),
    assessmentDimensions: [...benchmarkMeta.assessmentDimensions],
    seed: buildSeed(scenario.id),
    environmentKind,
    initialState: {
      conversationId: scenario.conversationId,
      userTurnCount: scenario.userTurns?.length ?? 1,
      nativeFixtureRequired: environmentKind === 'native_fixture',
    },
    hiddenGroundTruth: {
      visibleToAgent: false,
      fingerprintAlgorithm: 'stable-fnv1a-256',
      fingerprint: hashJson({
        rubrics: scenario.rubrics,
        initialWorkspaceFiles: scenario.initialWorkspaceFiles ?? [],
      }),
    },
    finalStateEvaluators,
    trajectoryEvaluators,
    resourceBudgetEvaluators,
    tokenBudget: {
      maxTotalTokens: resolveTokenBudget(scenario),
      cacheEligibleInputThreshold: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
      targetEligibleCacheReadRate: E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
    },
    reset: {
      required: true,
      procedure: resetProcedureForManifest(environmentKind),
    },
    traceRequirements: {
      modelProviderAndVersion: true,
      promptSectionsAndTokenBuckets: true,
      toolSurfacePerTurn: true,
      toolCallsAndResults: true,
      graphStateHoldsAndResolutions: true,
      cacheEligibilityAndEvents: true,
      nativePermissionState: environmentKind === 'native_fixture',
      uiTreeAndScreenshots:
        benchmarkMeta.benchmarkFamilies.includes('mobile-agent-bench-adapted') ||
        benchmarkMeta.benchmarkFamilies.includes('mobileworld-adapted') ||
        benchmarkMeta.benchmarkFamilies.includes('knowu-bench-adapted') ||
        benchmarkMeta.benchmarkFamilies.includes('mobileworld-direct') ||
        benchmarkMeta.benchmarkFamilies.includes('spa-bench-direct'),
    },
    providerMatrix: PROVIDER_MATRIX,
    externalRequirements: resolveExternalRequirements(benchmarkMeta.benchmarkFamilies),
  };
}

export function listE2EBenchmarkManifests(): E2EBenchmarkManifest[] {
  return [...E2E_AGENT_SCENARIOS, ...DELEGATION_E2E_SCENARIOS].map(buildE2EBenchmarkManifest);
}

export { listE2EBenchmarkRequirements };
function auditRequirement(
  requirement: E2EBenchmarkRequirement,
  manifestIds: ReadonlySet<string>,
): E2EBenchmarkManifestAuditIssue[] {
  const issues: E2EBenchmarkManifestAuditIssue[] = [];
  if (requirement.coverageStatus === 'implemented' && requirement.scenarioIds.length === 0) {
    issues.push({
      severity: 'error',
      code: 'implemented_requirement_without_scenarios',
      detail: 'Implemented benchmark requirements must name concrete deterministic scenarios.',
      requirementId: requirement.id,
    });
  }
  for (const scenarioId of requirement.scenarioIds) {
    if (!manifestIds.has(scenarioId)) {
      issues.push({
        severity: 'error',
        code: 'requirement_scenario_missing_manifest',
        detail: `Requirement references scenario without a generated manifest: ${scenarioId}`,
        requirementId: requirement.id,
      });
    }
  }
  if (requirement.environmentKinds.length === 0) {
    issues.push({
      severity: 'error',
      code: 'requirement_missing_environment',
      detail: 'Benchmark requirement must declare its execution environment.',
      requirementId: requirement.id,
    });
  }
  if (requirement.coverageStatus === 'external_required' && requirement.objective.length === 0) {
    issues.push({
      severity: 'error',
      code: 'external_requirement_missing_objective',
      detail: 'External benchmark requirements must state what remains to be executed.',
      requirementId: requirement.id,
    });
  }
  return issues;
}

function auditManifest(manifest: E2EBenchmarkManifest): E2EBenchmarkManifestAuditIssue[] {
  const issues: E2EBenchmarkManifestAuditIssue[] = [];
  if (!manifest.id || !manifest.version || !manifest.sourceRefreshDate) {
    issues.push({
      severity: 'error',
      code: 'manifest_identity_incomplete',
      detail: 'Benchmark manifest requires id, version, and source refresh date.',
      manifestId: manifest.id,
    });
  }
  if (manifest.benchmarkFamilies.length === 0 || manifest.assessmentDimensions.length === 0) {
    issues.push({
      severity: 'error',
      code: 'manifest_taxonomy_missing',
      detail: 'Benchmark manifest requires benchmark family and assessment dimension tags.',
      manifestId: manifest.id,
    });
  }
  if (manifest.finalStateEvaluators.length === 0) {
    issues.push({
      severity: 'error',
      code: 'manifest_missing_final_state_evaluator',
      detail: 'Benchmark-grade scenarios require structural final-state evidence.',
      manifestId: manifest.id,
    });
  }
  if (manifest.resourceBudgetEvaluators.length === 0) {
    issues.push({
      severity: 'error',
      code: 'manifest_missing_token_budget',
      detail: 'Benchmark-grade scenarios require explicit token/resource budget evidence.',
      manifestId: manifest.id,
    });
  }
  if (
    manifest.hiddenGroundTruth.visibleToAgent !== false ||
    !manifest.hiddenGroundTruth.fingerprint
  ) {
    issues.push({
      severity: 'error',
      code: 'manifest_hidden_ground_truth_invalid',
      detail: 'Hidden ground truth must be fingerprinted and unavailable to the agent.',
      manifestId: manifest.id,
    });
  }
  if (!manifest.reset.required || manifest.reset.procedure.length === 0) {
    issues.push({
      severity: 'error',
      code: 'manifest_reset_missing',
      detail: 'Benchmark scenarios require a deterministic reset procedure.',
      manifestId: manifest.id,
    });
  }
  if (
    !manifest.traceRequirements.modelProviderAndVersion ||
    !manifest.traceRequirements.promptSectionsAndTokenBuckets ||
    !manifest.traceRequirements.toolSurfacePerTurn ||
    !manifest.traceRequirements.toolCallsAndResults ||
    !manifest.traceRequirements.graphStateHoldsAndResolutions ||
    !manifest.traceRequirements.cacheEligibilityAndEvents
  ) {
    issues.push({
      severity: 'error',
      code: 'manifest_trace_requirements_incomplete',
      detail: 'Benchmark traces must include provider, tokens, tools, graph, and cache evidence.',
      manifestId: manifest.id,
    });
  }
  if (manifest.providerMatrix.length < PROVIDER_MATRIX.length) {
    issues.push({
      severity: 'error',
      code: 'manifest_provider_matrix_incomplete',
      detail: 'Benchmark manifests must declare the provider/model comparison matrix.',
      manifestId: manifest.id,
    });
  }
  return issues;
}

export function auditE2EBenchmarkManifests(
  manifests: ReadonlyArray<E2EBenchmarkManifest> = listE2EBenchmarkManifests(),
  requirements: ReadonlyArray<E2EBenchmarkRequirement> = listE2EBenchmarkRequirements(),
): E2EBenchmarkManifestAudit {
  const manifestScenarioIds = new Set(manifests.map((manifest) => manifest.scenarioId));
  const issues = [
    ...manifests.flatMap(auditManifest),
    ...requirements.flatMap((requirement) => auditRequirement(requirement, manifestScenarioIds)),
  ];

  return {
    manifestCount: manifests.length,
    requirementCount: requirements.length,
    implementedRequirementCount: requirements.filter(
      (requirement) => requirement.coverageStatus === 'implemented',
    ).length,
    externalRequirementCount: requirements.filter(
      (requirement) => requirement.coverageStatus === 'external_required',
    ).length,
    sourceRefreshDate: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
    issues,
    passing: issues.every((issue) => issue.severity !== 'error'),
  };
}
