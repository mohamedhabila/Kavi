import { safeParseArray, safeParseObject } from '../schema';

export type MemoryFactScope = 'global' | 'project' | 'conversation' | 'session' | 'persona';

export type MemoryDecayPolicy = 'normal' | 'slow' | 'fast' | 'pinned' | 'ephemeral';

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
  embedding: number[] | null;
  validAt: number;
  invalidAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  pinned: boolean;
  sourceActorId: string | null;
  taskId: string | null;
  retrievability: number;
  stability: number;
  decayRate: number;
  lastPresentedAt: number | null;
  lastConfirmedAt: number | null;
  lastConflictedAt: number | null;
  reviewState: string;
  sensitivity: string;
  memoryKind: string;
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
  embedding: string | null;
  valid_at: number;
  invalid_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  pinned: number;
  source_actor_id?: string | null;
  task_id?: string | null;
  retrievability?: number;
  stability?: number;
  decay_rate?: number;
  last_presented_at?: number | null;
  last_confirmed_at?: number | null;
  last_conflicted_at?: number | null;
  review_state?: string;
  sensitivity?: string;
  memory_kind?: string;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

export function normalizeScope(value: unknown): MemoryFactScope {
  return value === 'project' ||
    value === 'conversation' ||
    value === 'session' ||
    value === 'persona'
    ? value
    : 'global';
}

export function normalizeDecayPolicy(value: unknown): MemoryDecayPolicy {
  return value === 'slow' || value === 'fast' || value === 'pinned' || value === 'ephemeral'
    ? value
    : 'normal';
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
    scope: normalizeScope(row.scope),
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
    embedding: row.embedding ? safeParseArray<number>(row.embedding) : null,
    validAt: row.valid_at,
    invalidAt: row.invalid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    pinned: row.pinned !== 0,
    sourceActorId: row.source_actor_id ?? null,
    taskId: row.task_id ?? null,
    retrievability: clamp01(row.retrievability ?? 1),
    stability: clamp01(row.stability ?? 0.5),
    decayRate: Math.max(0, row.decay_rate ?? 0.03),
    lastPresentedAt: row.last_presented_at ?? null,
    lastConfirmedAt: row.last_confirmed_at ?? null,
    lastConflictedAt: row.last_conflicted_at ?? null,
    reviewState: row.review_state ?? 'auto',
    sensitivity: row.sensitivity ?? 'normal',
    memoryKind: row.memory_kind ?? 'semantic',
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
  scope?: MemoryFactScope;
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
  /** When true, any existing currently-valid fact for (subject, predicate) is invalidated. */
  supersedePrior?: boolean;
  now?: number;
}

export interface RecordFactResult {
  fact: MemoryFact;
  status: 'created' | 'duplicate';
  superseded: MemoryFact[];
}

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
  limit?: number;
  /** Only return facts valid at this timestamp. Defaults to "currently valid". */
  asOf?: number;
}
