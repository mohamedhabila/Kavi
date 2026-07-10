import * as Crypto from 'expo-crypto';
import { runMemoryTransaction } from './access/transaction';
import { RECALL_CANDIDATE_LIMITS } from './factRecallCandidateContract';
import {
  MEMORY_RETRIEVAL_BARRIER_OUTCOMES,
  MEMORY_RETRIEVAL_CANDIDATE_STRATEGIES,
  MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT,
  MEMORY_RETRIEVAL_EXPANSION_OUTCOMES,
  MEMORY_RETRIEVAL_LOCAL_SEMANTIC_OUTCOMES,
  MEMORY_RETRIEVAL_MODES,
  MEMORY_RETRIEVAL_OPERATIONS,
  MEMORY_RETRIEVAL_OUTCOMES,
  MEMORY_RETRIEVAL_SELECTED_ID_LIMIT,
  MEMORY_RETRIEVAL_SELECTOR_MODES,
  MEMORY_RETRIEVAL_SELECTOR_OUTCOMES,
} from './retrievalEventTypes';
import type {
  MemoryRetrievalBarrierOutcome,
  MemoryRetrievalCandidates,
  MemoryRetrievalCandidateStrategy,
  MemoryRetrievalEvent,
  MemoryRetrievalEventRejectionCode,
  MemoryRetrievalExpansion,
  MemoryRetrievalLocalSemanticOutcome,
  MemoryRetrievalMode,
  MemoryRetrievalOperation,
  MemoryRetrievalOutcome,
  MemoryRetrievalQueryFingerprint,
  MemoryRetrievalSelectorMode,
  MemoryRetrievalSelectorOutcome,
  RecordMemoryRetrievalEventInput,
  RecordMemoryRetrievalEventResult,
} from './retrievalEventTypes';
import { ensureFactSchema, newId } from './schema';
import { getMemoryDb } from './sqlite-store';

const MEMORY_RETRIEVAL_READ_LIMIT = MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT;
const MAX_QUERY_LENGTH = 20_000;
const MAX_QUERY_UNIT_COUNT = 4_096;
const MAX_COUNT = 1_000_000;
const MAX_TIMING_MS = 600_000;
const MAX_QUEUE_AGE_MS = 31 * 24 * 60 * 60 * 1_000;
const STRUCTURAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const QUERY_UNIT_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;

type NormalizedEvent = Omit<MemoryRetrievalEvent, 'id'>;

interface MemoryRetrievalEventRow {
  id: string;
  operation: MemoryRetrievalOperation;
  mode: MemoryRetrievalMode;
  outcome: MemoryRetrievalOutcome;
  query_hash: string;
  query_length: number;
  query_unit_count: number;
  memory_conversation_id_hash: string | null;
  source_thread_id_hash: string | null;
  task_scope_present: number;
  candidate_fact_count: number;
  selected_fact_count: number;
  selected_fact_ids_json: string;
  candidate_episode_count: number;
  selected_episode_count: number;
  selected_episode_ids_json: string;
  plan_ms: number;
  fact_recall_ms: number;
  episode_recall_ms: number;
  candidate_fetch_ms: number;
  score_ms: number;
  selector_ms: number;
  evidence_expansion_ms: number;
  total_ms: number;
  candidate_strategy: MemoryRetrievalCandidateStrategy;
  local_semantic_outcome: MemoryRetrievalLocalSemanticOutcome;
  candidate_eligible_scan_count: number;
  candidate_pinned_count: number;
  candidate_exact_quoted_count: number;
  candidate_lexical_count: number;
  candidate_entity_count: number;
  candidate_temporal_count: number;
  candidate_local_semantic_count: number;
  candidate_union_count: number;
  candidate_diversified_count: number;
  candidate_union_ms: number;
  expansion_outcome: MemoryRetrievalExpansion['outcome'];
  expansion_requested_source_count: number;
  expansion_accepted_source_count: number;
  expansion_source_with_evidence_count: number;
  expansion_emitted_evidence_count: number;
  expansion_prompt_budget_dropped_count: number;
  expansion_prompt_chars: number;
  selector_mode: MemoryRetrievalSelectorMode;
  selector_outcome: MemoryRetrievalSelectorOutcome;
  barrier_outcome: MemoryRetrievalBarrierOutcome | null;
  barrier_wait_ms: number | null;
  barrier_queue_age_ms: number | null;
  created_at: number;
}

class RetrievalEventValidationError extends Error {
  constructor(readonly code: MemoryRetrievalEventRejectionCode) {
    super(code);
  }
}

export async function buildMemoryRetrievalQueryFingerprint(
  query: string,
): Promise<MemoryRetrievalQueryFingerprint> {
  if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
    throw new RangeError('Retrieval query exceeds the fingerprint input bound.');
  }
  QUERY_UNIT_PATTERN.lastIndex = 0;
  const units = new Set(
    Array.from(query.normalize('NFKC').toLowerCase().matchAll(QUERY_UNIT_PATTERN), (match) =>
      match[0].trim(),
    ).filter(Boolean),
  );
  if (units.size > MAX_QUERY_UNIT_COUNT) {
    throw new RangeError('Retrieval query unit count exceeds the fingerprint input bound.');
  }
  return {
    hashAlgorithm: 'sha256',
    hash: (
      await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, query)
    ).toLowerCase(),
    length: query.length,
    unitCount: units.size,
  };
}

export type MemoryRetrievalScopeHashDomain = 'memory_conversation' | 'source_thread';

export async function buildMemoryRetrievalScopeHash(
  domain: MemoryRetrievalScopeHashDomain,
  structuralId: string | null | undefined,
): Promise<string | null> {
  if (structuralId === null || structuralId === undefined || structuralId === '') return null;
  if (structuralId !== structuralId.trim() || !STRUCTURAL_ID_PATTERN.test(structuralId)) {
    throw new RangeError('Retrieval scope id is not a bounded structural identifier.');
  }
  return (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${domain}\u0000${structuralId}`,
    )
  ).toLowerCase();
}

function ensureTable(): void {
  ensureFactSchema();
}

function requireEnum<T extends string>(
  value: T,
  allowed: ReadonlyArray<T>,
  code: MemoryRetrievalEventRejectionCode,
): T {
  if (!allowed.includes(value)) throw new RetrievalEventValidationError(code);
  return value;
}

function requireBoundedInteger(
  value: number,
  maximum: number,
  code: MemoryRetrievalEventRejectionCode,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RetrievalEventValidationError(code);
  }
  return value;
}

function optionalSha256(value: string | null): string | null {
  if (value === null) return null;
  if (!SHA256_PATTERN.test(value)) {
    throw new RetrievalEventValidationError('invalid_scope');
  }
  return value;
}

function selectedIds(values: ReadonlyArray<string>, selectedCount: number): string[] {
  if (
    values.length > MEMORY_RETRIEVAL_SELECTED_ID_LIMIT ||
    values.length > selectedCount ||
    values.some((value) => value !== value.trim() || !STRUCTURAL_ID_PATTERN.test(value)) ||
    new Set(values).size !== values.length
  ) {
    throw new RetrievalEventValidationError('invalid_selected_ids');
  }
  return [...values];
}

function normalizeCandidates(
  input: RecordMemoryRetrievalEventInput['candidates'],
  candidateFactCount: number,
  factRecallMs: number,
): MemoryRetrievalCandidates {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RetrievalEventValidationError('invalid_candidates');
  }
  const strategy = requireEnum(
    input.strategy,
    MEMORY_RETRIEVAL_CANDIDATE_STRATEGIES,
    'invalid_candidates',
  );
  const localSemanticOutcome = requireEnum(
    input.localSemanticOutcome,
    MEMORY_RETRIEVAL_LOCAL_SEMANTIC_OUTCOMES,
    'invalid_candidates',
  );
  const count = (value: number, maximum: number) =>
    requireBoundedInteger(value, maximum, 'invalid_candidates');
  const candidates: MemoryRetrievalCandidates = {
    strategy,
    localSemanticOutcome,
    eligibleScanCount: count(
      input.eligibleScanCount,
      RECALL_CANDIDATE_LIMITS.maximumEligibleScan,
    ),
    pinnedCount: count(input.pinnedCount, RECALL_CANDIDATE_LIMITS.maximumUnion),
    exactQuotedCount: count(input.exactQuotedCount, RECALL_CANDIDATE_LIMITS.maximumUnion),
    lexicalCount: count(input.lexicalCount, RECALL_CANDIDATE_LIMITS.maximumUnion),
    entityCount: count(input.entityCount, RECALL_CANDIDATE_LIMITS.entityLane),
    temporalCount: count(input.temporalCount, RECALL_CANDIDATE_LIMITS.temporalLane),
    localSemanticCount: count(
      input.localSemanticCount,
      RECALL_CANDIDATE_LIMITS.localSemanticLane,
    ),
    unionCount: count(input.unionCount, RECALL_CANDIDATE_LIMITS.maximumUnion),
    diversifiedCount: count(input.diversifiedCount, RECALL_CANDIDATE_LIMITS.maximumUnion),
    unionMs: count(input.unionMs, MAX_TIMING_MS),
  };
  const stageCounts = [
    candidates.eligibleScanCount,
    candidates.pinnedCount,
    candidates.exactQuotedCount,
    candidates.lexicalCount,
    candidates.entityCount,
    candidates.temporalCount,
    candidates.localSemanticCount,
    candidates.unionCount,
    candidates.diversifiedCount,
    candidates.unionMs,
  ];
  if (
    (strategy === 'not_requested' &&
      (localSemanticOutcome !== 'not_requested' || stageCounts.some((value) => value !== 0))) ||
    (localSemanticOutcome !== 'applied' && candidates.localSemanticCount !== 0) ||
    candidates.unionMs > factRecallMs
  ) {
    throw new RetrievalEventValidationError('invalid_candidates');
  }
  if (
    strategy === 'lexical' &&
    (localSemanticOutcome !== 'not_requested' ||
      candidates.eligibleScanCount !== 0 ||
      candidates.entityCount !== 0 ||
      candidates.temporalCount !== 0 ||
      candidates.localSemanticCount !== 0 ||
      candidates.unionCount !== candidateFactCount ||
      candidates.diversifiedCount !== candidateFactCount ||
      candidates.unionMs !== 0)
  ) {
    throw new RetrievalEventValidationError('invalid_candidates');
  }
  const supplementalLaneCount =
    candidates.pinnedCount +
    candidates.exactQuotedCount +
    candidates.lexicalCount +
    candidates.entityCount +
    candidates.temporalCount +
    candidates.localSemanticCount;
  if (
    strategy === 'hybrid' &&
    (candidateFactCount > RECALL_CANDIDATE_LIMITS.maximumUnion ||
      candidates.pinnedCount > RECALL_CANDIDATE_LIMITS.pinnedLane ||
      candidates.exactQuotedCount > RECALL_CANDIDATE_LIMITS.exactQuotedLane ||
      candidates.entityCount > candidates.eligibleScanCount ||
      candidates.temporalCount > candidates.eligibleScanCount ||
      candidates.localSemanticCount > candidates.eligibleScanCount ||
      candidates.unionCount < candidateFactCount ||
      candidates.unionCount > supplementalLaneCount ||
      candidates.diversifiedCount > candidateFactCount)
  ) {
    throw new RetrievalEventValidationError('invalid_candidates');
  }
  return candidates;
}

function normalizeExpansion(
  input: RecordMemoryRetrievalEventInput['expansion'],
  evidenceExpansionMs: number,
  totalMs: number,
): MemoryRetrievalExpansion {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RetrievalEventValidationError('invalid_expansion');
  }
  const outcome = requireEnum(
    input.outcome,
    MEMORY_RETRIEVAL_EXPANSION_OUTCOMES,
    'invalid_expansion',
  );
  const count = (value: number, maximum = MAX_COUNT) =>
    requireBoundedInteger(value, maximum, 'invalid_expansion');
  const requestedSourceCount = count(input.requestedSourceCount);
  const acceptedSourceCount = count(input.acceptedSourceCount, 12);
  const sourceWithEvidenceCount = count(input.sourceWithEvidenceCount, 12);
  const emittedEvidenceCount = count(input.emittedEvidenceCount, 24);
  const promptBudgetDroppedCount = count(input.promptBudgetDroppedCount);
  const promptChars = count(input.promptChars, 3_200);
  const durationMs = count(input.durationMs, MAX_TIMING_MS);
  if (
    acceptedSourceCount > requestedSourceCount ||
    sourceWithEvidenceCount > acceptedSourceCount ||
    durationMs !== evidenceExpansionMs ||
    totalMs < durationMs ||
    (emittedEvidenceCount === 0) !== (promptChars === 0) ||
    (emittedEvidenceCount > 0 && sourceWithEvidenceCount === 0)
  ) {
    throw new RetrievalEventValidationError('invalid_expansion');
  }
  const zeroResult =
    acceptedSourceCount === 0 &&
    sourceWithEvidenceCount === 0 &&
    emittedEvidenceCount === 0 &&
    promptBudgetDroppedCount === 0 &&
    promptChars === 0;
  if (
    (outcome === 'not_requested' &&
      (requestedSourceCount !== 0 || !zeroResult || durationMs !== 0)) ||
    (outcome === 'scope_unavailable' &&
      (requestedSourceCount === 0 || !zeroResult || durationMs !== 0)) ||
    (outcome === 'failed' && (requestedSourceCount === 0 || !zeroResult)) ||
    (outcome === 'completed' && requestedSourceCount === 0)
  ) {
    throw new RetrievalEventValidationError('invalid_expansion');
  }
  return {
    outcome,
    requestedSourceCount,
    acceptedSourceCount,
    sourceWithEvidenceCount,
    emittedEvidenceCount,
    promptBudgetDroppedCount,
    promptChars,
    durationMs,
  };
}

function normalizeEvent(input: RecordMemoryRetrievalEventInput): NormalizedEvent {
  const operation = requireEnum(input.operation, MEMORY_RETRIEVAL_OPERATIONS, 'invalid_operation');
  const mode = requireEnum(input.mode, MEMORY_RETRIEVAL_MODES, 'invalid_mode');
  const outcome = requireEnum(input.outcome, MEMORY_RETRIEVAL_OUTCOMES, 'invalid_outcome');
  const queryFingerprint = input.queryFingerprint;
  if (
    queryFingerprint.hashAlgorithm !== 'sha256' ||
    !SHA256_PATTERN.test(queryFingerprint.hash) ||
    !Number.isSafeInteger(queryFingerprint.length) ||
    queryFingerprint.length < 0 ||
    queryFingerprint.length > MAX_QUERY_LENGTH ||
    !Number.isSafeInteger(queryFingerprint.unitCount) ||
    queryFingerprint.unitCount < 0 ||
    queryFingerprint.unitCount > MAX_QUERY_UNIT_COUNT
  ) {
    throw new RetrievalEventValidationError('invalid_query_fingerprint');
  }
  if (typeof input.scope.taskScopePresent !== 'boolean') {
    throw new RetrievalEventValidationError('invalid_scope');
  }

  const candidateFactCount = requireBoundedInteger(
    input.counts.candidateFactCount,
    MAX_COUNT,
    'invalid_counts',
  );
  const selectedFactCount = requireBoundedInteger(
    input.counts.selectedFactCount,
    candidateFactCount,
    'invalid_counts',
  );
  const candidateEpisodeCount = requireBoundedInteger(
    input.counts.candidateEpisodeCount,
    MAX_COUNT,
    'invalid_counts',
  );
  const selectedEpisodeCount = requireBoundedInteger(
    input.counts.selectedEpisodeCount,
    candidateEpisodeCount,
    'invalid_counts',
  );
  const timing = (value: number) => requireBoundedInteger(value, MAX_TIMING_MS, 'invalid_timings');
  const timings = {
    planMs: timing(input.timings.planMs),
    factRecallMs: timing(input.timings.factRecallMs),
    episodeRecallMs: timing(input.timings.episodeRecallMs),
    candidateFetchMs: timing(input.timings.candidateFetchMs),
    scoreMs: timing(input.timings.scoreMs),
    selectorMs: timing(input.timings.selectorMs),
    evidenceExpansionMs: timing(input.timings.evidenceExpansionMs),
    totalMs: timing(input.timings.totalMs),
  };
  const candidates = normalizeCandidates(
    input.candidates,
    candidateFactCount,
    timings.factRecallMs,
  );
  const expansion = normalizeExpansion(
    input.expansion,
    timings.evidenceExpansionMs,
    timings.totalMs,
  );
  if (expansion.outcome === 'failed' && outcome !== 'degraded' && outcome !== 'failed') {
    throw new RetrievalEventValidationError('invalid_state_combination');
  }
  const selectorMode = requireEnum(
    input.selector.mode,
    MEMORY_RETRIEVAL_SELECTOR_MODES,
    'invalid_selector',
  );
  const selectorOutcome = requireEnum(
    input.selector.outcome,
    MEMORY_RETRIEVAL_SELECTOR_OUTCOMES,
    'invalid_selector',
  );
  if (selectorMode === 'deterministic' && selectorOutcome !== 'not_requested') {
    throw new RetrievalEventValidationError('invalid_selector');
  }
  const disabled = mode === 'disabled';
  if (
    disabled !== (outcome === 'disabled') ||
    (disabled &&
      (candidateFactCount !== 0 ||
        selectedFactCount !== 0 ||
        input.counts.selectedFactIds.length !== 0 ||
        candidateEpisodeCount !== 0 ||
        selectedEpisodeCount !== 0 ||
        input.counts.selectedEpisodeIds.length !== 0 ||
        Object.values(timings).some((value) => value !== 0) ||
        candidates.strategy !== 'not_requested' ||
        expansion.outcome !== 'not_requested' ||
        selectorMode !== 'deterministic' ||
        selectorOutcome !== 'not_requested' ||
        input.barrier != null))
  ) {
    throw new RetrievalEventValidationError('invalid_state_combination');
  }

  const barrier = input.barrier
    ? {
        outcome: requireEnum(
          input.barrier.outcome,
          MEMORY_RETRIEVAL_BARRIER_OUTCOMES,
          'invalid_barrier',
        ),
        waitMs: requireBoundedInteger(input.barrier.waitMs, MAX_TIMING_MS, 'invalid_barrier'),
        queueAgeMs:
          input.barrier.queueAgeMs === null
            ? null
            : requireBoundedInteger(input.barrier.queueAgeMs, MAX_QUEUE_AGE_MS, 'invalid_barrier'),
      }
    : null;

  return {
    operation,
    mode,
    outcome,
    queryFingerprint: { ...queryFingerprint },
    scope: {
      memoryConversationIdHash: optionalSha256(input.scope.memoryConversationIdHash),
      sourceThreadIdHash: optionalSha256(input.scope.sourceThreadIdHash),
      taskScopePresent: input.scope.taskScopePresent,
    },
    counts: {
      candidateFactCount,
      selectedFactCount,
      selectedFactIds: selectedIds(input.counts.selectedFactIds, selectedFactCount),
      candidateEpisodeCount,
      selectedEpisodeCount,
      selectedEpisodeIds: selectedIds(input.counts.selectedEpisodeIds, selectedEpisodeCount),
    },
    timings,
    candidates,
    expansion,
    selector: { mode: selectorMode, outcome: selectorOutcome },
    barrier,
    createdAt: requireBoundedInteger(
      input.createdAt ?? Date.now(),
      Number.MAX_SAFE_INTEGER,
      'invalid_timestamp',
    ),
  };
}

function parseIds(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    throw new Error('Invalid retrieval event id list.');
  }
  return parsed;
}

function rowToEvent(row: MemoryRetrievalEventRow): MemoryRetrievalEvent {
  return {
    id: row.id,
    operation: row.operation,
    mode: row.mode,
    outcome: row.outcome,
    queryFingerprint: {
      hashAlgorithm: 'sha256',
      hash: row.query_hash,
      length: row.query_length,
      unitCount: row.query_unit_count,
    },
    scope: {
      memoryConversationIdHash: row.memory_conversation_id_hash,
      sourceThreadIdHash: row.source_thread_id_hash,
      taskScopePresent: row.task_scope_present !== 0,
    },
    counts: {
      candidateFactCount: row.candidate_fact_count,
      selectedFactCount: row.selected_fact_count,
      selectedFactIds: parseIds(row.selected_fact_ids_json),
      candidateEpisodeCount: row.candidate_episode_count,
      selectedEpisodeCount: row.selected_episode_count,
      selectedEpisodeIds: parseIds(row.selected_episode_ids_json),
    },
    timings: {
      planMs: row.plan_ms,
      factRecallMs: row.fact_recall_ms,
      episodeRecallMs: row.episode_recall_ms,
      candidateFetchMs: row.candidate_fetch_ms,
      scoreMs: row.score_ms,
      selectorMs: row.selector_ms,
      evidenceExpansionMs: row.evidence_expansion_ms,
      totalMs: row.total_ms,
    },
    candidates: {
      strategy: row.candidate_strategy,
      localSemanticOutcome: row.local_semantic_outcome,
      eligibleScanCount: row.candidate_eligible_scan_count,
      pinnedCount: row.candidate_pinned_count,
      exactQuotedCount: row.candidate_exact_quoted_count,
      lexicalCount: row.candidate_lexical_count,
      entityCount: row.candidate_entity_count,
      temporalCount: row.candidate_temporal_count,
      localSemanticCount: row.candidate_local_semantic_count,
      unionCount: row.candidate_union_count,
      diversifiedCount: row.candidate_diversified_count,
      unionMs: row.candidate_union_ms,
    },
    expansion: {
      outcome: row.expansion_outcome,
      requestedSourceCount: row.expansion_requested_source_count,
      acceptedSourceCount: row.expansion_accepted_source_count,
      sourceWithEvidenceCount: row.expansion_source_with_evidence_count,
      emittedEvidenceCount: row.expansion_emitted_evidence_count,
      promptBudgetDroppedCount: row.expansion_prompt_budget_dropped_count,
      promptChars: row.expansion_prompt_chars,
      durationMs: row.evidence_expansion_ms,
    },
    selector: { mode: row.selector_mode, outcome: row.selector_outcome },
    barrier: row.barrier_outcome
      ? {
          outcome: row.barrier_outcome,
          waitMs: row.barrier_wait_ms ?? 0,
          queueAgeMs: row.barrier_queue_age_ms,
        }
      : null,
    createdAt: row.created_at,
  };
}

export async function recordMemoryRetrievalEvent(
  input: RecordMemoryRetrievalEventInput,
): Promise<RecordMemoryRetrievalEventResult> {
  let event: NormalizedEvent;
  try {
    event = normalizeEvent(input);
  } catch (error) {
    return {
      status: 'rejected',
      code:
        error instanceof RetrievalEventValidationError ? error.code : 'invalid_query_fingerprint',
    };
  }

  try {
    ensureTable();
    const eventId = newId('retrieval_event');
    runMemoryTransaction(() => {
      const db = getMemoryDb();
      db.runSync(
        `INSERT INTO memory_retrieval_events (
           id, operation, mode, outcome, query_hash, query_length, query_unit_count,
           memory_conversation_id_hash, source_thread_id_hash, task_scope_present,
           candidate_fact_count, selected_fact_count, selected_fact_ids_json,
           candidate_episode_count, selected_episode_count, selected_episode_ids_json,
           plan_ms, fact_recall_ms, episode_recall_ms, candidate_fetch_ms, score_ms,
           selector_ms, evidence_expansion_ms, total_ms,
           candidate_strategy, local_semantic_outcome, candidate_eligible_scan_count,
           candidate_pinned_count, candidate_exact_quoted_count, candidate_lexical_count,
           candidate_entity_count, candidate_temporal_count, candidate_local_semantic_count,
           candidate_union_count, candidate_diversified_count, candidate_union_ms,
           expansion_outcome,
           expansion_requested_source_count, expansion_accepted_source_count,
           expansion_source_with_evidence_count, expansion_emitted_evidence_count,
           expansion_prompt_budget_dropped_count, expansion_prompt_chars,
           selector_mode, selector_outcome, barrier_outcome, barrier_wait_ms,
           barrier_queue_age_ms, created_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`,
        eventId,
        event.operation,
        event.mode,
        event.outcome,
        event.queryFingerprint.hash,
        event.queryFingerprint.length,
        event.queryFingerprint.unitCount,
        event.scope.memoryConversationIdHash,
        event.scope.sourceThreadIdHash,
        event.scope.taskScopePresent ? 1 : 0,
        event.counts.candidateFactCount,
        event.counts.selectedFactCount,
        JSON.stringify(event.counts.selectedFactIds),
        event.counts.candidateEpisodeCount,
        event.counts.selectedEpisodeCount,
        JSON.stringify(event.counts.selectedEpisodeIds),
        event.timings.planMs,
        event.timings.factRecallMs,
        event.timings.episodeRecallMs,
        event.timings.candidateFetchMs,
        event.timings.scoreMs,
        event.timings.selectorMs,
        event.timings.evidenceExpansionMs,
        event.timings.totalMs,
        event.candidates.strategy,
        event.candidates.localSemanticOutcome,
        event.candidates.eligibleScanCount,
        event.candidates.pinnedCount,
        event.candidates.exactQuotedCount,
        event.candidates.lexicalCount,
        event.candidates.entityCount,
        event.candidates.temporalCount,
        event.candidates.localSemanticCount,
        event.candidates.unionCount,
        event.candidates.diversifiedCount,
        event.candidates.unionMs,
        event.expansion.outcome,
        event.expansion.requestedSourceCount,
        event.expansion.acceptedSourceCount,
        event.expansion.sourceWithEvidenceCount,
        event.expansion.emittedEvidenceCount,
        event.expansion.promptBudgetDroppedCount,
        event.expansion.promptChars,
        event.selector.mode,
        event.selector.outcome,
        event.barrier?.outcome ?? null,
        event.barrier?.waitMs ?? null,
        event.barrier?.queueAgeMs ?? null,
        event.createdAt,
      );
      db.runSync(
        `DELETE FROM memory_retrieval_events
          WHERE id NOT IN (
            SELECT id FROM memory_retrieval_events
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )`,
        MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT,
      );
    });
    return { status: 'recorded', eventId };
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}

export interface ReadMemoryRetrievalEventsOptions {
  sourceThreadIdHash?: string;
  operation?: MemoryRetrievalOperation;
  limit?: number;
}

export function readRecentMemoryRetrievalEvents(
  options: ReadMemoryRetrievalEventsOptions = {},
): MemoryRetrievalEvent[] {
  try {
    ensureTable();
    const sourceThreadIdHash = optionalSha256(options.sourceThreadIdHash ?? null);
    const operation = options.operation
      ? requireEnum(options.operation, MEMORY_RETRIEVAL_OPERATIONS, 'invalid_operation')
      : null;
    const requestedLimit = Number.isFinite(options.limit) ? Math.floor(options.limit!) : 20;
    const limit = Math.max(1, Math.min(requestedLimit, MEMORY_RETRIEVAL_READ_LIMIT));
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (sourceThreadIdHash) {
      clauses.push('source_thread_id_hash = ?');
      params.push(sourceThreadIdHash);
    }
    if (operation) {
      clauses.push('operation = ?');
      params.push(operation);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return getMemoryDb()
      .getAllSync<MemoryRetrievalEventRow>(
        `SELECT * FROM memory_retrieval_events
          ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
        ...params,
        limit,
      )
      .flatMap((row) => {
        try {
          return [rowToEvent(row)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
