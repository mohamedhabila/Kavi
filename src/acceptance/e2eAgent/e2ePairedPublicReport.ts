import { projectPublicRedactedTrace } from '../../../scripts/e2eReport/publicTraceSchema';
import {
  type E2EPairedCondition,
} from './e2ePairedConditions';
import {
  type E2EPairedConditionExecution,
  type E2EPairedRuntimeResult,
} from './e2ePairedRuntime';
import {
  buildE2EPairedPublicRetrievalMetrics,
  type E2EPairedPublicRetrievalMetrics,
} from './e2ePairedPublicRetrievalMetrics';
import {
  buildE2EPairedEstimatedCost,
  type E2EPairedEstimatedCostSummary,
} from './e2ePairedEstimatedCost';
import { validateE2EPairedRuntimeForPublicProjection } from './e2ePairedPublicReportValidation';
import { buildE2EScenarioTraceSummary } from './e2eTraceSummary';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { E2EEstimatedCostSummary, E2EScenarioTurnTrace } from './types';

export const E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION = 'e2e-paired-public-report-v5' as const;

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
  estimatedCost: E2EEstimatedCostSummary;
  publicTraceHash: string;
  retrieval: E2EPairedPublicRetrievalMetrics;
}>;

export type E2EPairedPublicCondition =
  | Readonly<{
      condition: E2EPairedCondition;
      conditionConfigHash: string;
      executionIdentityHash: string;
      oracleEvidenceCount: number;
      status: 'completed';
      metrics: PublicConditionMetrics;
    }>
  | Readonly<{
      condition: E2EPairedCondition;
      conditionConfigHash: string;
      executionIdentityHash: string;
      oracleEvidenceCount: number;
      status: 'failed';
      category:
        | 'source_provenance'
        | 'state_reset'
        | 'condition_execution'
        | 'evidence_validation';
      errorHash: string;
    }>;

export type E2EPairedPublicReport = Readonly<{
  schemaVersion: typeof E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION;
  source: E2EPairedRuntimeResult['source'];
  model: E2EPairedRuntimeResult['model'];
  scenarioInputHash: string;
  pairIdHash: string;
  pairConfigHash: string;
  invariantConfigHash: string;
  comparison: Readonly<{
    referenceCondition: E2EPairedCondition;
    candidateCondition: E2EPairedCondition;
  }>;
  executionSeed: number;
  executionOrder: ReadonlyArray<E2EPairedCondition>;
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
      scope: E2EPairedCondition | 'pair_cleanup' | 'pair_source';
      category:
        | 'source_dirty'
        | 'source_mismatch'
        | 'source_provenance'
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
  estimatedCost: E2EPairedEstimatedCostSummary;
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

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function booleanDelta(candidate: boolean, reference: boolean): -1 | 0 | 1 {
  return (Number(candidate) - Number(reference)) as -1 | 0 | 1;
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
    executionIdentityHash: condition.executionIdentityHash,
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
      estimatedCost: { ...condition.result.estimatedCost },
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

function hasCandidateStrategyCoverage(
  condition: CompletedPublicCondition,
  strategy: 'lexical' | 'hybrid',
): boolean {
  const { eventCount, candidateStages } = condition.metrics.retrieval;
  return (
    eventCount > 0 &&
    candidateStages.strategyCounts[strategy] === eventCount &&
    candidateStages.strategyCounts.notRequested === 0 &&
    candidateStages.strategyCounts[strategy === 'lexical' ? 'hybrid' : 'lexical'] === 0
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
    hasCandidateStrategyCoverage(condition, 'lexical') &&
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
    !hasCandidateStrategyCoverage(product, 'hybrid') ||
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
  validateE2EPairedRuntimeForPublicProjection(runtime);
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
  if (runtime.source.status !== 'clean_match') {
    infrastructureFailures.push({
      scope: 'pair_source',
      category: runtime.source.status === 'dirty' ? 'source_dirty' : 'source_mismatch',
      errorHash: stableHash(`paired-source-${runtime.source.status}`),
    });
  }
  if (!runtime.validForDeltaClaims && infrastructureFailures.length === 0) {
    throw new Error('Invalid paired evidence must name at least one infrastructure failure.');
  }
  const memoryPairedObservation = buildMemoryPairedObservation(
    conditions,
    runtime.validForDeltaClaims,
  );
  const validForDeltaClaims =
    runtime.validForDeltaClaims && memoryPairedObservation.status !== 'invalid_instrumentation';
  const pairConfigHash = stableHash(
    stableStringify({
      pairIdHash: runtime.pairIdHash,
      invariantConfigHash: runtime.invariantConfigHash,
      comparison: runtime.comparison,
      executionSeed: runtime.executionSeed,
      executionOrder: runtime.executionOrder,
      conditions: conditions.map((condition) => ({
        condition: condition.condition,
        conditionConfigHash: condition.conditionConfigHash,
        executionIdentityHash: condition.executionIdentityHash,
      })),
    }),
  );
  return {
    schemaVersion: E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION,
    source: {
      app: { ...runtime.source.app },
      completionApp: { ...runtime.source.completionApp },
      status: runtime.source.status,
    },
    model: { ...runtime.model },
    scenarioInputHash: runtime.scenarioInputHash,
    pairIdHash: runtime.pairIdHash,
    pairConfigHash,
    invariantConfigHash: runtime.invariantConfigHash,
    comparison: runtime.comparison,
    executionSeed: runtime.executionSeed,
    executionOrder: runtime.executionOrder,
    conditions,
    cleanup,
    infrastructureFailures,
    validForDeltaClaims,
    pairedDelta: validForDeltaClaims ? buildDelta(conditions) : null,
    estimatedCost: buildE2EPairedEstimatedCost({
      reference:
        conditions[0]?.status === 'completed' ? conditions[0].metrics.estimatedCost : undefined,
      candidate:
        conditions[1]?.status === 'completed' ? conditions[1].metrics.estimatedCost : undefined,
    }),
    memoryPairedObservation,
    accidentalSuccessDiagnostics: buildAccidentalSuccessDiagnostics(
      conditions,
      validForDeltaClaims,
    ),
  };
}
