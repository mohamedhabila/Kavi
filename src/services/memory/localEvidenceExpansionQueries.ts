import { getMany } from './access/crud';
import { LOCAL_EVIDENCE_EXPANSION_LIMITS } from './localEvidenceExpansionTypes';

const ROW_LIMIT = LOCAL_EVIDENCE_EXPANSION_LIMITS.candidatesPerSource + 1;

export interface LocalEvidenceEdgeRow {
  evidenceId: string;
  evidenceCreatedAt: number;
  factId: string;
  episodeId: string | null;
  messageId: string | null;
  role: string | null;
  quote: string | null;
  episodeSummary: string | null;
  predicate: string;
  objectText: string;
  sourceRunId: string | null;
  sourceActorId: string | null;
  memoryKind: string;
  lastConflictedAt: number | null;
}

export interface LocalRunFactRow {
  factId: string;
  predicate: string;
  objectText: string;
  sourceRunId: string;
  sourceActorId: string | null;
  memoryKind: string;
  attributes: string;
  createdAt: number;
  lastConflictedAt: number | null;
}

function currentFactSql(alias: string): string {
  return `${alias}.memory_owner_id = ?
      AND ${alias}.scope IN ('conversation', 'project', 'session')
      AND ${alias}.origin_conversation_id = ?
      AND ${alias}.origin_thread_id = ?
      AND (${alias}.scope != 'session'
        OR COALESCE(${alias}.origin_task_id, '') = COALESCE(?, ''))
      AND ${alias}.deleted_at IS NULL
      AND ${alias}.valid_at <= ?
      AND (${alias}.invalid_at IS NULL OR ${alias}.invalid_at > ?)
      AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`;
}

export function listLocalFactNeighborhood(input: {
  factId: string;
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  asOf: number;
}): LocalEvidenceEdgeRow[] {
  return getMany<LocalEvidenceEdgeRow>(
    `SELECT e.id AS evidenceId,
            e.created_at AS evidenceCreatedAt,
            e.fact_id AS factId,
            e.episode_id AS episodeId,
            e.message_id AS messageId,
            e.role,
            e.quote,
            ep.summary AS episodeSummary,
            f.predicate,
            f.object_text AS objectText,
            f.source_run_id AS sourceRunId,
            f.source_actor_id AS sourceActorId,
            f.memory_kind AS memoryKind,
            f.last_conflicted_at AS lastConflictedAt
       FROM memory_facts AS f
       JOIN memory_fact_evidence AS e ON e.fact_id = f.id
  LEFT JOIN memory_episodes AS ep ON ep.id = e.episode_id
      WHERE f.id = ?
        AND ${currentFactSql('f')}
        AND e.created_at <= ?
        AND (
          e.episode_id IS NULL OR (
            ep.id IS NOT NULL
            AND ep.conversation_id = ?
            AND ep.thread_id = ?
            AND ep.deleted_at IS NULL
            AND ep.created_at <= ?
          )
        )
      ORDER BY e.created_at ASC, e.id ASC
      LIMIT ${ROW_LIMIT}`,
    input.factId,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.taskId,
    input.asOf,
    input.asOf,
    input.asOf,
    input.asOf,
    input.memoryConversationId,
    input.sourceThreadId,
    input.asOf,
  );
}

export function listLocalEpisodeNeighborhood(input: {
  episodeId: string;
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  asOf: number;
}): LocalEvidenceEdgeRow[] {
  return getMany<LocalEvidenceEdgeRow>(
    `SELECT e.id AS evidenceId,
            e.created_at AS evidenceCreatedAt,
            e.fact_id AS factId,
            e.episode_id AS episodeId,
            e.message_id AS messageId,
            e.role,
            e.quote,
            NULL AS episodeSummary,
            f.predicate,
            f.object_text AS objectText,
            f.source_run_id AS sourceRunId,
            f.source_actor_id AS sourceActorId,
            f.memory_kind AS memoryKind,
            f.last_conflicted_at AS lastConflictedAt
       FROM memory_episodes AS ep
       JOIN memory_fact_evidence AS e ON e.episode_id = ep.id
       JOIN memory_facts AS f ON f.id = e.fact_id
      WHERE ep.id = ?
        AND ep.conversation_id = ?
        AND ep.thread_id = ?
        AND ep.deleted_at IS NULL
        AND ep.created_at <= ?
        AND e.created_at <= ?
        AND ${currentFactSql('f')}
      ORDER BY e.created_at ASC, e.id ASC
      LIMIT ${ROW_LIMIT}`,
    input.episodeId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.asOf,
    input.asOf,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.taskId,
    input.asOf,
    input.asOf,
    input.asOf,
  );
}

export function listLocalRunNeighborhood(input: {
  sourceRunId: string;
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  asOf: number;
}): LocalRunFactRow[] {
  return getMany<LocalRunFactRow>(
    `SELECT f.id AS factId,
            f.predicate,
            f.object_text AS objectText,
            f.source_run_id AS sourceRunId,
            f.source_actor_id AS sourceActorId,
            f.memory_kind AS memoryKind,
            f.attributes,
            f.created_at AS createdAt,
            f.last_conflicted_at AS lastConflictedAt
       FROM memory_facts AS f INDEXED BY idx_facts_source_kind_rank
      WHERE f.source_run_id = ?
        AND ${currentFactSql('f')}
      ORDER BY f.created_at ASC, f.id ASC
      LIMIT ${ROW_LIMIT}`,
    input.sourceRunId,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.taskId,
    input.asOf,
    input.asOf,
    input.asOf,
  );
}
