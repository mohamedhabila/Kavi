import {
  buildMemoryRetrievalScopeHash,
  readRecentMemoryRetrievalEvents,
} from '../../services/memory/retrievalLog';
import type { MemoryRetrievalEvent } from '../../services/memory/retrievalEventTypes';
import { MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT } from '../../services/memory/retrievalEventTypes';

const FOREGROUND_RETRIEVAL_EVENT_READ_LIMIT = MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT;

export type ForegroundScenarioRetrievalEvidence = Readonly<{
  sourceThreadIdHash: string | null;
  instrumentationStatus: 'recorded' | 'missing' | 'opt_out' | 'overflow';
  events: ReadonlyArray<MemoryRetrievalEvent>;
}>;

type ForegroundScenarioRetrievalCapture = Readonly<{
  sourceThreadIdHash: string | null;
  existingEventIds: ReadonlySet<string>;
  memoryOptOut: boolean;
}>;

function projectClosedEvent(event: MemoryRetrievalEvent): MemoryRetrievalEvent {
  return {
    id: event.id,
    operation: event.operation,
    mode: event.mode,
    outcome: event.outcome,
    queryFingerprint: { ...event.queryFingerprint },
    scope: { ...event.scope },
    counts: {
      candidateFactCount: event.counts.candidateFactCount,
      selectedFactCount: event.counts.selectedFactCount,
      selectedFactIds: [...event.counts.selectedFactIds],
      candidateEpisodeCount: event.counts.candidateEpisodeCount,
      selectedEpisodeCount: event.counts.selectedEpisodeCount,
      selectedEpisodeIds: [...event.counts.selectedEpisodeIds],
    },
    timings: { ...event.timings },
    expansion: {
      outcome: event.expansion.outcome,
      requestedSourceCount: event.expansion.requestedSourceCount,
      acceptedSourceCount: event.expansion.acceptedSourceCount,
      sourceWithEvidenceCount: event.expansion.sourceWithEvidenceCount,
      emittedEvidenceCount: event.expansion.emittedEvidenceCount,
      promptBudgetDroppedCount: event.expansion.promptBudgetDroppedCount,
      promptChars: event.expansion.promptChars,
      durationMs: event.expansion.durationMs,
    },
    selector: { ...event.selector },
    barrier: event.barrier ? { ...event.barrier } : null,
    createdAt: event.createdAt,
  };
}

function readScopedEvents(sourceThreadIdHash: string): MemoryRetrievalEvent[] {
  return readRecentMemoryRetrievalEvents({
    sourceThreadIdHash,
    operation: 'prompt_assembly',
    limit: FOREGROUND_RETRIEVAL_EVENT_READ_LIMIT,
  });
}

export async function beginForegroundScenarioRetrievalCapture(input: {
  sourceThreadId: string;
  memoryOptOut: boolean;
}): Promise<ForegroundScenarioRetrievalCapture> {
  if (input.memoryOptOut) {
    return {
      sourceThreadIdHash: null,
      existingEventIds: new Set(),
      memoryOptOut: true,
    };
  }
  const sourceThreadIdHash = await buildMemoryRetrievalScopeHash(
    'source_thread',
    input.sourceThreadId,
  );
  if (!sourceThreadIdHash) {
    throw new Error('Foreground retrieval capture requires a source-thread hash.');
  }
  return {
    sourceThreadIdHash,
    existingEventIds: new Set(readScopedEvents(sourceThreadIdHash).map((event) => event.id)),
    memoryOptOut: input.memoryOptOut,
  };
}

export function completeForegroundScenarioRetrievalCapture(input: {
  capture: ForegroundScenarioRetrievalCapture;
}): ForegroundScenarioRetrievalEvidence {
  if (input.capture.memoryOptOut) {
    return { sourceThreadIdHash: null, instrumentationStatus: 'opt_out', events: [] };
  }
  if (!input.capture.sourceThreadIdHash) {
    throw new Error('Foreground retrieval capture lost its source-thread hash.');
  }
  const currentEvents = readScopedEvents(input.capture.sourceThreadIdHash);
  const currentEventIds = new Set(currentEvents.map((event) => event.id));
  const baselineEventWasEvicted = Array.from(input.capture.existingEventIds).some(
    (eventId) => !currentEventIds.has(eventId),
  );
  const events = currentEvents
    .filter((event) => !input.capture.existingEventIds.has(event.id))
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map(projectClosedEvent);
  return {
    sourceThreadIdHash: input.capture.sourceThreadIdHash,
    instrumentationStatus:
      baselineEventWasEvicted ||
      (input.capture.existingEventIds.size === 0 &&
        currentEvents.length === FOREGROUND_RETRIEVAL_EVENT_READ_LIMIT)
        ? 'overflow'
        : events.length > 0
          ? 'recorded'
          : 'missing',
    events,
  };
}
