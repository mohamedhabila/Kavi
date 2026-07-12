import { safeParseObject } from '../schema';
import {
  closedMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './applicabilityProvenance';
import { parseCurrentLocalSimilarityVector, type LocalSimilarityVector } from '../localSimilarity';

export type MemoryFactScope = 'global' | 'project' | 'conversation' | 'session' | 'persona';

export type MemoryDecayPolicy = 'normal' | 'slow' | 'fast' | 'pinned' | 'ephemeral';

export type MemoryFactKind =
  | 'semantic_fact'
  | 'episodic_event'
  | 'goal'
  | 'tool_result'
  | 'source'
  | 'decision'
  | 'risk'
  | 'artifact'
  | 'summary'
  | 'evidence_span'
  | 'agent_run'
  | 'gotcha';

export interface MemoryFact {
  id: string;
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId: string | null;
  attributes: Record<string, unknown>;
  confidence: number;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  memoryOwnerId: string | null;
  personaId: string | null;
  factClass: string;
  sourceAuthority: string;
  scope: MemoryFactScope;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceTurnId: string | null;
  sourceSummary: string | null;
  importance: number;
  accessCount: number;
  repeatedMentionCount: number;
  lastRecalledAt: number | null;
  lastReinforcedAt: number | null;
  lastAccessedAt: number | null;
  decayPolicy: MemoryDecayPolicy;
  expiresAt: number | null;
  contentHash: string;
  localSimilarity: LocalSimilarityVector | null;
  validAt: number;
  invalidAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  pinned: boolean;
  sourceActorId: string | null;
  retrievability: number;
  stability: number;
  decayRate: number;
  lastPresentedAt: number | null;
  lastConfirmedAt: number | null;
  lastConflictedAt: number | null;
  reviewState: string;
  sensitivity: MemoryFactSensitivity;
  memoryKind: MemoryFactKind;
}

export interface FactRow {
  id: string;
  subject_id: string;
  predicate: string;
  object_text: string;
  object_entity_id: string | null;
  attributes: string;
  confidence: number;
  source_message_id: string | null;
  source_run_id: string | null;
  memory_owner_id?: string | null;
  persona_id?: string | null;
  fact_class?: string;
  source_authority?: string;
  scope: string;
  origin_conversation_id: string | null;
  origin_thread_id: string | null;
  origin_task_id: string | null;
  source_turn_id: string | null;
  source_summary: string | null;
  importance: number;
  access_count: number;
  repeated_mention_count: number;
  last_recalled_at: number | null;
  last_reinforced_at: number | null;
  last_accessed_at: number | null;
  decay_policy: string;
  expires_at: number | null;
  content_hash: string;
  local_similarity_model?: string | null;
  local_similarity_dimensions?: number | null;
  local_similarity_vector?: string | null;
  local_similarity_updated_at?: number | null;
  valid_at: number;
  invalid_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  pinned: number;
  source_actor_id?: string | null;
  retrievability?: number;
  stability?: number;
  decay_rate?: number;
  last_presented_at?: number | null;
  last_confirmed_at?: number | null;
  last_conflicted_at?: number | null;
  review_state?: string;
  sensitivity?: string;
  memory_kind?: MemoryFactKind;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

export function isMemoryFactScope(value: unknown): value is MemoryFactScope {
  return (
    value === 'global' ||
    value === 'project' ||
    value === 'conversation' ||
    value === 'session' ||
    value === 'persona'
  );
}

export function requireMemoryFactScope(value: unknown): MemoryFactScope {
  if (!isMemoryFactScope(value)) throw new Error('memory_fact_scope_invalid');
  return value;
}

export function normalizeDecayPolicy(value: unknown): MemoryDecayPolicy {
  return value === 'slow' || value === 'fast' || value === 'pinned' || value === 'ephemeral'
    ? value
    : 'normal';
}

export function normalizeFactKind(value: unknown): MemoryFactKind {
  return value === 'episodic_event' ||
    value === 'goal' ||
    value === 'tool_result' ||
    value === 'source' ||
    value === 'decision' ||
    value === 'risk' ||
    value === 'artifact' ||
    value === 'summary' ||
    value === 'evidence_span' ||
    value === 'agent_run' ||
    value === 'gotcha'
    ? value
    : 'semantic_fact';
}

export function rowToFact(row: FactRow): MemoryFact {
  return {
    id: row.id,
    subjectId: row.subject_id,
    predicate: row.predicate,
    objectText: row.object_text,
    objectEntityId: row.object_entity_id,
    attributes: safeParseObject(row.attributes),
    confidence: row.confidence,
    sourceMessageId: row.source_message_id,
    sourceRunId: row.source_run_id,
    memoryOwnerId: row.memory_owner_id ?? null,
    personaId: row.persona_id ?? null,
    factClass: row.fact_class ?? 'unknown',
    sourceAuthority: row.source_authority ?? 'unknown',
    scope: requireMemoryFactScope(row.scope),
    originConversationId: row.origin_conversation_id,
    originThreadId: row.origin_thread_id,
    originTaskId: row.origin_task_id,
    sourceTurnId: row.source_turn_id,
    sourceSummary: row.source_summary,
    importance: clamp01(row.importance ?? 0.5),
    accessCount: Math.max(0, row.access_count ?? 0),
    repeatedMentionCount: Math.max(0, row.repeated_mention_count ?? 0),
    lastRecalledAt: row.last_recalled_at,
    lastReinforcedAt: row.last_reinforced_at,
    lastAccessedAt: row.last_accessed_at,
    decayPolicy: normalizeDecayPolicy(row.decay_policy),
    expiresAt: row.expires_at,
    contentHash: row.content_hash,
    localSimilarity: parseCurrentLocalSimilarityVector({
      model: row.local_similarity_model,
      dimensions: row.local_similarity_dimensions,
      serializedValues: row.local_similarity_vector,
    }),
    validAt: row.valid_at,
    invalidAt: row.invalid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    pinned: row.pinned !== 0,
    sourceActorId: row.source_actor_id ?? null,
    retrievability: clamp01(row.retrievability ?? 1),
    stability: clamp01(row.stability ?? 0.5),
    decayRate: Math.max(0, row.decay_rate ?? 0.03),
    lastPresentedAt: row.last_presented_at ?? null,
    lastConfirmedAt: row.last_confirmed_at ?? null,
    lastConflictedAt: row.last_conflicted_at ?? null,
    reviewState: row.review_state ?? 'auto',
    sensitivity: closedMemoryFactSensitivity(row.sensitivity) ?? 'restricted',
    memoryKind: normalizeFactKind(row.memory_kind),
  };
}

export interface RecordFactInput {
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId?: string | null;
  attributes?: Record<string, unknown>;
  confidence?: number;
  sourceMessageId?: string | null;
  sourceRunId?: string | null;
  scope: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  sourceTurnId?: string | null;
  sourceSummary?: string | null;
  importance?: number;
  decayPolicy?: MemoryDecayPolicy;
  expiresAt?: number | null;
  validAt?: number;
  pinned?: boolean;
  sourceActorId?: string | null;
  retrievability?: number;
  stability?: number;
  decayRate?: number;
  reviewState?: MemoryFactReviewState;
  memoryKind?: MemoryFactKind;
  /** When true, any existing currently-valid fact for (subject, predicate) is invalidated. */
  supersedePrior?: boolean;
  now?: number;
}

export interface RecordFactResult {
  fact: MemoryFact;
  status: 'created' | 'duplicate';
  superseded: MemoryFact[];
}

export type ReplaceCurrentFactInput = Omit<RecordFactInput, 'supersedePrior'> & {
  expectedCurrentFactId: string;
};

export type ReplaceCurrentFactConflict =
  | 'target_missing'
  | 'target_changed'
  | 'target_scope_mismatch'
  | 'replacement_collision';

export type ReplaceCurrentFactResult =
  | {
      fact: MemoryFact;
      status: 'created' | 'duplicate';
      superseded: MemoryFact[];
    }
  | {
      fact: null;
      status: 'conflict';
      superseded: [];
      conflict: ReplaceCurrentFactConflict;
    };

export interface ListFactsOptions {
  subjectId?: string;
  predicate?: string;
  scope?: MemoryFactScope | MemoryFactScope[];
  originConversationId?: string;
  originTaskId?: string;
  pinnedOnly?: boolean;
  includeInvalidated?: boolean;
  includeDeleted?: boolean;
  includeExpired?: boolean;
  memoryKind?: MemoryFactKind | MemoryFactKind[];
  limit?: number;
  /** Only return facts valid at this timestamp. Defaults to "currently valid". */
  asOf?: number;
}
