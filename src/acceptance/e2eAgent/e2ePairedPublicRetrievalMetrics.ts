import {
  MEMORY_RETRIEVAL_BARRIER_OUTCOMES,
  MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT,
  MEMORY_RETRIEVAL_EXPANSION_OUTCOMES,
  MEMORY_RETRIEVAL_MODES,
  MEMORY_RETRIEVAL_OPERATIONS,
  MEMORY_RETRIEVAL_OUTCOMES,
  MEMORY_RETRIEVAL_SELECTED_ID_LIMIT,
  MEMORY_RETRIEVAL_SELECTOR_MODES,
  MEMORY_RETRIEVAL_SELECTOR_OUTCOMES,
} from '../../services/memory/retrievalEventTypes';
import type { E2EScenarioTurnTrace } from './types';
import { stableHash, stableStringify } from './e2eTraceRedaction';

const MAX_QUERY_LENGTH = 20_000;
const MAX_QUERY_UNIT_COUNT = 4_096;
const MAX_RETRIEVAL_COUNT = 1_000_000;
const MAX_TIMING_MS = 600_000;
const MAX_QUEUE_AGE_MS = 31 * 24 * 60 * 60 * 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STRUCTURAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type E2EPairedPublicRetrievalMetrics = Readonly<{
  turnStatusCounts: Readonly<{
    recorded: number;
    missing: number;
    optOut: number;
    overflow: number;
  }>;
  eventCount: number;
  retrievalFailureCount: number;
  instrumentationFailureTurnCount: number;
  candidateFactCount: number;
  selectedFactCount: number;
  candidateEpisodeCount: number;
  selectedEpisodeCount: number;
  selectedFactIdCoverage: 'none' | 'complete' | 'truncated';
  selectedEpisodeIdCoverage: 'none' | 'complete' | 'truncated';
  selectedFactIdSetHash: string | null;
  selectedEpisodeIdSetHash: string | null;
  modeCounts: Readonly<{ query: number; recent: number; disabled: number }>;
  outcomeCounts: Readonly<{
    completed: number;
    degraded: number;
    failed: number;
    disabled: number;
  }>;
  selectorCounts: Readonly<{
    applied: number;
    deterministicFallback: number;
    notRequested: number;
  }>;
  expansionOutcomeCounts: Readonly<{
    notRequested: number;
    completed: number;
    scopeUnavailable: number;
    failed: number;
  }>;
  expansionTotals: Readonly<{
    requestedSourceCount: number;
    acceptedSourceCount: number;
    sourceWithEvidenceCount: number;
    emittedEvidenceCount: number;
    promptBudgetDroppedCount: number;
    promptChars: number;
    durationMs: number;
  }>;
  barrierOutcomeCounts: Readonly<{
    none: number;
    noJob: number;
    completed: number;
    degraded: number;
    timedOut: number;
  }>;
  barrierWaitMsTotal: number;
  barrierQueueAgeMsTotal: number;
  barrierQueueAgeObservedCount: number;
  taskScopePresentCount: number;
  timingTotals: Readonly<{
    planMs: number;
    factRecallMs: number;
    episodeRecallMs: number;
    candidateFetchMs: number;
    scoreMs: number;
    selectorMs: number;
    evidenceExpansionMs: number;
    totalMs: number;
  }>;
}>;

function requireBoundedInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${label} must be a bounded non-negative integer.`);
  }
  return value as number;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is unsupported.`);
  }
  return value as T;
}

function addBounded(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error(`${label} exceeds the safe integer bound.`);
  return sum;
}

function selectedIdSetHash(domain: 'fact' | 'episode', values: ReadonlySet<string>): string | null {
  if (values.size === 0) return null;
  return stableHash(
    `e2e-paired-retrieval-selected-${domain}\u0000${stableStringify(
      Array.from(values).sort((left, right) => left.localeCompare(right)),
    )}`,
  );
}

function validateSelectedIds(
  values: ReadonlyArray<string>,
  selectedCount: number,
  label: string,
): void {
  if (
    !Array.isArray(values) ||
    values.length > MEMORY_RETRIEVAL_SELECTED_ID_LIMIT ||
    values.length > selectedCount ||
    values.some(
      (value) =>
        typeof value !== 'string' || value !== value.trim() || !STRUCTURAL_ID_PATTERN.test(value),
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${label} must contain unique bounded structural IDs.`);
  }
}

function incrementMode(
  counters: { query: number; recent: number; disabled: number },
  mode: (typeof MEMORY_RETRIEVAL_MODES)[number],
): void {
  counters[mode] = addBounded(counters[mode], 1, `modeCounts.${mode}`);
}

function incrementOutcome(
  counters: { completed: number; degraded: number; failed: number; disabled: number },
  outcome: (typeof MEMORY_RETRIEVAL_OUTCOMES)[number],
): void {
  counters[outcome] = addBounded(counters[outcome], 1, `outcomeCounts.${outcome}`);
}

export function buildE2EPairedPublicRetrievalMetrics(
  turns: ReadonlyArray<Pick<E2EScenarioTurnTrace, 'retrieval'>>,
): E2EPairedPublicRetrievalMetrics {
  if (!Array.isArray(turns)) throw new Error('Paired retrieval turns must be an array.');
  const turnStatusCounts = { recorded: 0, missing: 0, optOut: 0, overflow: 0 };
  const modeCounts = { query: 0, recent: 0, disabled: 0 };
  const outcomeCounts = { completed: 0, degraded: 0, failed: 0, disabled: 0 };
  const selectorCounts = { applied: 0, deterministicFallback: 0, notRequested: 0 };
  const expansionOutcomeCounts = {
    notRequested: 0,
    completed: 0,
    scopeUnavailable: 0,
    failed: 0,
  };
  const expansionTotals = {
    requestedSourceCount: 0,
    acceptedSourceCount: 0,
    sourceWithEvidenceCount: 0,
    emittedEvidenceCount: 0,
    promptBudgetDroppedCount: 0,
    promptChars: 0,
    durationMs: 0,
  };
  const barrierOutcomeCounts = {
    none: 0,
    noJob: 0,
    completed: 0,
    degraded: 0,
    timedOut: 0,
  };
  const timingTotals = {
    planMs: 0,
    factRecallMs: 0,
    episodeRecallMs: 0,
    candidateFetchMs: 0,
    scoreMs: 0,
    selectorMs: 0,
    evidenceExpansionMs: 0,
    totalMs: 0,
  };
  const factIds = new Set<string>();
  const episodeIds = new Set<string>();
  const eventIds = new Set<string>();
  let eventCount = 0;
  let retrievalFailureCount = 0;
  let candidateFactCount = 0;
  let selectedFactCount = 0;
  let candidateEpisodeCount = 0;
  let selectedEpisodeCount = 0;
  let factIdsComplete = true;
  let episodeIdsComplete = true;
  let barrierWaitMsTotal = 0;
  let barrierQueueAgeMsTotal = 0;
  let barrierQueueAgeObservedCount = 0;
  let taskScopePresentCount = 0;

  for (const turn of turns) {
    const status = requireEnum(
      turn.retrieval.instrumentationStatus,
      ['recorded', 'missing', 'opt_out', 'overflow'],
      'retrieval.instrumentationStatus',
    );
    if (!Array.isArray(turn.retrieval.events)) {
      throw new Error('Paired retrieval events must be an array.');
    }
    if (turn.retrieval.events.length > MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT) {
      throw new Error('Paired retrieval evidence exceeds the bounded retention window.');
    }
    const sourceThreadIdHash = turn.retrieval.sourceThreadIdHash;
    if (
      (status === 'opt_out' &&
        (sourceThreadIdHash !== null || turn.retrieval.events.length !== 0)) ||
      (status !== 'opt_out' &&
        (typeof sourceThreadIdHash !== 'string' || !SHA256_PATTERN.test(sourceThreadIdHash))) ||
      (status === 'recorded' && turn.retrieval.events.length === 0) ||
      (status === 'missing' && turn.retrieval.events.length !== 0)
    ) {
      throw new Error('Paired retrieval instrumentation state is inconsistent.');
    }
    if (status === 'opt_out') {
      turnStatusCounts.optOut = addBounded(turnStatusCounts.optOut, 1, 'turnStatusCounts.optOut');
    } else if (status === 'recorded') {
      turnStatusCounts.recorded = addBounded(
        turnStatusCounts.recorded,
        1,
        'turnStatusCounts.recorded',
      );
    } else if (status === 'missing') {
      turnStatusCounts.missing = addBounded(
        turnStatusCounts.missing,
        1,
        'turnStatusCounts.missing',
      );
    } else {
      turnStatusCounts.overflow = addBounded(
        turnStatusCounts.overflow,
        1,
        'turnStatusCounts.overflow',
      );
    }

    for (const event of turn.retrieval.events) {
      if (typeof event.id !== 'string' || !STRUCTURAL_ID_PATTERN.test(event.id)) {
        throw new Error('retrieval.id must be a bounded structural ID.');
      }
      if (eventIds.has(event.id)) {
        throw new Error('Paired retrieval evidence must not duplicate event IDs.');
      }
      eventIds.add(event.id);
      if (
        requireEnum(event.operation, MEMORY_RETRIEVAL_OPERATIONS, 'retrieval.operation') !==
        'prompt_assembly'
      ) {
        throw new Error('Paired retrieval evidence must describe prompt assembly.');
      }
      const mode = requireEnum(event.mode, MEMORY_RETRIEVAL_MODES, 'retrieval.mode');
      const outcome = requireEnum(event.outcome, MEMORY_RETRIEVAL_OUTCOMES, 'retrieval.outcome');
      const selectorMode = requireEnum(
        event.selector.mode,
        MEMORY_RETRIEVAL_SELECTOR_MODES,
        'retrieval.selector.mode',
      );
      const selectorOutcome = requireEnum(
        event.selector.outcome,
        MEMORY_RETRIEVAL_SELECTOR_OUTCOMES,
        'retrieval.selector.outcome',
      );
      if (
        (selectorMode === 'deterministic' && selectorOutcome !== 'not_requested') ||
        (selectorMode === 'semantic' && selectorOutcome === 'not_requested')
      ) {
        throw new Error('Paired retrieval selector state is inconsistent.');
      }
      if (
        event.queryFingerprint.hashAlgorithm !== 'sha256' ||
        !SHA256_PATTERN.test(event.queryFingerprint.hash)
      ) {
        throw new Error('Paired retrieval query fingerprint is invalid.');
      }
      requireBoundedInteger(
        event.queryFingerprint.length,
        'retrieval.query.length',
        MAX_QUERY_LENGTH,
      );
      requireBoundedInteger(
        event.queryFingerprint.unitCount,
        'retrieval.query.unitCount',
        MAX_QUERY_UNIT_COUNT,
      );
      if (
        event.scope.sourceThreadIdHash !== sourceThreadIdHash ||
        (event.scope.memoryConversationIdHash !== null &&
          (typeof event.scope.memoryConversationIdHash !== 'string' ||
            !SHA256_PATTERN.test(event.scope.memoryConversationIdHash))) ||
        typeof event.scope.taskScopePresent !== 'boolean'
      ) {
        throw new Error('Paired retrieval event scope is invalid.');
      }
      if (event.scope.taskScopePresent) {
        taskScopePresentCount = addBounded(taskScopePresentCount, 1, 'taskScopePresentCount');
      }

      const candidateFacts = requireBoundedInteger(
        event.counts.candidateFactCount,
        'retrieval.candidateFactCount',
        MAX_RETRIEVAL_COUNT,
      );
      const selectedFacts = requireBoundedInteger(
        event.counts.selectedFactCount,
        'retrieval.selectedFactCount',
        candidateFacts,
      );
      const candidateEpisodes = requireBoundedInteger(
        event.counts.candidateEpisodeCount,
        'retrieval.candidateEpisodeCount',
        MAX_RETRIEVAL_COUNT,
      );
      const selectedEpisodes = requireBoundedInteger(
        event.counts.selectedEpisodeCount,
        'retrieval.selectedEpisodeCount',
        candidateEpisodes,
      );
      validateSelectedIds(event.counts.selectedFactIds, selectedFacts, 'retrieval.selectedFactIds');
      validateSelectedIds(
        event.counts.selectedEpisodeIds,
        selectedEpisodes,
        'retrieval.selectedEpisodeIds',
      );

      const normalizedTimings = {
        planMs: requireBoundedInteger(
          event.timings.planMs,
          'retrieval.timings.planMs',
          MAX_TIMING_MS,
        ),
        factRecallMs: requireBoundedInteger(
          event.timings.factRecallMs,
          'retrieval.timings.factRecallMs',
          MAX_TIMING_MS,
        ),
        episodeRecallMs: requireBoundedInteger(
          event.timings.episodeRecallMs,
          'retrieval.timings.episodeRecallMs',
          MAX_TIMING_MS,
        ),
        candidateFetchMs: requireBoundedInteger(
          event.timings.candidateFetchMs,
          'retrieval.timings.candidateFetchMs',
          MAX_TIMING_MS,
        ),
        scoreMs: requireBoundedInteger(
          event.timings.scoreMs,
          'retrieval.timings.scoreMs',
          MAX_TIMING_MS,
        ),
        selectorMs: requireBoundedInteger(
          event.timings.selectorMs,
          'retrieval.timings.selectorMs',
          MAX_TIMING_MS,
        ),
        evidenceExpansionMs: requireBoundedInteger(
          event.timings.evidenceExpansionMs,
          'retrieval.timings.evidenceExpansionMs',
          MAX_TIMING_MS,
        ),
        totalMs: requireBoundedInteger(
          event.timings.totalMs,
          'retrieval.timings.totalMs',
          MAX_TIMING_MS,
        ),
      };
      if (
        !event.expansion ||
        typeof event.expansion !== 'object' ||
        Array.isArray(event.expansion)
      ) {
        throw new Error('retrieval.expansion must be a closed object.');
      }
      const expansionOutcome = requireEnum(
        event.expansion.outcome,
        MEMORY_RETRIEVAL_EXPANSION_OUTCOMES,
        'retrieval.expansion.outcome',
      );
      const expansion = {
        requestedSourceCount: requireBoundedInteger(
          event.expansion.requestedSourceCount,
          'retrieval.expansion.requestedSourceCount',
          MAX_RETRIEVAL_COUNT,
        ),
        acceptedSourceCount: requireBoundedInteger(
          event.expansion.acceptedSourceCount,
          'retrieval.expansion.acceptedSourceCount',
          12,
        ),
        sourceWithEvidenceCount: requireBoundedInteger(
          event.expansion.sourceWithEvidenceCount,
          'retrieval.expansion.sourceWithEvidenceCount',
          12,
        ),
        emittedEvidenceCount: requireBoundedInteger(
          event.expansion.emittedEvidenceCount,
          'retrieval.expansion.emittedEvidenceCount',
          24,
        ),
        promptBudgetDroppedCount: requireBoundedInteger(
          event.expansion.promptBudgetDroppedCount,
          'retrieval.expansion.promptBudgetDroppedCount',
          MAX_RETRIEVAL_COUNT,
        ),
        promptChars: requireBoundedInteger(
          event.expansion.promptChars,
          'retrieval.expansion.promptChars',
          3_200,
        ),
        durationMs: requireBoundedInteger(
          event.expansion.durationMs,
          'retrieval.expansion.durationMs',
          MAX_TIMING_MS,
        ),
      };
      const zeroExpansionResult =
        expansion.acceptedSourceCount === 0 &&
        expansion.sourceWithEvidenceCount === 0 &&
        expansion.emittedEvidenceCount === 0 &&
        expansion.promptBudgetDroppedCount === 0 &&
        expansion.promptChars === 0;
      if (
        expansion.acceptedSourceCount > expansion.requestedSourceCount ||
        expansion.sourceWithEvidenceCount > expansion.acceptedSourceCount ||
        expansion.durationMs !== normalizedTimings.evidenceExpansionMs ||
        normalizedTimings.totalMs < expansion.durationMs ||
        (expansion.emittedEvidenceCount === 0) !== (expansion.promptChars === 0) ||
        (expansion.emittedEvidenceCount > 0 && expansion.sourceWithEvidenceCount === 0) ||
        (expansionOutcome === 'not_requested' &&
          (expansion.requestedSourceCount !== 0 ||
            !zeroExpansionResult ||
            expansion.durationMs !== 0)) ||
        (expansionOutcome === 'scope_unavailable' &&
          (expansion.requestedSourceCount === 0 ||
            !zeroExpansionResult ||
            expansion.durationMs !== 0)) ||
        (expansionOutcome === 'failed' &&
          (expansion.requestedSourceCount === 0 ||
            !zeroExpansionResult ||
            (outcome !== 'degraded' && outcome !== 'failed'))) ||
        (expansionOutcome === 'completed' && expansion.requestedSourceCount === 0)
      ) {
        throw new Error('Paired retrieval expansion state is inconsistent.');
      }
      requireBoundedInteger(event.createdAt, 'retrieval.createdAt');

      const disabled = mode === 'disabled';
      if (
        disabled !== (outcome === 'disabled') ||
        (disabled &&
          (candidateFacts !== 0 ||
            selectedFacts !== 0 ||
            event.counts.selectedFactIds.length !== 0 ||
            candidateEpisodes !== 0 ||
            selectedEpisodes !== 0 ||
            event.counts.selectedEpisodeIds.length !== 0 ||
            Object.values(normalizedTimings).some((value) => value !== 0) ||
            expansionOutcome !== 'not_requested' ||
            selectorMode !== 'deterministic' ||
            selectorOutcome !== 'not_requested' ||
            event.barrier !== null))
      ) {
        throw new Error('Paired retrieval disabled-event state is inconsistent.');
      }

      eventCount = addBounded(eventCount, 1, 'eventCount');
      incrementMode(modeCounts, mode);
      incrementOutcome(outcomeCounts, outcome);
      if (outcome === 'degraded' || outcome === 'failed') {
        retrievalFailureCount = addBounded(retrievalFailureCount, 1, 'retrievalFailureCount');
      }
      if (selectorOutcome === 'applied') {
        selectorCounts.applied = addBounded(selectorCounts.applied, 1, 'selectorCounts.applied');
      } else if (selectorOutcome === 'deterministic_fallback') {
        selectorCounts.deterministicFallback = addBounded(
          selectorCounts.deterministicFallback,
          1,
          'selectorCounts.deterministicFallback',
        );
      } else {
        selectorCounts.notRequested = addBounded(
          selectorCounts.notRequested,
          1,
          'selectorCounts.notRequested',
        );
      }
      if (expansionOutcome === 'not_requested') {
        expansionOutcomeCounts.notRequested = addBounded(
          expansionOutcomeCounts.notRequested,
          1,
          'expansionOutcomeCounts.notRequested',
        );
      } else if (expansionOutcome === 'scope_unavailable') {
        expansionOutcomeCounts.scopeUnavailable = addBounded(
          expansionOutcomeCounts.scopeUnavailable,
          1,
          'expansionOutcomeCounts.scopeUnavailable',
        );
      } else {
        expansionOutcomeCounts[expansionOutcome] = addBounded(
          expansionOutcomeCounts[expansionOutcome],
          1,
          `expansionOutcomeCounts.${expansionOutcome}`,
        );
      }
      for (const key of Object.keys(expansionTotals) as Array<keyof typeof expansionTotals>) {
        expansionTotals[key] = addBounded(
          expansionTotals[key],
          expansion[key],
          `expansionTotals.${key}`,
        );
      }
      candidateFactCount = addBounded(candidateFactCount, candidateFacts, 'candidateFactCount');
      selectedFactCount = addBounded(selectedFactCount, selectedFacts, 'selectedFactCount');
      candidateEpisodeCount = addBounded(
        candidateEpisodeCount,
        candidateEpisodes,
        'candidateEpisodeCount',
      );
      selectedEpisodeCount = addBounded(
        selectedEpisodeCount,
        selectedEpisodes,
        'selectedEpisodeCount',
      );
      if (event.counts.selectedFactIds.length !== selectedFacts) factIdsComplete = false;
      if (event.counts.selectedEpisodeIds.length !== selectedEpisodes) episodeIdsComplete = false;
      event.counts.selectedFactIds.forEach((id: string) => factIds.add(id));
      event.counts.selectedEpisodeIds.forEach((id: string) => episodeIds.add(id));
      for (const key of Object.keys(timingTotals) as Array<keyof typeof timingTotals>) {
        timingTotals[key] = addBounded(
          timingTotals[key],
          normalizedTimings[key],
          `timingTotals.${key}`,
        );
      }

      if (event.barrier === null) {
        barrierOutcomeCounts.none = addBounded(
          barrierOutcomeCounts.none,
          1,
          'barrierOutcomeCounts.none',
        );
      } else {
        if (typeof event.barrier !== 'object' || Array.isArray(event.barrier)) {
          throw new Error('retrieval.barrier must be an object or null.');
        }
        const barrierOutcome = requireEnum(
          event.barrier.outcome,
          MEMORY_RETRIEVAL_BARRIER_OUTCOMES,
          'retrieval.barrier.outcome',
        );
        const waitMs = requireBoundedInteger(
          event.barrier.waitMs,
          'retrieval.barrier.waitMs',
          MAX_TIMING_MS,
        );
        barrierWaitMsTotal = addBounded(barrierWaitMsTotal, waitMs, 'barrierWaitMsTotal');
        if (event.barrier.queueAgeMs !== null) {
          const queueAgeMs = requireBoundedInteger(
            event.barrier.queueAgeMs,
            'retrieval.barrier.queueAgeMs',
            MAX_QUEUE_AGE_MS,
          );
          barrierQueueAgeMsTotal = addBounded(
            barrierQueueAgeMsTotal,
            queueAgeMs,
            'barrierQueueAgeMsTotal',
          );
          barrierQueueAgeObservedCount = addBounded(
            barrierQueueAgeObservedCount,
            1,
            'barrierQueueAgeObservedCount',
          );
        }
        if (barrierOutcome === 'no_job') {
          barrierOutcomeCounts.noJob = addBounded(
            barrierOutcomeCounts.noJob,
            1,
            'barrierOutcomeCounts.noJob',
          );
        } else if (barrierOutcome === 'timed_out') {
          barrierOutcomeCounts.timedOut = addBounded(
            barrierOutcomeCounts.timedOut,
            1,
            'barrierOutcomeCounts.timedOut',
          );
        } else {
          barrierOutcomeCounts[barrierOutcome] = addBounded(
            barrierOutcomeCounts[barrierOutcome],
            1,
            `barrierOutcomeCounts.${barrierOutcome}`,
          );
        }
      }
    }
  }

  const selectedFactIdCoverage =
    selectedFactCount === 0 ? 'none' : factIdsComplete ? 'complete' : 'truncated';
  const selectedEpisodeIdCoverage =
    selectedEpisodeCount === 0 ? 'none' : episodeIdsComplete ? 'complete' : 'truncated';
  return {
    turnStatusCounts,
    eventCount,
    retrievalFailureCount,
    instrumentationFailureTurnCount: addBounded(
      turnStatusCounts.missing,
      turnStatusCounts.overflow,
      'instrumentationFailureTurnCount',
    ),
    candidateFactCount,
    selectedFactCount,
    candidateEpisodeCount,
    selectedEpisodeCount,
    selectedFactIdCoverage,
    selectedEpisodeIdCoverage,
    selectedFactIdSetHash:
      selectedFactIdCoverage === 'complete' ? selectedIdSetHash('fact', factIds) : null,
    selectedEpisodeIdSetHash:
      selectedEpisodeIdCoverage === 'complete' ? selectedIdSetHash('episode', episodeIds) : null,
    modeCounts,
    outcomeCounts,
    selectorCounts,
    expansionOutcomeCounts,
    expansionTotals,
    barrierOutcomeCounts,
    barrierWaitMsTotal,
    barrierQueueAgeMsTotal,
    barrierQueueAgeObservedCount,
    taskScopePresentCount,
    timingTotals,
  };
}
