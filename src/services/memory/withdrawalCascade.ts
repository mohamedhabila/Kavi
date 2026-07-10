import type { MemoryDatabase } from './access/schemaGuard';
import { deleteFactRetrievalTerms } from './facts/retrievalIndex';
import { newId } from './schema';
import type { MemoryWithdrawalLineage } from './withdrawalLineage';
import { normalizeWithdrawalOpaqueId } from './withdrawalLineage';
import { assertMemoryWithdrawalHasNoResiduals } from './withdrawalResidualProbe';
import type { MemoryWithdrawalResidualPlan } from './withdrawalResidualProbe';
import {
  EMPTY_MEMORY_WITHDRAWAL_COUNTS,
  type MemoryWithdrawalCounts,
  type WithdrawMemoryFactResult,
} from './withdrawalTypes';

const DELETE_BATCH_SIZE = 200;
const MAX_LINEAGE_IDS = 512;

interface RetrievalEventLineageRow {
  id: string;
  selected_fact_ids_json: string;
  selected_episode_ids_json: string;
}

interface RetrievalTermLineageRow {
  unit: string;
  memory_kind: string;
}

interface FactObservationLineageRow {
  id: string;
  fact_id: string;
}

export interface MemoryWithdrawalTransactionResult {
  result: WithdrawMemoryFactResult;
  notificationScope: string | null;
  residualPlan: MemoryWithdrawalResidualPlan;
}

function deleteIds(
  db: MemoryDatabase,
  table: string,
  column: string,
  ids: ReadonlyArray<string | number>,
): number {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += DELETE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + DELETE_BATCH_SIZE);
    deleted +=
      db.runSync(
        `DELETE FROM ${table} WHERE ${column} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      ).changes ?? 0;
  }
  return deleted;
}

function rawJsonArrayContainsId(raw: string, expected: ReadonlySet<string>): boolean {
  for (const id of expected) if (raw.includes(JSON.stringify(id))) return true;
  return false;
}

function parseLineageIds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('withdrawal_lineage_invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_LINEAGE_IDS ||
    !parsed.every(
      (value) => typeof value === 'string' && normalizeWithdrawalOpaqueId(value) === value,
    )
  ) {
    throw new Error('withdrawal_lineage_invalid');
  }
  return parsed;
}

function scrubRetrievalEvents(
  db: MemoryDatabase,
  factIds: ReadonlySet<string>,
  episodeIds: ReadonlySet<string>,
): number {
  let changed = 0;
  const rows = db.getAllSync<RetrievalEventLineageRow>(
    'SELECT id, selected_fact_ids_json, selected_episode_ids_json FROM memory_retrieval_events',
  );
  for (const row of rows) {
    const factCandidate = rawJsonArrayContainsId(row.selected_fact_ids_json, factIds);
    const episodeCandidate = rawJsonArrayContainsId(row.selected_episode_ids_json, episodeIds);
    if (!factCandidate && !episodeCandidate) continue;
    let selectedFactIds: string[];
    let selectedEpisodeIds: string[];
    try {
      selectedFactIds = parseLineageIds(row.selected_fact_ids_json);
      selectedEpisodeIds = parseLineageIds(row.selected_episode_ids_json);
    } catch {
      changed +=
        db.runSync('DELETE FROM memory_retrieval_events WHERE id = ?', row.id).changes ?? 0;
      continue;
    }
    changed +=
      db.runSync(
        `UPDATE memory_retrieval_events
            SET selected_fact_ids_json = ?, selected_episode_ids_json = ?
          WHERE id = ?`,
        JSON.stringify(selectedFactIds.filter((id) => !factIds.has(id))),
        JSON.stringify(selectedEpisodeIds.filter((id) => !episodeIds.has(id))),
        row.id,
      ).changes ?? 0;
  }
  return changed;
}

function isOrphanEntity(db: MemoryDatabase, entityId: string): boolean {
  return !db.getFirstSync<{ present: number }>(
    `SELECT 1 AS present FROM memory_facts
      WHERE subject_id = ? OR object_entity_id = ? LIMIT 1`,
    entityId,
    entityId,
  );
}

function collectFactObservations(
  db: MemoryDatabase,
  lineage: MemoryWithdrawalLineage,
): FactObservationLineageRow[] {
  const observations = new Map<string, FactObservationLineageRow>();
  for (let offset = 0; offset < lineage.factIds.length; offset += DELETE_BATCH_SIZE) {
    const batch = lineage.factIds.slice(offset, offset + DELETE_BATCH_SIZE);
    for (const row of db.getAllSync<FactObservationLineageRow>(
      `SELECT id, fact_id FROM memory_fact_observations
        WHERE fact_id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    )) {
      observations.set(row.id, row);
    }
  }
  for (const source of lineage.scopedSources) {
    const sourceKind =
      source.sourceKind === 'message'
        ? 'user_message'
        : source.sourceKind === 'run'
          ? 'tool_run'
          : null;
    if (!sourceKind) continue;
    for (const row of db.getAllSync<FactObservationLineageRow>(
      `SELECT id, fact_id FROM memory_fact_observations
        WHERE source_conversation_id = ?
          AND source_thread_id = ?
          AND COALESCE(source_task_id, '') = ?
          AND source_kind = ?
          AND source_id = ?`,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      sourceKind,
      source.sourceId,
    )) {
      observations.set(row.id, row);
    }
  }
  return Array.from(observations.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function recomputeFactObservationState(
  db: MemoryDatabase,
  factIds: ReadonlyArray<string>,
  now: number,
): void {
  for (const factId of factIds) {
    db.runSync(
      `UPDATE memory_facts
          SET last_conflicted_at = (
                SELECT MAX(observed_at)
                  FROM memory_fact_observations
                 WHERE fact_id = memory_facts.id AND relation = 'conflicts'
              ),
              last_confirmed_at = (
                SELECT MAX(observed_at)
                  FROM memory_fact_observations
                 WHERE fact_id = memory_facts.id AND relation = 'supports'
              ),
              updated_at = MAX(updated_at, ?)
        WHERE id = ? AND deleted_at IS NULL`,
      now,
      factId,
    );
  }
}

export function executeMemoryWithdrawalCascade(
  db: MemoryDatabase,
  factId: string,
  lineage: MemoryWithdrawalLineage,
  now: number,
): MemoryWithdrawalTransactionResult {
  const withdrawalId = newId('withdrawal');
  db.runSync(
    `INSERT INTO memory_withdrawals(
       id, target_fact_id, memory_conversation_id, source_thread_id, task_id, reason, withdrawn_at
     ) VALUES (?, ?, ?, ?, ?, 'user_request', ?)`,
    withdrawalId,
    factId,
    lineage.targetScope.memoryConversationId,
    lineage.targetScope.sourceThreadId,
    lineage.targetScope.taskId,
    now,
  );
  for (const removedFactId of lineage.factIds) {
    db.runSync(
      'INSERT INTO memory_withdrawal_facts(withdrawal_id, fact_id) VALUES (?, ?)',
      withdrawalId,
      removedFactId,
    );
  }
  for (const source of lineage.scopedSources) {
    db.runSync(
      `INSERT INTO memory_withdrawal_sources(
         withdrawal_id, memory_conversation_id, source_thread_id, task_id,
         source_kind, source_id
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      withdrawalId,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      source.sourceKind,
      source.sourceId,
    );
  }

  const retrievalTermRows: RetrievalTermLineageRow[] = [];
  for (let offset = 0; offset < lineage.factIds.length; offset += DELETE_BATCH_SIZE) {
    const factIds = lineage.factIds.slice(offset, offset + DELETE_BATCH_SIZE);
    retrievalTermRows.push(
      ...db.getAllSync<RetrievalTermLineageRow>(
        `SELECT unit, memory_kind FROM memory_fact_terms
          WHERE fact_id IN (${factIds.map(() => '?').join(', ')})`,
        ...factIds,
      ),
    );
  }
  for (const removedFactId of lineage.factIds) {
    deleteFactRetrievalTerms(removedFactId);
  }
  const retrievalTermStats = Array.from(
    new Map(
      retrievalTermRows.map((row) => [
        `${row.unit}\u0000${row.memory_kind}`,
        { unit: row.unit, memoryKind: row.memory_kind },
      ]),
    ).values(),
  );
  const factIds = new Set(lineage.factIds);
  const episodeIds = new Set(lineage.episodeIds);
  const observations = collectFactObservations(db, lineage);
  const observationIds = observations.map((row) => row.id);
  const survivingObservationFactIds = Array.from(
    new Set(
      observations
        .map((row) => row.fact_id)
        .filter((observationFactId) => !factIds.has(observationFactId)),
    ),
  ).sort();

  const countsBase: MemoryWithdrawalCounts = {
    ...EMPTY_MEMORY_WITHDRAWAL_COUNTS,
    graphRelations: lineage.facts.filter((row) => Boolean(row.object_entity_id)).length,
    factEvidence: deleteIds(
      db,
      'memory_fact_evidence',
      'id',
      lineage.evidence.map((row) => row.id),
    ),
    factObservations: deleteIds(db, 'memory_fact_observations', 'id', observationIds),
    retrievalTerms: retrievalTermRows.length,
    chunks: deleteIds(
      db,
      'memory_chunks',
      'id',
      lineage.chunks.map((row) => row.id),
    ),
    reflections: deleteIds(
      db,
      'memory_reflections',
      'id',
      lineage.reflections.map((row) => row.id),
    ),
    episodes: deleteIds(db, 'memory_episodes', 'id', lineage.episodeIds),
    workingBlocks: lineage.workingBlocks.reduce(
      (count, row) =>
        count +
        (db.runSync(
          'DELETE FROM memory_working_blocks WHERE label = ? AND scope_key = ?',
          row.label,
          row.scope_key,
        ).changes ?? 0),
      0,
    ),
    ingestionReceipts: deleteIds(
      db,
      'memory_ingestion_receipts',
      'job_id',
      lineage.receiptDeletionJobIds,
    ),
    ingestionJobs: deleteIds(db, 'memory_ingestion_jobs', 'id', lineage.jobIds),
    retrievalEvents: scrubRetrievalEvents(db, factIds, episodeIds),
    facts: deleteIds(db, 'memory_facts', 'id', lineage.factIds),
    orphanEntities: 0,
    embeddingCacheEntries: 0,
  };
  recomputeFactObservationState(db, survivingObservationFactIds, now);
  const deletedEntityIds: string[] = [];
  let orphanEntities = 0;
  for (const entityId of lineage.candidateEntityIds) {
    if (!isOrphanEntity(db, entityId)) continue;
    const deleted = db.runSync('DELETE FROM memory_entities WHERE id = ?', entityId).changes ?? 0;
    orphanEntities += deleted;
    if (deleted > 0) deletedEntityIds.push(entityId);
  }
  const counts = { ...countsBase, orphanEntities };
  const residualPlan: MemoryWithdrawalResidualPlan = {
    factIds: lineage.factIds,
    retrievalTermStats,
    evidenceIds: lineage.evidence.map((row) => row.id),
    observationIds,
    episodeIds: lineage.episodeIds,
    chunkIds: lineage.chunks.map((row) => row.id),
    reflectionIds: lineage.reflections.map((row) => row.id),
    workingBlocks: lineage.workingBlocks.map((row) => ({
      label: row.label,
      scopeKey: row.scope_key,
    })),
    entityIds: deletedEntityIds,
    ingestionJobIds: lineage.jobIds,
    ingestionReceiptJobIds: lineage.receiptDeletionJobIds,
    affectedScopes: lineage.affectedScopes,
    sources: lineage.scopedSources,
  };
  assertMemoryWithdrawalHasNoResiduals(db, { ...residualPlan, checkEmbeddingCache: false });

  return {
    result: {
      status: 'withdrawn',
      receipt: {
        status: 'withdrawn',
        withdrawalId,
        factId,
        withdrawnAt: now,
        counts,
      },
    },
    notificationScope:
      lineage.affectedScopes.length === 1
        ? lineage.affectedScopes[0].memoryConversationId || null
        : null,
    residualPlan,
  };
}
