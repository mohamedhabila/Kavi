import {
  buildE2EPairedExecutionIdentityHash,
  E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
  resolveE2EPairedExecutionOrder,
  type E2EPairedConditionExecution,
  type E2EPairedRuntimeResult,
} from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import { stableHash } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
import type { E2EScenarioTurnTrace } from '../../src/acceptance/e2eAgent/types';
import {
  buildPairedRetrievalEvent,
  buildPairedTurnTrace,
  PAIRED_TEST_SOURCE_THREAD_HASH,
} from './e2ePairedRunHarness';
import { buildFixtureResult } from './e2eRunReportHarness';

export const PAIRED_TEST_APP_SOURCE = {
  commitSha: 'a'.repeat(40),
  dirty: false,
} as const;

export const PAIRED_TEST_SOURCE_BINDING = {
  app: PAIRED_TEST_APP_SOURCE,
  completionApp: PAIRED_TEST_APP_SOURCE,
  status: 'clean_match',
} as const;

export const PAIRED_TEST_MODEL = {
  role: 'assistant',
  capabilityClass: 'hosted_tool_capable',
  provider: 'custom',
  model: `sha256-${'b'.repeat(64)}`,
  revision: null,
  endpointSha256: 'c'.repeat(64),
} as const;

function defaultRetrievalEvent(
  condition: Extract<E2EPairedConditionExecution, { status: 'completed' }>['condition'],
) {
  const event = buildPairedRetrievalEvent();
  if (condition !== 'lexical_baseline') return event;
  return {
    ...event,
    candidates: {
      strategy: 'lexical' as const,
      localSimilarityOutcome: 'not_requested' as const,
      eligibleScanCount: 0,
      pinnedCount: 0,
      exactQuotedCount: 0,
      lexicalCount: 1,
      entityCount: 0,
      temporalCount: 0,
      localSimilarityCount: 0,
      unionCount: 1,
      diversifiedCount: 1,
      unionMs: 0,
    },
  };
}

export function completedCondition(input: {
  condition: Extract<E2EPairedConditionExecution, { status: 'completed' }>['condition'];
  rubricPassed: number;
  rubricTotal: number;
  completed?: boolean;
  durationMs?: number;
  totalTokens?: number;
  estimatedCostUsd?: number | null;
  turnTraces?: ReadonlyArray<E2EScenarioTurnTrace>;
  userTurnCount?: number;
}): Extract<E2EPairedConditionExecution, { status: 'completed' }> {
  const executionCompleted = input.completed ?? true;
  const passed = executionCompleted && input.rubricPassed === input.rubricTotal;
  const defaultRoute =
    input.condition === 'forced_agentic'
      ? ({ directive: 'forced_agentic', mode: 'agentic' } as const)
      : input.condition === 'forced_chitchat'
        ? ({ directive: 'forced_chitchat', mode: 'chitchat' } as const)
        : ({ directive: 'production_auto', mode: 'chitchat' } as const);
  const turnTraces = input.turnTraces ?? [
    buildPairedTurnTrace(
      input.condition === 'memory_off'
        ? { sourceThreadIdHash: null, instrumentationStatus: 'opt_out', events: [] }
        : {
            sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
            instrumentationStatus: 'recorded',
            events: [defaultRetrievalEvent(input.condition)],
          },
      { route: defaultRoute },
    ),
  ];
  return {
    condition: input.condition,
    conditionConfigHash: stableHash(`${input.condition}-config`),
    executionIdentityHash: stableHash(`${input.condition}-execution-placeholder`),
    oracleEvidenceCount: input.condition === 'oracle_evidence' ? 1 : 0,
    status: 'completed',
    result: buildFixtureResult({
      fixtureId: 'paired-public-report',
      conversationId: 'PRIVATE-CONVERSATION-ID',
      completed: executionCompleted,
      durationMs: input.durationMs ?? 100,
      errors: ['PRIVATE-RUNTIME-ERROR-PROSE'],
      toolCalls: [
        {
          id: 'PRIVATE-TOOL-CALL-ID',
          name: 'memory_search',
          arguments: '{"query":"PRIVATE-TOOL-ARGUMENT"}',
        },
      ],
      usage: {
        inputTokens: 80,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: input.totalTokens ?? 100,
        eventCount: 1,
      },
      estimatedCost:
        input.estimatedCostUsd === null
          ? { status: 'unavailable', usd: null }
          : { status: 'available', usd: input.estimatedCostUsd ?? 0.01 },
      turnTraces,
      userTurnCount: input.userTurnCount ?? turnTraces.length,
    }),
    assessment: {
      executionCompleted,
      rubricPassed: input.rubricPassed,
      rubricTotal: input.rubricTotal,
      passed,
    },
  };
}

export function failedCondition(
  condition: Extract<E2EPairedConditionExecution, { status: 'failed' }>['condition'],
): Extract<E2EPairedConditionExecution, { status: 'failed' }> {
  return {
    condition,
    conditionConfigHash: stableHash(`${condition}-config`),
    executionIdentityHash: stableHash(`${condition}-execution-placeholder`),
    oracleEvidenceCount: 0,
    status: 'failed',
    category: 'condition_execution',
    errorHash: stableHash('PRIVATE-INFRASTRUCTURE-ERROR'),
    privateError: 'PRIVATE-INFRASTRUCTURE-ERROR',
  };
}

export function runtime(
  conditions: E2EPairedRuntimeResult['conditions'],
  overrides: Partial<E2EPairedRuntimeResult> = {},
): E2EPairedRuntimeResult {
  const cleanup = overrides.cleanup ?? { status: 'completed' as const };
  const source = overrides.source ?? PAIRED_TEST_SOURCE_BINDING;
  const pairIdHash = stableHash('PRIVATE-PAIR-ID');
  const executionSeed = overrides.executionSeed ?? 2;
  const comparison = {
    referenceCondition: conditions[0]?.condition ?? 'production_auto',
    candidateCondition: conditions[1]?.condition ?? conditions[0]?.condition ?? 'memory_off',
  };
  const conditionsWithIdentities = conditions.map((condition) => ({
    ...condition,
    executionIdentityHash: buildE2EPairedExecutionIdentityHash({
      pairIdHash,
      seed: executionSeed,
      condition: condition.condition,
    }),
  }));
  const validForDeltaClaims =
    source.status === 'clean_match' &&
    cleanup.status === 'completed' &&
    conditionsWithIdentities.every((condition) => condition.status === 'completed');
  return {
    schemaVersion: E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
    source,
    model: overrides.model ?? PAIRED_TEST_MODEL,
    scenarioInputHash: overrides.scenarioInputHash ?? stableHash('PRIVATE-SCENARIO-INPUT'),
    pairIdHash,
    invariantConfigHash: stableHash('PRIVATE-INVARIANT-CONFIG'),
    comparison,
    executionSeed,
    executionOrder: resolveE2EPairedExecutionOrder(comparison, executionSeed),
    conditions: conditionsWithIdentities,
    cleanup,
    validForDeltaClaims,
    ...overrides,
  };
}
