export const MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT = 500;
export const MEMORY_RETRIEVAL_SELECTED_ID_LIMIT = 32;

export const MEMORY_RETRIEVAL_OPERATIONS = [
  'prompt_assembly',
  'explicit_search',
  'explicit_recall',
] as const;
export type MemoryRetrievalOperation = (typeof MEMORY_RETRIEVAL_OPERATIONS)[number];

export const MEMORY_RETRIEVAL_MODES = ['query', 'recent', 'disabled'] as const;
export type MemoryRetrievalMode = (typeof MEMORY_RETRIEVAL_MODES)[number];

export const MEMORY_RETRIEVAL_OUTCOMES = ['completed', 'degraded', 'failed', 'disabled'] as const;
export type MemoryRetrievalOutcome = (typeof MEMORY_RETRIEVAL_OUTCOMES)[number];

export const MEMORY_RETRIEVAL_SELECTOR_MODES = ['deterministic', 'semantic'] as const;
export type MemoryRetrievalSelectorMode = (typeof MEMORY_RETRIEVAL_SELECTOR_MODES)[number];

export const MEMORY_RETRIEVAL_SELECTOR_OUTCOMES = [
  'not_requested',
  'applied',
  'deterministic_fallback',
] as const;
export type MemoryRetrievalSelectorOutcome = (typeof MEMORY_RETRIEVAL_SELECTOR_OUTCOMES)[number];

export const MEMORY_RETRIEVAL_BARRIER_OUTCOMES = [
  'no_job',
  'completed',
  'degraded',
  'timed_out',
] as const;
export type MemoryRetrievalBarrierOutcome = (typeof MEMORY_RETRIEVAL_BARRIER_OUTCOMES)[number];

export type MemoryRetrievalQueryFingerprint = Readonly<{
  hashAlgorithm: 'sha256';
  hash: string;
  length: number;
  unitCount: number;
}>;

export type MemoryRetrievalScopeInput = Readonly<{
  memoryConversationIdHash: string | null;
  sourceThreadIdHash: string | null;
  taskScopePresent: boolean;
}>;

export type MemoryRetrievalCountsInput = Readonly<{
  candidateFactCount: number;
  selectedFactCount: number;
  selectedFactIds: ReadonlyArray<string>;
  candidateEpisodeCount: number;
  selectedEpisodeCount: number;
  selectedEpisodeIds: ReadonlyArray<string>;
}>;

export type MemoryRetrievalTimings = Readonly<{
  planMs: number;
  factRecallMs: number;
  episodeRecallMs: number;
  candidateFetchMs: number;
  scoreMs: number;
  selectorMs: number;
  totalMs: number;
}>;

export type MemoryRetrievalSelector = Readonly<{
  mode: MemoryRetrievalSelectorMode;
  outcome: MemoryRetrievalSelectorOutcome;
}>;

export type MemoryRetrievalBarrier = Readonly<{
  outcome: MemoryRetrievalBarrierOutcome;
  waitMs: number;
  queueAgeMs: number | null;
}>;

export type RecordMemoryRetrievalEventInput = Readonly<{
  operation: MemoryRetrievalOperation;
  mode: MemoryRetrievalMode;
  outcome: MemoryRetrievalOutcome;
  queryFingerprint: MemoryRetrievalQueryFingerprint;
  scope: MemoryRetrievalScopeInput;
  counts: MemoryRetrievalCountsInput;
  timings: MemoryRetrievalTimings;
  selector: MemoryRetrievalSelector;
  barrier?: MemoryRetrievalBarrier | null;
  createdAt?: number;
}>;

export type MemoryRetrievalEvent = Readonly<{
  id: string;
  operation: MemoryRetrievalOperation;
  mode: MemoryRetrievalMode;
  outcome: MemoryRetrievalOutcome;
  queryFingerprint: MemoryRetrievalQueryFingerprint;
  scope: {
    memoryConversationIdHash: string | null;
    sourceThreadIdHash: string | null;
    taskScopePresent: boolean;
  };
  counts: {
    candidateFactCount: number;
    selectedFactCount: number;
    selectedFactIds: string[];
    candidateEpisodeCount: number;
    selectedEpisodeCount: number;
    selectedEpisodeIds: string[];
  };
  timings: MemoryRetrievalTimings;
  selector: MemoryRetrievalSelector;
  barrier: MemoryRetrievalBarrier | null;
  createdAt: number;
}>;

export type MemoryRetrievalEventRejectionCode =
  | 'invalid_operation'
  | 'invalid_mode'
  | 'invalid_outcome'
  | 'invalid_query_fingerprint'
  | 'invalid_scope'
  | 'invalid_counts'
  | 'invalid_selected_ids'
  | 'invalid_timings'
  | 'invalid_selector'
  | 'invalid_barrier'
  | 'invalid_state_combination'
  | 'invalid_timestamp';

export type RecordMemoryRetrievalEventResult =
  | { status: 'recorded'; eventId: string }
  | { status: 'rejected'; code: MemoryRetrievalEventRejectionCode }
  | { status: 'failed'; code: 'storage_error' };
