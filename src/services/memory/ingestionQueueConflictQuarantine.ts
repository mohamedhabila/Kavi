import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { getMemoryDb } from './sqlite-store';

type MemoryDb = ReturnType<typeof getMemoryDb>;

interface PersistedIngestionIdentityRow {
  id: string;
  thread_id: string;
  thread_title: string | null;
  memory_conversation_id: string;
  persona_id: string | null;
  task_id: string | null;
  source_run_id: string | null;
  chat_provider_id: string | null;
  chat_model: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
  source_at: number;
  reason: string;
  status: string;
  provider_enrichment: number;
  updated_at: number;
}

function validOptionalIdentity(
  value: string | null,
  predicate: (candidate: unknown) => candidate is string,
): boolean {
  return value === null || predicate(value);
}

function validThreadTitle(value: string | null): boolean {
  return (
    value === null ||
    (value.length > 0 &&
      value.length <= 500 &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/u.test(value))
  );
}

function hasSealedIngestionIdentity(row: PersistedIngestionIdentityRow): boolean {
  return (
    isExactMemoryScopeId(row.id) &&
    isExactMemoryScopeId(row.thread_id) &&
    validThreadTitle(row.thread_title) &&
    isExactMemoryScopeId(row.memory_conversation_id) &&
    isExactMemoryScopeId(row.persona_id) &&
    validOptionalIdentity(row.task_id, isExactMemoryScopeId) &&
    validOptionalIdentity(row.source_run_id, isExactMemoryProvenanceId) &&
    validOptionalIdentity(row.chat_provider_id, isExactMemoryScopeId) &&
    validOptionalIdentity(row.chat_model, isExactMemoryProvenanceId) &&
    validOptionalIdentity(row.source_start_message_id, isExactMemoryProvenanceId) &&
    isExactMemoryProvenanceId(row.source_end_message_id) &&
    Number.isSafeInteger(row.source_at) &&
    row.source_at >= 0 &&
    (row.reason === 'turn_completed' || row.reason === 'migration' || row.reason === 'manual') &&
    (row.provider_enrichment === 0 || row.provider_enrichment === 1) &&
    (row.chat_provider_id === null) === (row.chat_model === null)
  );
}

export function failUnsealedActiveJobs(db: MemoryDb): void {
  const active = db.getAllSync<PersistedIngestionIdentityRow>(
    `SELECT id, thread_id, thread_title, memory_conversation_id, persona_id, task_id,
            source_run_id, chat_provider_id, chat_model, source_start_message_id,
            source_end_message_id, source_at, reason, status, provider_enrichment, updated_at
       FROM memory_ingestion_jobs
      WHERE status IN ('pending', 'processing', 'retrying')`,
  );
  for (const row of active) {
    if (hasSealedIngestionIdentity(row)) continue;
    const outcomeCode = isExactMemoryScopeId(row.persona_id)
      ? 'source_identity_invalid'
      : 'persona_scope_missing';
    db.runSync('DELETE FROM memory_ingestion_receipts WHERE job_id = ?', row.id);
    db.runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'failed', provider_outcome = NULL, outcome_code = ?,
              next_attempt_at = NULL, lease_expires_at = NULL, claim_token = NULL,
              structural_completed_at = NULL, completed_at = updated_at
        WHERE id = ? AND status IN ('pending', 'processing', 'retrying')`,
      outcomeCode,
      row.id,
    );
  }
}

function ingestionIdentityKey(row: PersistedIngestionIdentityRow): string {
  return JSON.stringify([
    row.thread_id,
    row.thread_title,
    row.memory_conversation_id,
    row.persona_id,
    row.task_id,
    row.source_run_id,
    row.chat_provider_id,
    row.chat_model,
    row.source_start_message_id,
    row.source_end_message_id,
    row.source_at,
    row.reason,
    row.provider_enrichment,
  ]);
}

interface ConflictReceiptRow {
  episode_id: string | null;
  deterministic_fact_ids_json: string;
  provider_fact_ids_json: string;
  bridged_evidence_fact_ids_json: string;
  agent_run_memory_fact_ids_json: string;
}

interface ConflictEpisodeArtifactRow {
  id: string;
  conversation_id: string | null;
}

const CONFLICT_ARTIFACT_BATCH_SIZE = 100;
const CONFLICT_RECEIPT_ID_LIMIT = 512;

function parseConflictReceiptIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length > CONFLICT_RECEIPT_ID_LIMIT ||
      !parsed.every(isExactMemoryProvenanceId)
    ) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function eachArtifactBatch(
  ids: ReadonlyArray<string>,
  callback: (batch: ReadonlyArray<string>) => void,
): void {
  for (let offset = 0; offset < ids.length; offset += CONFLICT_ARTIFACT_BATCH_SIZE) {
    callback(ids.slice(offset, offset + CONFLICT_ARTIFACT_BATCH_SIZE));
  }
}

function collectConflictingSourceArtifacts(
  db: MemoryDb,
  group: ReadonlyArray<PersistedIngestionIdentityRow>,
): { episodes: ConflictEpisodeArtifactRow[]; factIds: string[] } {
  const episodes = new Map<string, ConflictEpisodeArtifactRow>();
  const factIds = new Set<string>();
  for (const row of group) {
    const receipts = db.getAllSync<ConflictReceiptRow>(
      `SELECT episode_id, deterministic_fact_ids_json, provider_fact_ids_json,
              bridged_evidence_fact_ids_json, agent_run_memory_fact_ids_json
         FROM memory_ingestion_receipts
        WHERE job_id = ?`,
      row.id,
    );
    const receiptFactIds = Array.from(
      new Set(
        receipts.flatMap((receipt) => [
          ...parseConflictReceiptIds(receipt.deterministic_fact_ids_json),
          ...parseConflictReceiptIds(receipt.provider_fact_ids_json),
          ...parseConflictReceiptIds(receipt.bridged_evidence_fact_ids_json),
          ...parseConflictReceiptIds(receipt.agent_run_memory_fact_ids_json),
        ]),
      ),
    );
    const receiptEpisodeIds = Array.from(
      new Set(
        receipts
          .map((receipt) => receipt.episode_id)
          .filter((id): id is string => isExactMemoryProvenanceId(id)),
      ),
    );
    const scopedEpisodes = db.getAllSync<ConflictEpisodeArtifactRow>(
      `SELECT id, conversation_id
         FROM memory_episodes
        WHERE conversation_id = ?
          AND thread_id = ?
          AND COALESCE(task_id, '') = COALESCE(?, '')
          AND source_end_message_id = ?`,
      row.memory_conversation_id,
      row.thread_id,
      row.task_id,
      row.source_end_message_id,
    );
    for (const episode of scopedEpisodes) episodes.set(episode.id, episode);
    eachArtifactBatch(receiptEpisodeIds, (batch) => {
      const matched = db.getAllSync<ConflictEpisodeArtifactRow>(
        `SELECT id, conversation_id
           FROM memory_episodes
          WHERE id IN (${batch.map(() => '?').join(', ')})
            AND conversation_id = ?
            AND thread_id = ?
            AND COALESCE(task_id, '') = COALESCE(?, '')
            AND source_end_message_id = ?`,
        ...batch,
        row.memory_conversation_id,
        row.thread_id,
        row.task_id,
        row.source_end_message_id,
      );
      for (const episode of matched) episodes.set(episode.id, episode);
    });

    for (const fact of db.getAllSync<{ id: string }>(
      `SELECT id
         FROM memory_facts
        WHERE origin_conversation_id = ?
          AND origin_thread_id = ?
          AND COALESCE(origin_task_id, '') = COALESCE(?, '')
          AND (
            source_turn_id = ?
            OR source_message_id = ?
            OR source_message_id = ?
            OR (? IS NOT NULL AND source_run_id = ?)
          )`,
      row.memory_conversation_id,
      row.thread_id,
      row.task_id,
      row.source_end_message_id,
      row.source_start_message_id,
      row.source_end_message_id,
      row.source_run_id,
      row.source_run_id,
    )) {
      factIds.add(fact.id);
    }
    eachArtifactBatch(receiptFactIds, (batch) => {
      for (const fact of db.getAllSync<{ id: string }>(
        `SELECT id
           FROM memory_facts
          WHERE id IN (${batch.map(() => '?').join(', ')})
            AND (
              source_turn_id = ?
              OR source_message_id = ?
              OR source_message_id = ?
              OR (? IS NOT NULL AND source_run_id = ?)
            )`,
        ...batch,
        row.source_end_message_id,
        row.source_start_message_id,
        row.source_end_message_id,
        row.source_run_id,
        row.source_run_id,
      )) {
        factIds.add(fact.id);
      }
    });
  }
  return {
    episodes: Array.from(episodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    factIds: Array.from(factIds).sort(),
  };
}

function quarantineConflictingSourceArtifacts(
  db: MemoryDb,
  group: ReadonlyArray<PersistedIngestionIdentityRow>,
): void {
  const artifacts = collectConflictingSourceArtifacts(db, group);
  const episodeIds = artifacts.episodes.map((episode) => episode.id);
  const quarantineAt = Math.max(
    0,
    ...group.map((row) =>
      Number.isSafeInteger(row.updated_at) && row.updated_at >= 0 ? row.updated_at : 0,
    ),
  );

  eachArtifactBatch(episodeIds, (batch) => {
    const placeholders = batch.map(() => '?').join(', ');
    db.runSync(`DELETE FROM memory_fact_evidence WHERE episode_id IN (${placeholders})`, ...batch);
    db.runSync(
      `DELETE FROM memory_episode_access_policies WHERE episode_id IN (${placeholders})`,
      ...batch,
    );
    db.runSync(`DELETE FROM memory_episode_terms WHERE episode_id IN (${placeholders})`, ...batch);
    db.runSync(
      `UPDATE memory_episodes
          SET deleted_at = COALESCE(deleted_at, ?)
        WHERE id IN (${placeholders})`,
      quarantineAt,
      ...batch,
    );
  });
  for (const episode of artifacts.episodes) {
    const source = episode.conversation_id
      ? `conversation/${episode.conversation_id}/episode/${episode.id}`
      : `episode/${episode.id}`;
    const sourceKey = episode.conversation_id
      ? `conversation:${episode.conversation_id}:episode:${episode.id}`
      : `global:episode:${episode.id}`;
    db.runSync(
      `DELETE FROM memory_chunks
        WHERE source_kind = 'episode' AND (source = ? OR source_key = ?)`,
      source,
      sourceKey,
    );
  }

  eachArtifactBatch(artifacts.factIds, (batch) => {
    const placeholders = batch.map(() => '?').join(', ');
    db.runSync(`DELETE FROM memory_fact_evidence WHERE fact_id IN (${placeholders})`, ...batch);
    db.runSync(`DELETE FROM memory_fact_observations WHERE fact_id IN (${placeholders})`, ...batch);
    db.runSync(`DELETE FROM memory_fact_terms WHERE fact_id IN (${placeholders})`, ...batch);
    db.runSync(
      `UPDATE memory_facts
          SET invalid_at = COALESCE(invalid_at, ?),
              deleted_at = COALESCE(deleted_at, ?),
              updated_at = MAX(updated_at, ?)
        WHERE id IN (${placeholders})`,
      quarantineAt,
      quarantineAt,
      quarantineAt,
      ...batch,
    );
  });
  if (artifacts.factIds.length > 0) {
    db.execSync(`
      DELETE FROM memory_fact_term_stats;
      INSERT INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
      SELECT unit, memory_kind, COUNT(*), SUM(weight)
        FROM memory_fact_terms
       GROUP BY unit, memory_kind;
    `);
  }

  for (const id of [...episodeIds, ...artifacts.factIds]) {
    const encoded = JSON.stringify(id);
    db.runSync(
      `UPDATE memory_reflections
          SET deleted_at = COALESCE(deleted_at, ?), updated_at = MAX(updated_at, ?)
        WHERE deleted_at IS NULL
          AND (
            INSTR(source_episode_ids_json, ?) > 0
            OR INSTR(source_fact_ids_json, ?) > 0
          )`,
      quarantineAt,
      quarantineAt,
      encoded,
      encoded,
    );
    db.runSync(
      `DELETE FROM memory_retrieval_events
        WHERE INSTR(selected_episode_ids_json, ?) > 0
           OR INSTR(selected_fact_ids_json, ?) > 0`,
      encoded,
      encoded,
    );
  }
}

export function quarantineConflictingSourceDuplicates(db: MemoryDb): void {
  const rows = db.getAllSync<PersistedIngestionIdentityRow>(
    `SELECT id, thread_id, thread_title, memory_conversation_id, persona_id, task_id,
            source_run_id, chat_provider_id, chat_model, source_start_message_id,
            source_end_message_id, source_at, reason, status, provider_enrichment, updated_at
       FROM memory_ingestion_jobs
      ORDER BY thread_id, source_end_message_id, id`,
  );
  const groups = new Map<string, PersistedIngestionIdentityRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.thread_id, row.source_end_message_id]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map(ingestionIdentityKey)).size === 1) continue;
    quarantineConflictingSourceArtifacts(db, group);
    for (const row of group) {
      db.runSync('DELETE FROM memory_ingestion_receipts WHERE job_id = ?', row.id);
      db.runSync(
        `UPDATE memory_ingestion_jobs
            SET status = 'failed', provider_outcome = NULL,
                outcome_code = 'source_identity_conflict', next_attempt_at = NULL,
                lease_expires_at = NULL, claim_token = NULL, structural_completed_at = NULL,
                completed_at = updated_at
          WHERE id = ?`,
        row.id,
      );
    }
  }
}
