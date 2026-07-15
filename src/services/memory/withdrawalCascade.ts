import type { MemoryDatabase } from './access/schemaGuard';
import { deleteEpisodeAccessPolicies } from './episodes/accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import type { MemoryWithdrawalLineage } from './withdrawalLineage';
import { normalizeWithdrawalOpaqueId } from './withdrawalLineage';
import { assertMemoryWithdrawalHasNoResiduals } from './withdrawalResidualProbe';
import type { MemoryWithdrawalResidualPlan } from './withdrawalResidualProbe';
import {
  EMPTY_MEMORY_WITHDRAWAL_COUNTS,
  type MemoryWithdrawalCounts,
} from './withdrawalTypes';
import { hashVerifiedProcedureProvenanceSync } from './verifiedProcedure/provenanceHash';
import { decodeVerifiedProcedureEvidenceManifest } from './verifiedProcedure/evidenceManifest';
import { fenceVerifiedProcedureExecutionRunHashes } from './verifiedProcedure/invalidation';

const DELETE_BATCH_SIZE = 200;
const MAX_LINEAGE_IDS = 512;

interface RetrievalEventLineageRow {
  id: string;
  selected_fact_ids_json: string;
  selected_episode_ids_json: string;
}

interface FactObservationLineageRow {
  id: string;
  fact_id: string;
}

interface VerifiedProcedureObservationLineageRow {
  id: string;
  evidence_manifest_json: string;
  source_run_id_hash: string;
}

interface VerifiedProcedureScopedSourceHashes {
  memoryConversationIdHash: string;
  sourceThreadIdHash: string;
  taskIdHash: string | null;
  messageIds: Set<string>;
  runIds: Set<string>;
  turnIds: Set<string>;
}

export interface MemoryRetirementArtifactCleanupResult {
  counts: MemoryWithdrawalCounts;
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

function countIds(
  db: MemoryDatabase,
  table: string,
  column: string,
  ids: ReadonlyArray<string | number>,
): number {
  let count = 0;
  for (let offset = 0; offset < ids.length; offset += DELETE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + DELETE_BATCH_SIZE);
    count +=
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}
          WHERE ${column} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      )?.count ?? 0;
  }
  return count;
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
      WHERE deleted_at IS NULL AND (subject_id = ? OR object_entity_id = ?) LIMIT 1`,
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

function collectVerifiedProcedureObservations(
  db: MemoryDatabase,
  lineage: MemoryWithdrawalLineage,
  memoryOwnerId: string,
): VerifiedProcedureObservationLineageRow[] {
  const scopeIndexes = new Map<string, VerifiedProcedureScopedSourceHashes>();
  for (const source of lineage.scopedSources) {
    const memoryConversationIdHash = hashVerifiedProcedureProvenanceSync(
      'memory-conversation',
      source.memoryConversationId,
    );
    const sourceThreadIdHash = hashVerifiedProcedureProvenanceSync(
      'source-thread',
      source.sourceThreadId,
    );
    const taskIdHash = source.taskId
      ? hashVerifiedProcedureProvenanceSync('memory-source-task', source.taskId)
      : null;
    const key = `${memoryConversationIdHash}:${sourceThreadIdHash}:${taskIdHash ?? ''}`;
    let index = scopeIndexes.get(key);
    if (!index) {
      index = {
        memoryConversationIdHash,
        sourceThreadIdHash,
        taskIdHash,
        messageIds: new Set(),
        runIds: new Set(),
        turnIds: new Set(),
      };
      scopeIndexes.set(key, index);
    }
    if (source.sourceKind === 'message') {
      index.messageIds.add(
        hashVerifiedProcedureProvenanceSync('memory-source-message', source.sourceId),
      );
    } else if (source.sourceKind === 'turn') {
      index.turnIds.add(hashVerifiedProcedureProvenanceSync('memory-source-turn', source.sourceId));
    } else {
      index.runIds.add(hashVerifiedProcedureProvenanceSync('memory-source-run', source.sourceId));
    }
  }
  const rows = new Map<string, VerifiedProcedureObservationLineageRow>();
  for (const index of scopeIndexes.values()) {
    for (const row of db.getAllSync<VerifiedProcedureObservationLineageRow>(
      `SELECT id, evidence_manifest_json, source_run_id_hash
         FROM memory_verified_procedure_observations
        WHERE memory_owner_id = ?
          AND memory_conversation_id_hash = ?
          AND source_thread_id_hash = ?`,
      memoryOwnerId,
      index.memoryConversationIdHash,
      index.sourceThreadIdHash,
    )) {
      const manifest = decodeVerifiedProcedureEvidenceManifest(row.evidence_manifest_json);
      if (!manifest || manifest.sourceLineage.taskIdHash !== index.taskIdHash) continue;
      const specificSourceMatches =
        index.messageIds.has(manifest.sourceLineage.sourceMessageIdHash) ||
        index.turnIds.has(manifest.sourceLineage.sourceTurnIdHash);
      const hasSpecificSources = index.messageIds.size > 0 || index.turnIds.size > 0;
      const runSourceMatches =
        manifest.sourceLineage.sourceRunIdHash !== null &&
        index.runIds.has(manifest.sourceLineage.sourceRunIdHash);
      if (specificSourceMatches || (!hasSpecificSources && runSourceMatches)) {
        rows.set(row.id, row);
      }
    }
  }
  return Array.from(rows.values()).sort((left, right) => left.id.localeCompare(right.id));
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

export function cleanupRetiredMemoryArtifactsInTransaction(
  db: MemoryDatabase,
  lineage: MemoryWithdrawalLineage,
  fencedSources: MemoryWithdrawalLineage['scopedSources'],
  now: number,
): MemoryRetirementArtifactCleanupResult {
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  if (lineage.target.memory_owner_id !== memoryOwnerId) {
    throw new Error('withdrawal_lineage_invalid');
  }
  const retrievalTermStats: Array<{ unit: string; memoryKind: string }> = [];
  const factIds = new Set(lineage.factIds);
  const episodeIds = new Set(lineage.episodeIds);
  const observations = collectFactObservations(db, lineage);
  const observationIds = observations.map((row) => row.id);
  const verifiedProcedureObservations = collectVerifiedProcedureObservations(
    db,
    lineage,
    memoryOwnerId,
  );
  const verifiedProcedureObservationIds = verifiedProcedureObservations.map((row) => row.id);
  fenceVerifiedProcedureExecutionRunHashes({
    db,
    memoryOwnerId,
    sourceRunIdHashes: verifiedProcedureObservations.map((row) => row.source_run_id_hash),
    invalidatedAt: now,
  });
  const survivingObservationFactIds = Array.from(
    new Set(
      observations
        .map((row) => row.fact_id)
        .filter((observationFactId) => !factIds.has(observationFactId)),
    ),
  ).sort();
  const ingestionSourceSnapshotCount = countIds(
    db,
    'memory_ingestion_source_snapshots',
    'job_id',
    lineage.jobIds,
  );

  const countsBase: MemoryWithdrawalCounts = {
    ...EMPTY_MEMORY_WITHDRAWAL_COUNTS,
    facts: lineage.factIds.length,
    graphRelations: lineage.facts.filter((row) => Boolean(row.object_entity_id)).length,
    factEvidence: deleteIds(
      db,
      'memory_fact_evidence',
      'id',
      lineage.evidence.map((row) => row.id),
    ),
    factObservations: deleteIds(db, 'memory_fact_observations', 'id', observationIds),
    verifiedProcedureObservations: deleteIds(
      db,
      'memory_verified_procedure_observations',
      'id',
      verifiedProcedureObservationIds,
    ),
    retrievalTerms: 0,
    reflections: deleteIds(
      db,
      'memory_reflections',
      'id',
      lineage.reflections.map((row) => row.id),
    ),
    episodeAccessPolicies: deleteEpisodeAccessPolicies(db, lineage.episodeIds),
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
    ingestionReceipts:
      deleteIds(
        db,
        'memory_ingestion_structural_receipts',
        'job_id',
        lineage.receiptDeletionJobIds,
      ) +
      deleteIds(db, 'memory_ingestion_receipts', 'job_id', lineage.receiptDeletionJobIds),
    ingestionSourceSnapshots: ingestionSourceSnapshotCount,
    ingestionJobs: deleteIds(db, 'memory_ingestion_jobs', 'id', lineage.jobIds),
    retrievalEvents: scrubRetrievalEvents(db, factIds, episodeIds),
    orphanEntities: 0,
    embeddingCacheEntries: 0,
  };
  deleteIds(db, 'memory_ingestion_source_snapshots', 'job_id', lineage.jobIds);
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
    verifiedProcedureObservationIds,
    episodeIds: lineage.episodeIds,
    reflectionIds: lineage.reflections.map((row) => row.id),
    workingBlocks: lineage.workingBlocks.map((row) => ({
      label: row.label,
      scopeKey: row.scope_key,
    })),
    entityIds: deletedEntityIds,
    ingestionJobIds: lineage.jobIds,
    ingestionReceiptJobIds: lineage.receiptDeletionJobIds,
    affectedScopes: lineage.affectedScopes,
    sources: fencedSources,
  };
  assertMemoryWithdrawalHasNoResiduals(db, { ...residualPlan, checkEmbeddingCache: false });

  return { counts, residualPlan };
}
