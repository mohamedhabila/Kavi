import { projectPublicRedactedTrace } from '../../../scripts/e2eReport/publicTraceSchema';
import {
  E2E_MAX_ORACLE_FACTS,
  E2E_PAIRED_CONDITIONS,
  type E2EPairedCondition,
} from './e2ePairedConditions';
import {
  E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
  type E2EPairedConditionExecution,
  type E2EPairedRuntimeResult,
} from './e2ePairedRuntime';
import {
  buildE2EPairedPublicRetrievalMetrics,
  type E2EPairedPublicRetrievalMetrics,
} from './e2ePairedPublicRetrievalMetrics';
import { buildE2EScenarioTraceSummary } from './e2eTraceSummary';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { E2EScenarioTurnTrace } from './types';

export const E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION = 'e2e-paired-public-report-v1' as const;

type PublicConditionMetrics = Readonly<{
  executionCompleted: boolean;
  rubricPassed: number;
  rubricTotal: number;
  rubricPassRate: number;
  passed: boolean;
  durationMs: number;
  userTurnCount: number;
  turnTraceIndexCoverage: 'complete' | 'incomplete';
  routeDirectiveCounts: Readonly<{
    production_auto: number;
    forced_chitchat: number;
    forced_agentic: number;
  }>;
  conversationModeCounts: Readonly<{
    chitchat: number;
    agentic: number;
  }>;
  toolCallCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  publicTraceHash: string;
  retrieval: E2EPairedPublicRetrievalMetrics;
}>;

export type E2EPairedPublicCondition =
  | Readonly<{
      condition: E2EPairedCondition;
      conditionConfigHash: string;
      oracleEvidenceCount: number;
      status: 'completed';
      metrics: PublicConditionMetrics;
    }>
  | Readonly<{
      condition: E2EPairedCondition;
      conditionConfigHash: string;
      oracleEvidenceCount: number;
      status: 'failed';
      category: 'state_reset' | 'condition_execution' | 'evidence_validation';
      errorHash: string;
    }>;

export type E2EPairedPublicReport = Readonly<{
  schemaVersion: typeof E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION;
  pairIdHash: string;
  pairConfigHash: string;
  invariantConfigHash: string;
  comparison: Readonly<{
    referenceCondition: E2EPairedCondition;
    candidateCondition: E2EPairedCondition;
  }>;
  conditions: ReadonlyArray<E2EPairedPublicCondition>;
  cleanup:
    | Readonly<{ status: 'completed' }>
    | Readonly<{
        status: 'failed';
        category: 'state_cleanup' | 'store_restoration';
        errorHash: string;
      }>;
  infrastructureFailures: ReadonlyArray<
    Readonly<{
      scope: E2EPairedCondition | 'pair_cleanup';
      category:
        | 'state_reset'
        | 'condition_execution'
        | 'evidence_validation'
        | 'state_cleanup'
        | 'store_restoration';
      errorHash: string;
    }>
  >;
  validForDeltaClaims: boolean;
  pairedDelta: null | Readonly<{
    referenceCondition: E2EPairedCondition;
    candidateCondition: E2EPairedCondition;
    passDelta: -1 | 0 | 1;
    rubricPassRateDelta: number;
    executionCompletionDelta: -1 | 0 | 1;
    totalTokensDelta: number;
    durationMsDelta: number;
  }>;
  memoryPairedObservation: Readonly<{
    status:
      | 'not_applicable'
      | 'invalid_infrastructure'
      | 'invalid_instrumentation'
      | 'positive_delta'
      | 'non_positive_delta';
    controlCondition: E2EPairedCondition | null;
    productCondition: E2EPairedCondition | null;
    pairedScoreDelta: number | null;
  }>;
  accidentalSuccessDiagnostics: ReadonlyArray<
    | 'reference_only_pass'
    | 'candidate_only_pass'
    | 'control_only_pass'
    | 'diagnostic_only_pass'
    | 'forced_route_only_pass'
  >;
}>;

const PRODUCTION_CONDITIONS = new Set<E2EPairedCondition>([
  'production_auto',
  'forced_chitchat',
  'forced_agentic',
]);
const MEMORY_CONTROL_CONDITIONS = new Set<E2EPairedCondition>(['memory_off', 'lexical_baseline']);
const DIAGNOSTIC_CONDITIONS = new Set<E2EPairedCondition>([
  'diagnostic_full_context',
  'oracle_evidence',
]);

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash.`);
  }
  return value;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function booleanDelta(candidate: boolean, reference: boolean): -1 | 0 | 1 {
  return (Number(candidate) - Number(reference)) as -1 | 0 | 1;
}

function validateCompletedCondition(
  condition: Extract<E2EPairedConditionExecution, { status: 'completed' }>,
): void {
  const { assessment } = condition;
  if (
    !Number.isSafeInteger(assessment.rubricPassed) ||
    !Number.isSafeInteger(assessment.rubricTotal) ||
    assessment.rubricPassed < 0 ||
    assessment.rubricTotal <= 0 ||
    assessment.rubricPassed > assessment.rubricTotal ||
    assessment.executionCompleted !== condition.result.completed ||
    assessment.passed !==
      (assessment.executionCompleted && assessment.rubricPassed === assessment.rubricTotal)
  ) {
    throw new Error(`Condition ${condition.condition} has an invalid paired assessment.`);
  }
}

function validateRuntimeForProjection(runtime: E2EPairedRuntimeResult): void {
  if (runtime.schemaVersion !== E2E_PAIRED_RUNTIME_SCHEMA_VERSION) {
    throw new Error('Paired runtime evidence uses an unsupported schema version.');
  }
  requireHash(runtime.pairIdHash, 'pairIdHash');
  requireHash(runtime.invariantConfigHash, 'invariantConfigHash');
  if (!Array.isArray(runtime.conditions) || runtime.conditions.length !== 2) {
    throw new Error('Public paired evidence requires exactly two condition outcomes.');
  }
  if (new Set(runtime.conditions.map((condition) => condition.condition)).size !== 2) {
    throw new Error('Public paired evidence must not duplicate a condition.');
  }
  if (
    !runtime.comparison ||
    typeof runtime.comparison !== 'object' ||
    Array.isArray(runtime.comparison)
  ) {
    throw new Error('Public paired evidence requires declared comparison roles.');
  }
  if (
    runtime.comparison.referenceCondition !== runtime.conditions[0].condition ||
    runtime.comparison.candidateCondition !== runtime.conditions[1].condition
  ) {
    throw new Error('Public paired evidence does not match its declared comparison roles.');
  }
  for (const condition of runtime.conditions) {
    if (!E2E_PAIRED_CONDITIONS.includes(condition.condition)) {
      throw new Error('Public paired evidence contains an unsupported condition.');
    }
    requireHash(condition.conditionConfigHash, `${condition.condition}.conditionConfigHash`);
    const oracleEvidenceCountValid =
      Number.isSafeInteger(condition.oracleEvidenceCount) &&
      (condition.condition === 'oracle_evidence'
        ? condition.oracleEvidenceCount >= 1 &&
          condition.oracleEvidenceCount <= E2E_MAX_ORACLE_FACTS
        : condition.oracleEvidenceCount === 0);
    if (!oracleEvidenceCountValid) {
      throw new Error(`${condition.condition}.oracleEvidenceCount is inconsistent.`);
    }
    if (condition.status === 'completed') validateCompletedCondition(condition);
    else if (condition.status === 'failed') {
      if (
        !['state_reset', 'condition_execution', 'evidence_validation'].includes(condition.category)
      ) {
        throw new Error(`${condition.condition}.category is unsupported.`);
      }
      requireHash(condition.errorHash, `${condition.condition}.errorHash`);
    } else {
      throw new Error(`${condition.condition}.status is unsupported.`);
    }
  }
  if (runtime.cleanup.status === 'failed') {
    if (!['state_cleanup', 'store_restoration'].includes(runtime.cleanup.category)) {
      throw new Error('cleanup.category is unsupported.');
    }
    requireHash(runtime.cleanup.errorHash, 'cleanup.errorHash');
  } else if (runtime.cleanup.status !== 'completed') {
    throw new Error('cleanup.status is unsupported.');
  }
  if (typeof runtime.validForDeltaClaims !== 'boolean') {
    throw new Error('validForDeltaClaims must be a boolean.');
  }
  const structurallyValid =
    runtime.cleanup.status === 'completed' &&
    runtime.conditions.every((condition) => condition.status === 'completed');
  if (runtime.validForDeltaClaims !== structurallyValid) {
    throw new Error(
      'Paired runtime delta eligibility is inconsistent with infrastructure evidence.',
    );
  }
}

function buildTurnAuditMetrics(
  turns: ReadonlyArray<Pick<E2EScenarioTurnTrace, 'route' | 'turnIndex'>>,
  userTurnCount: number,
): Pick<
  PublicConditionMetrics,
  'turnTraceIndexCoverage' | 'routeDirectiveCounts' | 'conversationModeCounts'
> {
  const routeDirectiveCounts = {
    production_auto: 0,
    forced_chitchat: 0,
    forced_agentic: 0,
  };
  const conversationModeCounts = { chitchat: 0, agentic: 0 };
  const turnIndexes = new Set<number>();
  let indexesInRange = turns.length === userTurnCount;
  for (const turn of turns) {
    if (
      !Number.isSafeInteger(turn.turnIndex) ||
      turn.turnIndex < 0 ||
      turn.turnIndex >= userTurnCount
    ) {
      indexesInRange = false;
    }
    turnIndexes.add(turn.turnIndex);
    const directive = turn.route.directive;
    if (!['production_auto', 'forced_chitchat', 'forced_agentic'].includes(directive)) {
      throw new Error('Paired route evidence contains an unsupported directive.');
    }
    const mode = turn.route.mode;
    if (!['chitchat', 'agentic'].includes(mode)) {
      throw new Error('Paired route evidence contains an unsupported conversation mode.');
    }
    routeDirectiveCounts[directive] += 1;
    conversationModeCounts[mode] += 1;
  }
  const directiveCount = Object.values(routeDirectiveCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const modeCount = Object.values(conversationModeCounts).reduce(
    (total, count) => total + count,
    0,
  );
  if (
    !Number.isSafeInteger(directiveCount) ||
    !Number.isSafeInteger(modeCount) ||
    directiveCount > userTurnCount ||
    modeCount > userTurnCount
  ) {
    throw new Error('Paired route evidence exceeds the user-turn count.');
  }
  return {
    turnTraceIndexCoverage:
      indexesInRange && turnIndexes.size === userTurnCount ? 'complete' : 'incomplete',
    routeDirectiveCounts,
    conversationModeCounts,
  };
}

function projectCondition(condition: E2EPairedConditionExecution): E2EPairedPublicCondition {
  const base = {
    condition: condition.condition,
    conditionConfigHash: condition.conditionConfigHash,
    oracleEvidenceCount: condition.oracleEvidenceCount,
  };
  if (condition.status === 'failed') {
    return {
      ...base,
      status: 'failed',
      category: condition.category,
      errorHash: condition.errorHash,
    };
  }
  const trace = projectPublicRedactedTrace(
    buildE2EScenarioTraceSummary({ result: condition.result }),
  );
  if (!trace) throw new Error(`Condition ${condition.condition} produced an invalid public trace.`);
  const assessment = condition.assessment;
  const turnAuditMetrics = buildTurnAuditMetrics(
    condition.result.turnTraces,
    condition.result.userTurnCount,
  );
  return {
    ...base,
    status: 'completed',
    metrics: {
      executionCompleted: assessment.executionCompleted,
      rubricPassed: assessment.rubricPassed,
      rubricTotal: assessment.rubricTotal,
      rubricPassRate: safeRate(assessment.rubricPassed, assessment.rubricTotal),
      passed: assessment.passed,
      durationMs: condition.result.durationMs,
      userTurnCount: condition.result.userTurnCount,
      ...turnAuditMetrics,
      toolCallCount: condition.result.toolCalls.length,
      errorCount: condition.result.errors.length,
      inputTokens: condition.result.usage.inputTokens,
      outputTokens: condition.result.usage.outputTokens,
      totalTokens: condition.result.usage.totalTokens,
      publicTraceHash: stableHash(stableStringify(trace)),
      retrieval: buildE2EPairedPublicRetrievalMetrics(condition.result.turnTraces),
    },
  };
}

function buildDelta(
  conditions: ReadonlyArray<E2EPairedPublicCondition>,
): E2EPairedPublicReport['pairedDelta'] {
  const [reference, candidate] = conditions;
  if (reference.status !== 'completed' || candidate.status !== 'completed') return null;
  return {
    referenceCondition: reference.condition,
    candidateCondition: candidate.condition,
    passDelta: booleanDelta(candidate.metrics.passed, reference.metrics.passed),
    rubricPassRateDelta: candidate.metrics.rubricPassRate - reference.metrics.rubricPassRate,
    executionCompletionDelta: booleanDelta(
      candidate.metrics.executionCompleted,
      reference.metrics.executionCompleted,
    ),
    totalTokensDelta: candidate.metrics.totalTokens - reference.metrics.totalTokens,
    durationMsDelta: candidate.metrics.durationMs - reference.metrics.durationMs,
  };
}

type CompletedPublicCondition = Extract<E2EPairedPublicCondition, { status: 'completed' }>;

function hasCompleteRetrievalTurnCoverage(condition: CompletedPublicCondition): boolean {
  const { retrieval, userTurnCount } = condition.metrics;
  const statusCoverage =
    retrieval.turnStatusCounts.recorded +
    retrieval.turnStatusCounts.missing +
    retrieval.turnStatusCounts.optOut +
    retrieval.turnStatusCounts.overflow;
  return (
    userTurnCount > 0 &&
    condition.metrics.turnTraceIndexCoverage === 'complete' &&
    statusCoverage === userTurnCount &&
    retrieval.instrumentationFailureTurnCount === 0 &&
    retrieval.retrievalFailureCount === 0 &&
    retrieval.outcomeCounts.degraded === 0 &&
    retrieval.outcomeCounts.failed === 0 &&
    (retrieval.selectedFactCount === 0 || retrieval.selectedFactIdCoverage === 'complete') &&
    (retrieval.selectedEpisodeCount === 0 || retrieval.selectedEpisodeIdCoverage === 'complete')
  );
}

function hasProductionAutoDirectiveCoverage(condition: CompletedPublicCondition): boolean {
  const { routeDirectiveCounts, userTurnCount } = condition.metrics;
  return (
    routeDirectiveCounts.production_auto === userTurnCount &&
    routeDirectiveCounts.forced_chitchat === 0 &&
    routeDirectiveCounts.forced_agentic === 0
  );
}

function hasCompleteEnabledRetrieval(condition: CompletedPublicCondition): boolean {
  const { retrieval, userTurnCount } = condition.metrics;
  return (
    hasCompleteRetrievalTurnCoverage(condition) &&
    retrieval.turnStatusCounts.recorded === userTurnCount &&
    retrieval.turnStatusCounts.optOut === 0 &&
    retrieval.eventCount === userTurnCount &&
    retrieval.modeCounts.disabled === 0 &&
    retrieval.outcomeCounts.disabled === 0
  );
}

function hasExpectedMemoryControlRetrieval(condition: CompletedPublicCondition): boolean {
  const { retrieval, userTurnCount } = condition.metrics;
  if (condition.condition === 'memory_off') {
    return (
      hasCompleteRetrievalTurnCoverage(condition) &&
      retrieval.turnStatusCounts.optOut === userTurnCount &&
      retrieval.turnStatusCounts.recorded === 0 &&
      retrieval.eventCount === 0
    );
  }
  return (
    condition.condition === 'lexical_baseline' &&
    hasCompleteEnabledRetrieval(condition) &&
    retrieval.selectorCounts.notRequested === retrieval.eventCount &&
    retrieval.selectorCounts.applied === 0 &&
    retrieval.selectorCounts.deterministicFallback === 0
  );
}

function buildMemoryPairedObservation(
  conditions: ReadonlyArray<E2EPairedPublicCondition>,
  validForDeltaClaims: boolean,
): E2EPairedPublicReport['memoryPairedObservation'] {
  const [control, product] = conditions;
  const hasMemoryObservationOrientation =
    MEMORY_CONTROL_CONDITIONS.has(control.condition) && product.condition === 'production_auto';
  if (!hasMemoryObservationOrientation) {
    return {
      status: validForDeltaClaims ? 'not_applicable' : 'invalid_infrastructure',
      controlCondition: null,
      productCondition: null,
      pairedScoreDelta: null,
    };
  }
  if (!validForDeltaClaims || control.status !== 'completed' || product.status !== 'completed') {
    return {
      status: 'invalid_infrastructure',
      controlCondition: control.condition,
      productCondition: product.condition,
      pairedScoreDelta: null,
    };
  }
  const instrumentationInvalid =
    !hasProductionAutoDirectiveCoverage(control) ||
    !hasProductionAutoDirectiveCoverage(product) ||
    !hasExpectedMemoryControlRetrieval(control) ||
    !hasCompleteEnabledRetrieval(product) ||
    (product.metrics.retrieval.selectedFactCount === 0 &&
      product.metrics.retrieval.selectedEpisodeCount === 0) ||
    (control.condition === 'lexical_baseline' &&
      (product.metrics.retrieval.selectorCounts.applied === 0 ||
        product.metrics.retrieval.selectorCounts.deterministicFallback !== 0));
  if (instrumentationInvalid) {
    return {
      status: 'invalid_instrumentation',
      controlCondition: control.condition,
      productCondition: product.condition,
      pairedScoreDelta: null,
    };
  }
  const pairedScoreDelta = product.metrics.rubricPassRate - control.metrics.rubricPassRate;
  return {
    status: pairedScoreDelta > 0 ? 'positive_delta' : 'non_positive_delta',
    controlCondition: control.condition,
    productCondition: product.condition,
    pairedScoreDelta,
  };
}

function buildAccidentalSuccessDiagnostics(
  conditions: ReadonlyArray<E2EPairedPublicCondition>,
  validForDeltaClaims: boolean,
): E2EPairedPublicReport['accidentalSuccessDiagnostics'] {
  if (!validForDeltaClaims) return [];
  const [reference, candidate] = conditions;
  if (reference.status !== 'completed' || candidate.status !== 'completed') return [];
  const diagnostics: E2EPairedPublicReport['accidentalSuccessDiagnostics'][number][] = [];
  if (reference.metrics.passed && !candidate.metrics.passed)
    diagnostics.push('reference_only_pass');
  if (!reference.metrics.passed && candidate.metrics.passed)
    diagnostics.push('candidate_only_pass');
  const passing = conditions.find(
    (condition) => condition.status === 'completed' && condition.metrics.passed,
  );
  const failing = conditions.find(
    (condition) => condition.status === 'completed' && !condition.metrics.passed,
  );
  if (passing && failing && PRODUCTION_CONDITIONS.has(failing.condition)) {
    if (MEMORY_CONTROL_CONDITIONS.has(passing.condition)) diagnostics.push('control_only_pass');
    if (DIAGNOSTIC_CONDITIONS.has(passing.condition)) diagnostics.push('diagnostic_only_pass');
    if (
      (passing.condition === 'forced_agentic' || passing.condition === 'forced_chitchat') &&
      failing.condition === 'production_auto'
    ) {
      diagnostics.push('forced_route_only_pass');
    }
  }
  return diagnostics;
}

export function buildE2EPairedPublicReport(runtime: E2EPairedRuntimeResult): E2EPairedPublicReport {
  validateRuntimeForProjection(runtime);
  const conditions = runtime.conditions.map(projectCondition);
  const cleanup =
    runtime.cleanup.status === 'completed'
      ? ({ status: 'completed' } as const)
      : {
          status: 'failed' as const,
          category: runtime.cleanup.category,
          errorHash: runtime.cleanup.errorHash,
        };
  const infrastructureFailures: E2EPairedPublicReport['infrastructureFailures'][number][] = [];
  for (const condition of conditions) {
    if (condition.status === 'failed') {
      infrastructureFailures.push({
        scope: condition.condition,
        category: condition.category,
        errorHash: condition.errorHash,
      });
    }
  }
  if (cleanup.status === 'failed') {
    infrastructureFailures.push({
      scope: 'pair_cleanup',
      category: cleanup.category,
      errorHash: cleanup.errorHash,
    });
  }
  if (!runtime.validForDeltaClaims && infrastructureFailures.length === 0) {
    throw new Error('Invalid paired evidence must name at least one infrastructure failure.');
  }
  const pairConfigHash = stableHash(
    stableStringify({
      pairIdHash: runtime.pairIdHash,
      invariantConfigHash: runtime.invariantConfigHash,
      comparison: runtime.comparison,
      conditions: conditions.map((condition) => ({
        condition: condition.condition,
        conditionConfigHash: condition.conditionConfigHash,
      })),
    }),
  );
  return {
    schemaVersion: E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION,
    pairIdHash: runtime.pairIdHash,
    pairConfigHash,
    invariantConfigHash: runtime.invariantConfigHash,
    comparison: runtime.comparison,
    conditions,
    cleanup,
    infrastructureFailures,
    validForDeltaClaims: runtime.validForDeltaClaims,
    pairedDelta: runtime.validForDeltaClaims ? buildDelta(conditions) : null,
    memoryPairedObservation: buildMemoryPairedObservation(conditions, runtime.validForDeltaClaims),
    accidentalSuccessDiagnostics: buildAccidentalSuccessDiagnostics(
      conditions,
      runtime.validForDeltaClaims,
    ),
  };
}
