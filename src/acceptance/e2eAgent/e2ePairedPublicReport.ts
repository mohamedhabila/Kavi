import { projectPublicRedactedTrace } from '../../../scripts/e2eReport/publicTraceSchema';
import { type E2EPairedCondition } from './e2ePairedConditions';
import { type E2EPairedConditionExecution, type E2EPairedRuntimeResult } from './e2ePairedRuntime';
import {
  buildE2EPairedPublicMemoryMetrics,
  type E2EPairedPublicMemoryMetrics,
} from './e2ePairedPublicMemoryMetrics';
import {
  buildE2EPairedEstimatedCost,
  type E2EPairedEstimatedCostSummary,
} from './e2ePairedEstimatedCost';
import { validateE2EPairedRuntimeForPublicProjection } from './e2ePairedPublicReportValidation';
import { buildE2EScenarioTraceSummary } from './e2eTraceSummary';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { E2EEstimatedCostSummary, E2EScenarioTurnTrace } from './types';

export const E2E_PAIRED_PUBLIC_REPORT_SCHEMA_VERSION = 'e2e-paired-public-report-v7' as const;

type PublicConditionMetrics = Readonly<{
  executionCompleted: boolean;
  rubricPassed: number;
  rubricTotal: number;
  rubricPassRate: number;
  passed: boolean;
  durationMs: number;
  userTurnCount: number;
  turnTraceIndexCoverage: 'complete' | 'incomplete';
  toolCallCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: E2EEstimatedCostSummary;
  publicTraceHash: string;
  memory: E2EPairedPublicMemoryMetrics;
}>;

export type E2EPairedPublicCondition =
  | Readonly<{
      condition: E2EPairedCondition;
      conditionConfigHash: string;
      executionIdentityHash: string;
      status: 'completed';
      metrics: PublicConditionMetrics;
    }>
  | Readonly<{
      condition: E2EPairedCondition;
      conditionConfigHash: string;
      executionIdentityHash: string;
      status: 'failed';
      category: 'source_provenance' | 'state_reset' | 'condition_execution' | 'evidence_validation';
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
    'reference_only_pass' | 'candidate_only_pass' | 'control_only_pass' | 'diagnostic_only_pass'
  >;
}>;

const MEMORY_CONTROL_CONDITIONS = new Set<E2EPairedCondition>(['memory_off']);
const DIAGNOSTIC_CONDITIONS = new Set<E2EPairedCondition>(['diagnostic_full_context']);

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function booleanDelta(candidate: boolean, reference: boolean): -1 | 0 | 1 {
  return (Number(candidate) - Number(reference)) as -1 | 0 | 1;
}

/** Whether the condition traced every user turn exactly once. */
function resolveTurnTraceIndexCoverage(
  turns: ReadonlyArray<Pick<E2EScenarioTurnTrace, 'turnIndex'>>,
  userTurnCount: number,
): PublicConditionMetrics['turnTraceIndexCoverage'] {
  const turnIndexes = new Set<number>();
  for (const turn of turns) {
    if (
      !Number.isSafeInteger(turn.turnIndex) ||
      turn.turnIndex < 0 ||
      turn.turnIndex >= userTurnCount
    ) {
      return 'incomplete';
    }
    turnIndexes.add(turn.turnIndex);
  }
  return turns.length === userTurnCount && turnIndexes.size === userTurnCount
    ? 'complete'
    : 'incomplete';
}

function projectCondition(condition: E2EPairedConditionExecution): E2EPairedPublicCondition {
  const base = {
    condition: condition.condition,
    conditionConfigHash: condition.conditionConfigHash,
    executionIdentityHash: condition.executionIdentityHash,
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
      turnTraceIndexCoverage: resolveTurnTraceIndexCoverage(
        condition.result.turnTraces,
        condition.result.userTurnCount,
      ),
      toolCallCount: condition.result.toolCalls.length,
      errorCount: condition.result.errors.length,
      inputTokens: condition.result.usage.inputTokens,
      outputTokens: condition.result.usage.outputTokens,
      totalTokens: condition.result.usage.totalTokens,
      estimatedCost: { ...condition.result.estimatedCost },
      publicTraceHash: stableHash(stableStringify(trace)),
      memory: buildE2EPairedPublicMemoryMetrics(condition.result.turnTraces),
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

function hasCompleteMemoryTurnCoverage(condition: CompletedPublicCondition): boolean {
  const { memory, userTurnCount } = condition.metrics;
  const { recorded, missing, optOut } = memory.turnStatusCounts;
  return (
    userTurnCount > 0 &&
    condition.metrics.turnTraceIndexCoverage === 'complete' &&
    recorded + missing + optOut === userTurnCount &&
    missing === 0
  );
}

function hasCompleteEnabledMemory(condition: CompletedPublicCondition): boolean {
  const { memory, userTurnCount } = condition.metrics;
  return (
    hasCompleteMemoryTurnCoverage(condition) &&
    memory.turnStatusCounts.recorded === userTurnCount &&
    memory.buildCount >= userTurnCount
  );
}

function hasExpectedMemoryControl(condition: CompletedPublicCondition): boolean {
  const { memory, userTurnCount } = condition.metrics;
  return (
    condition.condition === 'memory_off' &&
    hasCompleteMemoryTurnCoverage(condition) &&
    memory.turnStatusCounts.optOut === userTurnCount &&
    memory.buildCount === 0
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
    !hasExpectedMemoryControl(control) ||
    !hasCompleteEnabledMemory(product) ||
    (product.metrics.memory.selectedItemCount === 0 &&
      product.metrics.memory.selectedPastTurnCount === 0);
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
  if (passing && failing && failing.condition === 'production_auto') {
    if (MEMORY_CONTROL_CONDITIONS.has(passing.condition)) diagnostics.push('control_only_pass');
    if (DIAGNOSTIC_CONDITIONS.has(passing.condition)) diagnostics.push('diagnostic_only_pass');
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
