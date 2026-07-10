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

export const MEMORY_RETRIEVAL_EXPANSION_OUTCOMES = [
  'not_requested',
  'completed',
  'scope_unavailable',
  'failed',
] as const;
export type MemoryRetrievalExpansionOutcome = (typeof MEMORY_RETRIEVAL_EXPANSION_OUTCOMES)[number];

export const MEMORY_RETRIEVAL_CANDIDATE_STRATEGIES = [
  'not_requested',
  'lexical',
  'hybrid',
] as const;
export type MemoryRetrievalCandidateStrategy =
  (typeof MEMORY_RETRIEVAL_CANDIDATE_STRATEGIES)[number];

export const MEMORY_RETRIEVAL_LOCAL_SEMANTIC_OUTCOMES = [
  'not_requested',
  'unavailable',
  'applied',
] as const;
export type MemoryRetrievalLocalSemanticOutcome =
  (typeof MEMORY_RETRIEVAL_LOCAL_SEMANTIC_OUTCOMES)[number];

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
  evidenceExpansionMs: number;
  totalMs: number;
}>;

export type MemoryRetrievalExpansion = Readonly<{
  outcome: MemoryRetrievalExpansionOutcome;
  requestedSourceCount: number;
  acceptedSourceCount: number;
  sourceWithEvidenceCount: number;
  emittedEvidenceCount: number;
  promptBudgetDroppedCount: number;
  promptChars: number;
  durationMs: number;
}>;

export type MemoryRetrievalCandidates = Readonly<{
  strategy: MemoryRetrievalCandidateStrategy;
  localSemanticOutcome: MemoryRetrievalLocalSemanticOutcome;
  eligibleScanCount: number;
  pinnedCount: number;
  exactQuotedCount: number;
  lexicalCount: number;
  entityCount: number;
  temporalCount: number;
  localSemanticCount: number;
  unionCount: number;
  diversifiedCount: number;
  unionMs: number;
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
  candidates: MemoryRetrievalCandidates;
  expansion: MemoryRetrievalExpansion;
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
  candidates: MemoryRetrievalCandidates;
  expansion: MemoryRetrievalExpansion;
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
  | 'invalid_candidates'
  | 'invalid_expansion'
  | 'invalid_selector'
  | 'invalid_barrier'
  | 'invalid_state_combination'
  | 'invalid_timestamp';

export type RecordMemoryRetrievalEventResult =
  | { status: 'recorded'; eventId: string }
  | { status: 'rejected'; code: MemoryRetrievalEventRejectionCode }
  | { status: 'failed'; code: 'storage_error' };
