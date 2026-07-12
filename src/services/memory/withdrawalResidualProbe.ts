import type { MemoryDatabase } from './access/schemaGuard';
import { getEmbeddingCacheEntryCount } from './embeddings';
import { captureScopedMemoryEvidence } from './evidenceSnapshot';

const PROBE_BATCH_SIZE = 200;

export const MEMORY_WITHDRAWAL_RESIDUAL_SURFACES = [
  'facts',
  'graphRelations',
  'retrievalTerms',
  'retrievalTermStats',
  'factEvidence',
  'factObservations',
  'verifiedProcedureObservations',
  'episodeAccessPolicies',
  'episodes',
  'reflections',
  'workingBlocks',
  'entities',
  'ingestionJobs',
  'ingestionReceipts',
  'retrievalEvents',
  'exports',
  'queueReplayFences',
  'embeddingCacheEntries',
] as const;

export type MemoryWithdrawalResidualSurface = (typeof MEMORY_WITHDRAWAL_RESIDUAL_SURFACES)[number];

export type MemoryWithdrawalResidualCounts = Readonly<
  Record<MemoryWithdrawalResidualSurface, number>
>;

export interface MemoryWithdrawalResidualSource {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string;
  sourceKind: 'message' | 'turn' | 'run';
  sourceId: string;
}

export interface MemoryWithdrawalResidualScope {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string;
}

export interface MemoryWithdrawalResidualPlan {
  factIds: ReadonlyArray<string>;
  retrievalTermStats: ReadonlyArray<{ unit: string; memoryKind: string }>;
  evidenceIds: ReadonlyArray<string>;
  observationIds: ReadonlyArray<string>;
  verifiedProcedureObservationIds: ReadonlyArray<string>;
  episodeIds: ReadonlyArray<string>;
  reflectionIds: ReadonlyArray<string>;
  workingBlocks: ReadonlyArray<{ label: string; scopeKey: string }>;
  entityIds: ReadonlyArray<string>;
  ingestionJobIds: ReadonlyArray<string>;
  ingestionReceiptJobIds: ReadonlyArray<string>;
  affectedScopes: ReadonlyArray<MemoryWithdrawalResidualScope>;
  sources: ReadonlyArray<MemoryWithdrawalResidualSource>;
  auditAllRetrievalTermStats?: boolean;
  checkEmbeddingCache?: boolean;
}

export interface MemoryWithdrawalResidualProbe {
  status: 'clear' | 'residual';
  counts: MemoryWithdrawalResidualCounts;
}

function countIds(
  db: MemoryDatabase,
  table: string,
  column: string,
  ids: ReadonlyArray<string | number>,
  suffix = '',
): number {
  let count = 0;
  for (let offset = 0; offset < ids.length; offset += PROBE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PROBE_BATCH_SIZE);
    count +=
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}
          WHERE ${column} IN (${batch.map(() => '?').join(', ')}) ${suffix}`,
        ...batch,
      )?.count ?? 0;
  }
  return count;
}

function rawJsonContainsAnyId(raw: string, ids: ReadonlyArray<string>): boolean {
  return ids.some((id) => raw.includes(JSON.stringify(id)));
}

function retrievalEventResiduals(
  db: MemoryDatabase,
  factIds: ReadonlyArray<string>,
  episodeIds: ReadonlyArray<string>,
): number {
  return db
    .getAllSync<{
      selected_fact_ids_json: string;
      selected_episode_ids_json: string;
    }>('SELECT selected_fact_ids_json, selected_episode_ids_json FROM memory_retrieval_events')
    .filter(
      (row) =>
        rawJsonContainsAnyId(row.selected_fact_ids_json, factIds) ||
        rawJsonContainsAnyId(row.selected_episode_ids_json, episodeIds),
    ).length;
}

interface RetrievalTermStatRow {
  unit: string;
  memory_kind: string;
  fact_count: number;
  total_weight: number;
}

function countRetrievalTermStatMismatches(
  grouped: ReadonlyArray<RetrievalTermStatRow>,
  stats: ReadonlyArray<RetrievalTermStatRow>,
): number {
  const groupedByKey = new Map(grouped.map((row) => [`${row.unit}\u0000${row.memory_kind}`, row]));
  const statsByKey = new Map(stats.map((row) => [`${row.unit}\u0000${row.memory_kind}`, row]));
  const keys = new Set([...groupedByKey.keys(), ...statsByKey.keys()]);
  let residuals = 0;
  for (const key of keys) {
    const expected = groupedByKey.get(key);
    const actual = statsByKey.get(key);
    if (
      !expected ||
      !actual ||
      actual.fact_count <= 0 ||
      actual.fact_count !== expected.fact_count ||
      Math.abs(actual.total_weight - expected.total_weight) > 1e-9
    ) {
      residuals += 1;
    }
  }
  return residuals;
}

function retrievalTermStatResiduals(
  db: MemoryDatabase,
  plan: MemoryWithdrawalResidualPlan,
): number {
  if (plan.auditAllRetrievalTermStats) {
    return countRetrievalTermStatMismatches(
      db.getAllSync<RetrievalTermStatRow>(
        `SELECT unit, memory_kind, COUNT(*) AS fact_count, SUM(weight) AS total_weight
           FROM memory_fact_terms GROUP BY unit, memory_kind`,
      ),
      db.getAllSync<RetrievalTermStatRow>(
        'SELECT unit, memory_kind, fact_count, total_weight FROM memory_fact_term_stats',
      ),
    );
  }

  let residuals = 0;
  for (const key of plan.retrievalTermStats) {
    const grouped = db.getFirstSync<RetrievalTermStatRow>(
      `SELECT ? AS unit, ? AS memory_kind,
              COUNT(*) AS fact_count, COALESCE(SUM(weight), 0) AS total_weight
         FROM memory_fact_terms
        WHERE unit = ? AND memory_kind = ?`,
      key.unit,
      key.memoryKind,
      key.unit,
      key.memoryKind,
    );
    const stat = db.getFirstSync<RetrievalTermStatRow>(
      `SELECT unit, memory_kind, fact_count, total_weight
         FROM memory_fact_term_stats WHERE unit = ? AND memory_kind = ? LIMIT 1`,
      key.unit,
      key.memoryKind,
    );
    if (!grouped) {
      residuals += 1;
      continue;
    }
    if (grouped.fact_count === 0) {
      if (stat) residuals += 1;
      continue;
    }
    if (
      !stat ||
      stat.fact_count <= 0 ||
      stat.fact_count !== grouped.fact_count ||
      Math.abs(stat.total_weight - grouped.total_weight) > 1e-9
    ) {
      residuals += 1;
    }
  }
  return residuals;
}

function exportResiduals(plan: MemoryWithdrawalResidualPlan): number {
  const factIds = new Set(plan.factIds);
  const episodeIds = new Set(plan.episodeIds);
  const workingBlockIds = new Set(
    plan.workingBlocks.map((block) => `${block.label}:${block.scopeKey}`),
  );
  const ingestionJobIds = new Set(plan.ingestionJobIds);
  const scopes = new Map<string, { memoryConversationId: string; sourceThreadId: string }>();
  for (const affectedScope of plan.affectedScopes) {
    if (!affectedScope.memoryConversationId || !affectedScope.sourceThreadId) continue;
    const scope = {
      memoryConversationId: affectedScope.memoryConversationId,
      sourceThreadId: affectedScope.sourceThreadId,
    };
    scopes.set(JSON.stringify(scope), scope);
  }
  let residuals = 0;
  for (const scope of scopes.values()) {
    const snapshot = captureScopedMemoryEvidence(scope);
    residuals += snapshot.facts.filter((row) => factIds.has(row.id)).length;
    residuals += snapshot.episodes.filter((row) => episodeIds.has(row.id)).length;
    residuals += snapshot.workingBlocks.filter((row) => workingBlockIds.has(row.id)).length;
    residuals += snapshot.ingestionJobs.filter((row) => ingestionJobIds.has(row.id)).length;
  }
  return residuals;
}

function queueReplayFenceResiduals(
  db: MemoryDatabase,
  sources: ReadonlyArray<MemoryWithdrawalResidualSource>,
): number {
  let missing = 0;
  for (const source of sources) {
    const present = db.getFirstSync<{ present: number }>(
      `SELECT 1 AS present FROM memory_withdrawal_sources
        WHERE memory_conversation_id = ? AND source_thread_id = ? AND task_id = ?
          AND source_kind = ? AND source_id = ?
        LIMIT 1`,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      source.sourceKind,
      source.sourceId,
    );
    if (!present) missing += 1;
  }
  return missing;
}

function factObservationResiduals(db: MemoryDatabase, plan: MemoryWithdrawalResidualPlan): number {
  const ids = new Set<string>();
  for (let offset = 0; offset < plan.observationIds.length; offset += PROBE_BATCH_SIZE) {
    const batch = plan.observationIds.slice(offset, offset + PROBE_BATCH_SIZE);
    for (const row of db.getAllSync<{ id: string }>(
      `SELECT id FROM memory_fact_observations
        WHERE id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    )) {
      ids.add(row.id);
    }
  }
  for (const source of plan.sources) {
    const sourceKind =
      source.sourceKind === 'message'
        ? 'user_message'
        : source.sourceKind === 'run'
          ? 'tool_run'
          : null;
    if (!sourceKind) continue;
    for (const row of db.getAllSync<{ id: string }>(
      `SELECT id FROM memory_fact_observations
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
      ids.add(row.id);
    }
  }
  return ids.size;
}

export function probeMemoryWithdrawalResiduals(
  db: MemoryDatabase,
  plan: MemoryWithdrawalResidualPlan,
): MemoryWithdrawalResidualProbe {
  const counts: MemoryWithdrawalResidualCounts = {
    facts: countIds(db, 'memory_facts', 'id', plan.factIds),
    graphRelations: countIds(
      db,
      'memory_facts',
      'id',
      plan.factIds,
      'AND object_entity_id IS NOT NULL',
    ),
    retrievalTerms: countIds(db, 'memory_fact_terms', 'fact_id', plan.factIds),
    retrievalTermStats: retrievalTermStatResiduals(db, plan),
    factEvidence: countIds(db, 'memory_fact_evidence', 'id', plan.evidenceIds),
    factObservations: factObservationResiduals(db, plan),
    verifiedProcedureObservations: countIds(
      db,
      'memory_verified_procedure_observations',
      'id',
      plan.verifiedProcedureObservationIds,
    ),
    episodeAccessPolicies: countIds(
      db,
      'memory_episode_access_policies',
      'episode_id',
      plan.episodeIds,
    ),
    episodes: countIds(db, 'memory_episodes', 'id', plan.episodeIds),
    reflections: countIds(db, 'memory_reflections', 'id', plan.reflectionIds),
    workingBlocks: plan.workingBlocks.reduce(
      (count, block) =>
        count +
        (db.getFirstSync<{ present: number }>(
          `SELECT 1 AS present FROM memory_working_blocks
            WHERE label = ? AND scope_key = ? LIMIT 1`,
          block.label,
          block.scopeKey,
        )
          ? 1
          : 0),
      0,
    ),
    entities: countIds(db, 'memory_entities', 'id', plan.entityIds),
    ingestionJobs: countIds(db, 'memory_ingestion_jobs', 'id', plan.ingestionJobIds),
    ingestionReceipts: countIds(
      db,
      'memory_ingestion_receipts',
      'job_id',
      plan.ingestionReceiptJobIds,
    ),
    retrievalEvents: retrievalEventResiduals(db, plan.factIds, plan.episodeIds),
    exports: exportResiduals(plan),
    queueReplayFences: queueReplayFenceResiduals(db, plan.sources),
    embeddingCacheEntries: plan.checkEmbeddingCache === false ? 0 : getEmbeddingCacheEntryCount(),
  };
  return {
    status: Object.values(counts).some((count) => count !== 0) ? 'residual' : 'clear',
    counts,
  };
}

export function assertMemoryWithdrawalHasNoResiduals(
  db: MemoryDatabase,
  plan: MemoryWithdrawalResidualPlan,
): void {
  if (probeMemoryWithdrawalResiduals(db, plan).status !== 'clear') {
    throw new Error('withdrawal_residual_detected');
  }
}
