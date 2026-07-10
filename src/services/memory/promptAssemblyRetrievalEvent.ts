import type { NextTurnMemoryConsistencyResult } from './nextTurnConsistency';
import type { RetrievalOrchestratorTimings } from './retrievalOrchestrator';
import {
  buildMemoryRetrievalQueryFingerprint,
  buildMemoryRetrievalScopeHash,
  recordMemoryRetrievalEvent,
} from './retrievalLog';
import { MEMORY_RETRIEVAL_SELECTED_ID_LIMIT } from './retrievalEventTypes';
import type {
  MemoryRetrievalBarrier,
  MemoryRetrievalEventRejectionCode,
  MemoryRetrievalSelector,
} from './retrievalEventTypes';

const MAX_EVENT_TIMING_MS = 600_000;
const MAX_EVENT_COUNT = 1_000_000;

export type PromptAssemblyRetrievalState = 'completed' | 'degraded' | 'disabled';

export type PromptAssemblyRetrievalEventInput = Readonly<{
  query: string;
  memoryConversationId?: string;
  sourceThreadId?: string;
  taskScopePresent: boolean;
  state: PromptAssemblyRetrievalState;
  selectedFactIds: ReadonlyArray<string>;
  selectedEpisodeIds: ReadonlyArray<string>;
  retrievalTimings?: RetrievalOrchestratorTimings;
  consistencyBarrier?: NextTurnMemoryConsistencyResult;
  createdAt?: number;
}>;

export type PromptAssemblyRetrievalEventResult =
  | { status: 'recorded'; code: 'recorded'; eventId: string }
  | { status: 'rejected'; code: MemoryRetrievalEventRejectionCode }
  | { status: 'failed'; code: 'storage_error' | 'derivation_error' }
  | { status: 'skipped'; code: 'opt_out' };

function boundedInteger(value: number | undefined, maximum = MAX_EVENT_TIMING_MS): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), maximum));
}

function selectedIds(ids: ReadonlyArray<string>): string[] {
  return Array.from(new Set(ids)).slice(0, MEMORY_RETRIEVAL_SELECTED_ID_LIMIT);
}

function selectorFromTiming(
  timings: RetrievalOrchestratorTimings | undefined,
): MemoryRetrievalSelector {
  if (timings?.recall?.selectorApplied === true) {
    return { mode: 'semantic', outcome: 'applied' };
  }
  if (timings?.recall?.selectorApplied === false) {
    return { mode: 'semantic', outcome: 'deterministic_fallback' };
  }
  return { mode: 'deterministic', outcome: 'not_requested' };
}

function barrierFromConsistency(
  barrier: NextTurnMemoryConsistencyResult | undefined,
): MemoryRetrievalBarrier | null {
  if (!barrier || barrier.outcome === 'opt_out') return null;
  return {
    outcome: barrier.outcome,
    waitMs: boundedInteger(barrier.waitedMs),
    queueAgeMs:
      barrier.queueAgeMs === null
        ? null
        : boundedInteger(barrier.queueAgeMs, 31 * 24 * 60 * 60 * 1_000),
  };
}

export async function recordPromptAssemblyRetrievalEvent(
  input: PromptAssemblyRetrievalEventInput,
): Promise<PromptAssemblyRetrievalEventResult> {
  if (input.consistencyBarrier?.outcome === 'opt_out') {
    return { status: 'skipped', code: 'opt_out' };
  }

  try {
    const [queryFingerprint, memoryConversationIdHash, sourceThreadIdHash] = await Promise.all([
      buildMemoryRetrievalQueryFingerprint(input.query),
      buildMemoryRetrievalScopeHash('memory_conversation', input.memoryConversationId),
      buildMemoryRetrievalScopeHash('source_thread', input.sourceThreadId),
    ]);
    const disabled = input.state === 'disabled';
    const factIds = disabled ? [] : selectedIds(input.selectedFactIds);
    const episodeIds = disabled ? [] : selectedIds(input.selectedEpisodeIds);
    const factTiming = disabled ? undefined : input.retrievalTimings?.recall;
    const episodeTiming = disabled ? undefined : input.retrievalTimings?.episodes;
    const candidateFactCount = disabled
      ? 0
      : Math.max(factIds.length, boundedInteger(factTiming?.candidateCount, MAX_EVENT_COUNT));
    const candidateEpisodeCount = disabled
      ? 0
      : Math.max(episodeIds.length, boundedInteger(episodeTiming?.candidateCount, MAX_EVENT_COUNT));

    const result = await recordMemoryRetrievalEvent({
      operation: 'prompt_assembly',
      mode: disabled ? 'disabled' : input.query.trim() ? 'query' : 'recent',
      outcome: input.state,
      queryFingerprint,
      scope: {
        memoryConversationIdHash,
        sourceThreadIdHash,
        taskScopePresent: input.taskScopePresent,
      },
      counts: {
        candidateFactCount: Math.max(
          candidateFactCount,
          disabled ? 0 : input.selectedFactIds.length,
        ),
        selectedFactCount: disabled ? 0 : input.selectedFactIds.length,
        selectedFactIds: factIds,
        candidateEpisodeCount: Math.max(
          candidateEpisodeCount,
          disabled ? 0 : input.selectedEpisodeIds.length,
        ),
        selectedEpisodeCount: disabled ? 0 : input.selectedEpisodeIds.length,
        selectedEpisodeIds: episodeIds,
      },
      timings: {
        planMs: disabled ? 0 : boundedInteger(input.retrievalTimings?.planMs),
        factRecallMs: disabled ? 0 : boundedInteger(input.retrievalTimings?.recallMs),
        episodeRecallMs: disabled ? 0 : boundedInteger(input.retrievalTimings?.episodesMs),
        candidateFetchMs: disabled
          ? 0
          : boundedInteger((factTiming?.candidateFetchMs ?? 0) + (episodeTiming?.fetchMs ?? 0)),
        scoreMs: disabled
          ? 0
          : boundedInteger((factTiming?.scoreMs ?? 0) + (episodeTiming?.scoreMs ?? 0)),
        selectorMs: disabled ? 0 : boundedInteger(factTiming?.selectorMs),
        totalMs: disabled ? 0 : boundedInteger(input.retrievalTimings?.totalMs),
      },
      selector: disabled
        ? { mode: 'deterministic', outcome: 'not_requested' }
        : selectorFromTiming(input.retrievalTimings),
      barrier: disabled ? null : barrierFromConsistency(input.consistencyBarrier),
      ...(typeof input.createdAt === 'number' ? { createdAt: input.createdAt } : {}),
    });
    return result.status === 'recorded' ? { ...result, code: 'recorded' } : result;
  } catch {
    return { status: 'failed', code: 'derivation_error' };
  }
}
