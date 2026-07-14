import type { MemoryDatabase } from './access/schemaGuard';
import { assertMemoryTransactionActive } from './access/transaction';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { purgeRetiredCausalPayloadsInTransaction } from './retiredCausalPayloadPurge';
import { cleanupSourceLifecycleDerivedArtifactsInTransaction } from './sourceLifecycleDerivedArtifactCleanup';

const BATCH_SIZE = 128;
const MAX_IDS_PER_DERIVED_ROW = 4_096;

interface EpisodeCandidateRow {
  id: string;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string | null;
  message_ids_json: string;
}

export interface SourceLifecycleArtifactCleanupInput {
  mode: 'conversation_delete' | 'memory_opt_out';
  conversationScopes: ReadonlyArray<
    Readonly<{ memoryConversationId: string; sourceThreadId: string }>
  >;
  ingestionJobIds: ReadonlyArray<string>;
  retiredContributionIds: ReadonlyArray<string>;
  retiredFactIds: ReadonlyArray<string>;
  closedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  now: number;
}

export interface SourceLifecycleArtifactCleanupReceipt {
  ingestionJobs: number;
  episodes: number;
  reflections: number;
  retrievalEvents: number;
  contributionPayloads: number;
  factPayloads: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function requireUniqueIds(values: ReadonlyArray<string>, code: string): string[] {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 512)
  ) {
    return fail(code);
  }
  const sorted = [...values].sort();
  if (sorted.some((value, index) => index > 0 && value === sorted[index - 1])) {
    return fail(code);
  }
  return sorted;
}

function parseIds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('memory_source_lifecycle_derived_lineage_invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_IDS_PER_DERIVED_ROW ||
    parsed.some((value) => typeof value !== 'string')
  ) {
    return fail('memory_source_lifecycle_derived_lineage_invalid');
  }
  return parsed as string[];
}

function deleteIds(
  db: MemoryDatabase,
  table: string,
  column: string,
  ids: ReadonlyArray<string>,
): number {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
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
  ids: ReadonlyArray<string>,
): number {
  let count = 0;
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    count +=
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}
          WHERE ${column} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      )?.count ?? 0;
  }
  return count;
}

function collectJobIds(db: MemoryDatabase, input: SourceLifecycleArtifactCleanupInput): string[] {
  const ids = new Set(
    requireUniqueIds(input.ingestionJobIds, 'memory_source_lifecycle_job_ids_invalid'),
  );
  for (const scope of input.conversationScopes) {
    let cursor = '';
    for (;;) {
      const rows = db.getAllSync<{ id: string }>(
        `SELECT id FROM memory_ingestion_jobs
          WHERE memory_conversation_id = ? AND thread_id = ? AND id > ?
          ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
        scope.memoryConversationId,
        scope.sourceThreadId,
        cursor,
      );
      if (rows.length === 0) break;
      for (const row of rows) ids.add(row.id);
      cursor = rows[rows.length - 1]!.id;
    }
  }
  for (const source of input.closedSources) {
    let cursor = '';
    for (;;) {
      const rows = db.getAllSync<{ job_id: string }>(
        `SELECT job_id FROM memory_ingestion_job_sources
          WHERE memory_owner_id = ? AND memory_conversation_id = ?
            AND source_thread_id = ? AND task_id = ?
            AND source_kind = ? AND source_id = ? AND job_id > ?
          ORDER BY job_id ASC LIMIT ${BATCH_SIZE}`,
        source.memoryOwnerId,
        source.memoryConversationId,
        source.sourceThreadId,
        source.taskId,
        source.sourceKind,
        source.sourceId,
        cursor,
      );
      if (rows.length === 0) break;
      for (const row of rows) ids.add(row.job_id);
      cursor = rows[rows.length - 1]!.job_id;
    }
  }
  return Array.from(ids).sort();
}

function sourceScopeKey(source: PersistedExactMemorySourceIdentity): string {
  return JSON.stringify([source.memoryConversationId, source.sourceThreadId, source.taskId]);
}

function collectEpisodeIds(
  db: MemoryDatabase,
  input: SourceLifecycleArtifactCleanupInput,
  jobIds: ReadonlyArray<string>,
  retiredFactIds: ReadonlyArray<string>,
): string[] {
  const ids = new Set<string>();
  for (const scope of input.conversationScopes) {
    let cursor = '';
    for (;;) {
      const rows = db.getAllSync<{ id: string }>(
        `SELECT id FROM memory_episodes
          WHERE conversation_id = ? AND thread_id = ? AND id > ?
          ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
        scope.memoryConversationId,
        scope.sourceThreadId,
        cursor,
      );
      if (rows.length === 0) break;
      for (const row of rows) ids.add(row.id);
      cursor = rows[rows.length - 1]!.id;
    }
  }
  for (let offset = 0; offset < jobIds.length; offset += BATCH_SIZE) {
    const batch = jobIds.slice(offset, offset + BATCH_SIZE);
    for (const row of db.getAllSync<{ episode_id: string }>(
      `SELECT episode_id FROM memory_ingestion_receipts
        WHERE job_id IN (${batch.map(() => '?').join(', ')}) AND episode_id IS NOT NULL`,
      ...batch,
    )) {
      ids.add(row.episode_id);
    }
  }
  for (let offset = 0; offset < retiredFactIds.length; offset += BATCH_SIZE) {
    const batch = retiredFactIds.slice(offset, offset + BATCH_SIZE);
    let cursor = '';
    for (;;) {
      const rows = db.getAllSync<{ episode_id: string }>(
        `SELECT DISTINCT episode_id FROM memory_fact_evidence
          WHERE fact_id IN (${batch.map(() => '?').join(', ')})
            AND episode_id IS NOT NULL AND episode_id > ?
          ORDER BY episode_id ASC LIMIT ${BATCH_SIZE}`,
        ...batch,
        cursor,
      );
      if (rows.length === 0) break;
      for (const row of rows) ids.add(row.episode_id);
      cursor = rows[rows.length - 1]!.episode_id;
    }
  }
  const sourcesByScope = new Map<string, PersistedExactMemorySourceIdentity[]>();
  for (const source of input.closedSources) {
    const sources = sourcesByScope.get(sourceScopeKey(source)) ?? [];
    sources.push(source);
    sourcesByScope.set(sourceScopeKey(source), sources);
  }
  for (const sources of sourcesByScope.values()) {
    const scope = sources[0]!;
    let cursor = '';
    for (;;) {
      const candidates = db.getAllSync<EpisodeCandidateRow>(
        `SELECT episode.id, episode.conversation_id, episode.thread_id, episode.task_id,
                episode.source_start_message_id, episode.source_end_message_id,
                episode.message_ids_json
           FROM memory_episodes AS episode
           JOIN memory_episode_access_policies AS policy ON policy.episode_id = episode.id
          WHERE policy.memory_owner_id = ? AND policy.memory_conversation_id = ?
            AND policy.source_thread_id = ? AND COALESCE(policy.task_id, '') = ?
            AND episode.id > ?
          ORDER BY episode.id ASC LIMIT ${BATCH_SIZE}`,
        scope.memoryOwnerId,
        scope.memoryConversationId,
        scope.sourceThreadId,
        scope.taskId,
        cursor,
      );
      if (candidates.length === 0) break;
      for (const episode of candidates) {
        const messageIds = new Set(parseIds(episode.message_ids_json));
        if (
          sources.some((source) =>
            source.sourceKind === 'turn'
              ? episode.source_end_message_id === source.sourceId
              : source.sourceKind === 'message'
                ? episode.source_start_message_id === source.sourceId ||
                  messageIds.has(source.sourceId)
                : false,
          )
        ) {
          ids.add(episode.id);
        }
      }
      cursor = candidates[candidates.length - 1]!.id;
    }
  }
  return Array.from(ids).sort();
}

function cleanupFactObservations(
  db: MemoryDatabase,
  retiredFactIds: ReadonlyArray<string>,
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
  now: number,
): void {
  const affectedFactIds = new Set<string>();
  for (let offset = 0; offset < retiredFactIds.length; offset += BATCH_SIZE) {
    const batch = retiredFactIds.slice(offset, offset + BATCH_SIZE);
    for (const row of db.getAllSync<{ fact_id: string }>(
      `SELECT DISTINCT fact_id FROM memory_fact_observations
        WHERE fact_id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    )) {
      affectedFactIds.add(row.fact_id);
    }
    db.runSync(
      `DELETE FROM memory_fact_observations
        WHERE fact_id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    );
  }
  for (const source of sources) {
    const sourceKind =
      source.sourceKind === 'message'
        ? 'user_message'
        : source.sourceKind === 'run'
          ? 'tool_run'
          : null;
    if (!sourceKind) continue;
    let cursor = '';
    for (;;) {
      const rows = db.getAllSync<{ fact_id: string }>(
        `SELECT DISTINCT fact_id FROM memory_fact_observations
          WHERE source_conversation_id = ? AND source_thread_id = ?
            AND COALESCE(source_task_id, '') = ? AND source_kind = ? AND source_id = ?
            AND fact_id > ?
          ORDER BY fact_id ASC LIMIT ${BATCH_SIZE}`,
        source.memoryConversationId,
        source.sourceThreadId,
        source.taskId,
        sourceKind,
        source.sourceId,
        cursor,
      );
      if (rows.length === 0) break;
      for (const row of rows) affectedFactIds.add(row.fact_id);
      cursor = rows[rows.length - 1]!.fact_id;
    }
    db.runSync(
      `DELETE FROM memory_fact_observations
        WHERE source_conversation_id = ? AND source_thread_id = ?
          AND COALESCE(source_task_id, '') = ? AND source_kind = ? AND source_id = ?`,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      sourceKind,
      source.sourceId,
    );
  }
  for (const factId of affectedFactIds) {
    db.runSync(
      `UPDATE memory_facts
          SET last_conflicted_at = (
                SELECT MAX(observed_at) FROM memory_fact_observations
                 WHERE fact_id = memory_facts.id AND relation = 'conflicts'
              ),
              last_confirmed_at = (
                SELECT MAX(observed_at) FROM memory_fact_observations
                 WHERE fact_id = memory_facts.id AND relation = 'supports'
              ),
              updated_at = MAX(updated_at, ?)
        WHERE id = ? AND deleted_at IS NULL`,
      now,
      factId,
    );
  }
}

function assertNoResiduals(
  db: MemoryDatabase,
  input: {
    jobIds: ReadonlyArray<string>;
    episodeIds: ReadonlyArray<string>;
    retiredFactIds: ReadonlyArray<string>;
    retiredContributionIds: ReadonlyArray<string>;
  },
): void {
  const checks: Array<[string, string, ReadonlyArray<string>]> = [
    ['memory_ingestion_jobs', 'id', input.jobIds],
    ['memory_ingestion_source_snapshots', 'job_id', input.jobIds],
    ['memory_ingestion_job_sources', 'job_id', input.jobIds],
    ['memory_ingestion_receipts', 'job_id', input.jobIds],
    ['memory_episodes', 'id', input.episodeIds],
    ['memory_episode_access_policies', 'episode_id', input.episodeIds],
    ['memory_episode_terms', 'episode_id', input.episodeIds],
    ['memory_facts', 'id', input.retiredFactIds],
    ['memory_fact_contributions', 'id', input.retiredContributionIds],
  ];
  if (checks.some(([table, column, ids]) => countIds(db, table, column, ids) !== 0)) {
    return fail('memory_source_lifecycle_derived_residual');
  }
}

/** Remove exact derived plaintext, then purge causal parents while immutable fences remain. */
export function cleanupSourceLifecycleArtifactsInTransaction(
  db: MemoryDatabase,
  input: Readonly<SourceLifecycleArtifactCleanupInput>,
): Readonly<SourceLifecycleArtifactCleanupReceipt> {
  assertMemoryTransactionActive('memory_source_lifecycle_cleanup_transaction_required');
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    return fail('memory_source_lifecycle_cleanup_timestamp_invalid');
  }
  const ownerId = getLocalMemoryVaultOwnerId(db);
  if (input.closedSources.some((source) => source.memoryOwnerId !== ownerId)) {
    return fail('memory_source_lifecycle_cleanup_owner_invalid');
  }
  if (
    !Array.isArray(input.conversationScopes) ||
    input.conversationScopes.some(
      (scope) =>
        typeof scope.memoryConversationId !== 'string' ||
        scope.memoryConversationId.length < 1 ||
        typeof scope.sourceThreadId !== 'string' ||
        scope.sourceThreadId.length < 1,
    )
  ) {
    return fail('memory_source_lifecycle_conversation_scopes_invalid');
  }
  const conversationScopeKeys = input.conversationScopes.map((scope) =>
    JSON.stringify([scope.memoryConversationId, scope.sourceThreadId]),
  );
  conversationScopeKeys.sort();
  if (
    conversationScopeKeys.some(
      (scopeKey, index) => index > 0 && scopeKey === conversationScopeKeys[index - 1],
    )
  ) {
    return fail('memory_source_lifecycle_conversation_scopes_invalid');
  }
  const retiredFactIds = requireUniqueIds(
    input.retiredFactIds,
    'memory_source_lifecycle_fact_ids_invalid',
  );
  const retiredContributionIds = requireUniqueIds(
    input.retiredContributionIds,
    'memory_source_lifecycle_contribution_ids_invalid',
  );
  const jobIds = collectJobIds(db, input);
  const episodeIds = collectEpisodeIds(db, input, jobIds, retiredFactIds);
  const broadThreadIds = new Set(
    input.mode === 'conversation_delete'
      ? [
          ...input.conversationScopes.map((scope) => scope.sourceThreadId),
          ...input.closedSources.map((source) => source.sourceThreadId),
        ]
      : [],
  );
  const factIdSet = new Set(retiredFactIds);
  const episodeIdSet = new Set(episodeIds);
  const entityIds = new Set<string>();
  for (let offset = 0; offset < retiredFactIds.length; offset += BATCH_SIZE) {
    const batch = retiredFactIds.slice(offset, offset + BATCH_SIZE);
    for (const row of db.getAllSync<{ subject_id: string; object_entity_id: string | null }>(
      `SELECT subject_id, object_entity_id FROM memory_facts
        WHERE id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    )) {
      entityIds.add(row.subject_id);
      if (row.object_entity_id) entityIds.add(row.object_entity_id);
    }
  }

  cleanupFactObservations(db, retiredFactIds, input.closedSources, input.now);
  for (let offset = 0; offset < retiredFactIds.length; offset += BATCH_SIZE) {
    const batch = retiredFactIds.slice(offset, offset + BATCH_SIZE);
    db.runSync(
      `DELETE FROM memory_fact_evidence
        WHERE fact_id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    );
  }
  for (let offset = 0; offset < episodeIds.length; offset += BATCH_SIZE) {
    const batch = episodeIds.slice(offset, offset + BATCH_SIZE);
    db.runSync(
      `DELETE FROM memory_fact_evidence
        WHERE episode_id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    );
  }
  const derived = cleanupSourceLifecycleDerivedArtifactsInTransaction(db, {
    memoryOwnerId: ownerId,
    broadThreadIds,
    retiredFactIds: factIdSet,
    episodeIds: episodeIdSet,
    closedSources: input.closedSources,
    now: input.now,
  });
  deleteIds(db, 'memory_episode_access_policies', 'episode_id', episodeIds);
  const episodes = deleteIds(db, 'memory_episodes', 'id', episodeIds);
  for (const scope of input.conversationScopes) {
    db.runSync(
      `DELETE FROM memory_working_blocks
        WHERE COALESCE(conversation_id, '') = ? AND COALESCE(thread_id, '') = ?`,
      scope.memoryConversationId,
      scope.sourceThreadId,
    );
    db.runSync('DELETE FROM memory_tasks WHERE thread_id = ?', scope.sourceThreadId);
    db.runSync(
      'DELETE FROM memory_migration_state WHERE conversation_id = ?',
      scope.sourceThreadId,
    );
    if (input.mode === 'conversation_delete') {
      db.runSync(
        'DELETE FROM memory_consolidation_state WHERE thread_id = ?',
        scope.sourceThreadId,
      );
    }
  }
  const affectedScopes = new Map<string, PersistedExactMemorySourceIdentity>();
  for (const source of input.closedSources) affectedScopes.set(sourceScopeKey(source), source);
  for (const source of affectedScopes.values()) {
    db.runSync(
      `DELETE FROM memory_working_blocks
        WHERE COALESCE(conversation_id, '') = ? AND COALESCE(thread_id, '') = ?
          AND COALESCE(task_id, '') = ?`,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
    );
    if (input.mode === 'conversation_delete') {
      db.runSync(
        'DELETE FROM memory_consolidation_state WHERE thread_id = ?',
        source.sourceThreadId,
      );
    } else {
      db.runSync(
        `UPDATE memory_consolidation_state
            SET turns_since_last = 0, updated_at = MAX(updated_at, ?)
          WHERE thread_id = ?`,
        input.now,
        source.sourceThreadId,
      );
    }
  }
  deleteIds(db, 'memory_ingestion_receipts', 'job_id', jobIds);
  const ingestionJobs = deleteIds(db, 'memory_ingestion_jobs', 'id', jobIds);
  const causal = purgeRetiredCausalPayloadsInTransaction(db, {
    retiredContributionIds,
    retiredFactIds,
  });
  for (const entityId of entityIds) {
    const activeReference = db.getFirstSync<{ present: number }>(
      `SELECT 1 AS present FROM memory_facts
        WHERE deleted_at IS NULL AND (subject_id = ? OR object_entity_id = ?) LIMIT 1`,
      entityId,
      entityId,
    );
    if (!activeReference) db.runSync('DELETE FROM memory_entities WHERE id = ?', entityId);
  }
  assertNoResiduals(db, {
    jobIds,
    episodeIds,
    retiredFactIds,
    retiredContributionIds,
  });
  return Object.freeze({
    ingestionJobs,
    episodes,
    reflections: derived.reflections,
    retrievalEvents: derived.retrievalEvents,
    contributionPayloads: causal.contributionPayloads,
    factPayloads: causal.factPayloads,
  });
}
