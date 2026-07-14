import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { checkpointMemoryDatabaseAfterSensitiveDeletion } from './database';
import {
  persistExactMemorySourceIdentity,
  requireExactMemorySourceIdentity,
  type PersistedExactMemorySourceIdentity,
} from './exactMemorySourceIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import {
  loadExistingSourceRetirementFencesInTransaction,
  loadVerifiedSourceRetirementOperationInTransaction,
} from './sourceRetirementStore';
import { retireExactMemorySources } from './sourceRetirementCoordinator';
import { MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS } from './sourceRetirementChildCommitments';
import { cleanupSourceLifecycleArtifactsInTransaction } from './sourceLifecycleArtifactCleanup';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';

const ACTIVE_PUBLICATION_SOURCE_PAGE_SIZE =
  MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources;
const ACTIVE_PUBLICATION_JOB_PAGE_SIZE = 128;

interface ExactSourceRow {
  memory_owner_id: unknown;
  memory_conversation_id: unknown;
  source_thread_id: unknown;
  task_id: unknown;
  source_kind: unknown;
  source_id: unknown;
}

interface ActivePublicationSourceRow extends ExactSourceRow {
  job_id: unknown;
}

interface ActivePublicationJobRow {
  id: string;
  threadId: string;
  sourceEndMessageId: string;
}

export type MemoryOptOutRetirementResult = Readonly<{
  status: 'not_required' | 'retired';
  retiredSourceCount: number;
  publicationWithdrawals: ReadonlyArray<
    Readonly<{ sourceThreadId: string; sourceEndMessageId: string }>
  >;
}>;

function fail(code: string): never {
  throw new Error(code);
}

function sourceKey(source: PersistedExactMemorySourceIdentity): string {
  return JSON.stringify([
    source.memoryOwnerId,
    source.memoryConversationId,
    source.sourceThreadId,
    source.taskId,
    source.sourceKind,
    source.sourceId,
  ]);
}

function decodeSourceRow(
  row: ExactSourceRow,
  expectedOwnerId: string,
): PersistedExactMemorySourceIdentity {
  if (
    typeof row.memory_owner_id !== 'string' ||
    typeof row.memory_conversation_id !== 'string' ||
    typeof row.source_thread_id !== 'string' ||
    typeof row.task_id !== 'string' ||
    typeof row.source_kind !== 'string' ||
    typeof row.source_id !== 'string'
  ) {
    return fail('memory_opt_out_source_identity_invalid');
  }
  const source = persistExactMemorySourceIdentity(
    requireExactMemorySourceIdentity({
      memoryOwnerId: row.memory_owner_id,
      memoryConversationId: row.memory_conversation_id,
      sourceThreadId: row.source_thread_id,
      taskId: row.task_id === '' ? null : row.task_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
    }),
  );
  if (source.memoryOwnerId !== expectedOwnerId) {
    return fail('memory_opt_out_source_owner_invalid');
  }
  return source;
}

function loadUnfencedActivePublicationSourcePage(
  db: MemoryDatabase,
  memoryOwnerId: string,
): ReadonlyArray<PersistedExactMemorySourceIdentity> {
  const rows = db.getAllSync<ExactSourceRow>(
    `SELECT DISTINCT
            source.memory_owner_id, source.memory_conversation_id,
            source.source_thread_id, source.task_id,
            source.source_kind, source.source_id
       FROM memory_ingestion_job_sources AS source
       JOIN memory_ingestion_jobs AS job ON job.id = source.job_id
       LEFT JOIN memory_retired_sources AS retired
         ON retired.memory_owner_id = source.memory_owner_id
        AND retired.memory_conversation_id = source.memory_conversation_id
        AND retired.source_thread_id = source.source_thread_id
        AND retired.task_id = source.task_id
        AND retired.source_kind = source.source_kind
        AND retired.source_id = source.source_id
      WHERE source.memory_owner_id = ?
        AND job.status IN ('pending', 'processing', 'retrying')
        AND retired.retirement_group_id IS NULL
      ORDER BY source.memory_conversation_id ASC, source.source_thread_id ASC,
               source.task_id ASC, source.source_kind ASC, source.source_id ASC
      LIMIT ${ACTIVE_PUBLICATION_SOURCE_PAGE_SIZE}`,
    memoryOwnerId,
  );
  const sources = rows.map((row) => decodeSourceRow(row, memoryOwnerId));
  if (new Set(sources.map(sourceKey)).size !== sources.length) {
    return fail('memory_opt_out_source_identity_invalid');
  }
  return Object.freeze(sources);
}

function loadVerifiedActivePublicationWithdrawals(
  db: MemoryDatabase,
  memoryOwnerId: string,
  activeJobs: ReadonlyArray<Readonly<ActivePublicationJobRow>>,
): MemoryOptOutRetirementResult['publicationWithdrawals'] {
  const withdrawals = new Map<
    string,
    Readonly<{ sourceThreadId: string; sourceEndMessageId: string }>
  >();
  for (let offset = 0; offset < activeJobs.length; offset += ACTIVE_PUBLICATION_JOB_PAGE_SIZE) {
    const jobPage = activeJobs.slice(offset, offset + ACTIVE_PUBLICATION_JOB_PAGE_SIZE);
    const jobsById = new Map(jobPage.map((job) => [job.id, job]));
    const rows = db.getAllSync<ActivePublicationSourceRow>(
      `SELECT DISTINCT
              source.job_id, source.memory_owner_id, source.memory_conversation_id,
              source.source_thread_id, source.task_id,
              source.source_kind, source.source_id
         FROM memory_ingestion_job_sources AS source
         JOIN memory_retired_sources AS retired
           ON retired.memory_owner_id = source.memory_owner_id
          AND retired.memory_conversation_id = source.memory_conversation_id
          AND retired.source_thread_id = source.source_thread_id
          AND retired.task_id = source.task_id
          AND retired.source_kind = source.source_kind
          AND retired.source_id = source.source_id
        WHERE source.memory_owner_id = ? AND source.source_kind = 'turn'
          AND source.job_id IN (${jobPage.map(() => '?').join(', ')})
        ORDER BY source.job_id ASC, source.memory_conversation_id ASC,
                 source.source_thread_id ASC, source.task_id ASC, source.source_id ASC
        LIMIT ${jobPage.length + 1}`,
      memoryOwnerId,
      ...jobPage.map((job) => job.id),
    );
    if (rows.length > jobPage.length) {
      return fail('memory_opt_out_publication_fence_invalid');
    }
    const sources = rows.map((row) => decodeSourceRow(row, memoryOwnerId));
    if (loadExistingSourceRetirementFencesInTransaction(db, sources).length !== sources.length) {
      return fail('memory_opt_out_publication_fence_invalid');
    }
    const fencedJobIds = new Set<string>();
    for (const [index, source] of sources.entries()) {
      const jobId = rows[index]!.job_id;
      if (typeof jobId !== 'string' || fencedJobIds.has(jobId)) {
        return fail('memory_opt_out_publication_fence_invalid');
      }
      const job = jobsById.get(jobId);
      if (
        !job ||
        source.sourceThreadId !== job.threadId ||
        source.sourceId !== job.sourceEndMessageId
      ) {
        return fail('memory_opt_out_publication_fence_invalid');
      }
      fencedJobIds.add(jobId);
      const key = JSON.stringify([job.threadId, job.sourceEndMessageId]);
      withdrawals.set(key, {
        sourceThreadId: job.threadId,
        sourceEndMessageId: job.sourceEndMessageId,
      });
    }
    if (jobPage.some((job) => !fencedJobIds.has(job.id))) {
      return fail('memory_opt_out_publication_fence_unavailable');
    }
  }
  return Object.freeze(Array.from(withdrawals.values()));
}

function loadActivePublicationJobs(db: MemoryDatabase): ActivePublicationJobRow[] {
  const jobs: ActivePublicationJobRow[] = [];
  let cursor = '';
  for (;;) {
    const rows = db.getAllSync<{
      id: unknown;
      thread_id: unknown;
      source_end_message_id: unknown;
    }>(
      `SELECT id, thread_id, source_end_message_id
         FROM memory_ingestion_jobs
        WHERE status IN ('pending', 'processing', 'retrying') AND id > ?
        ORDER BY id ASC LIMIT ${ACTIVE_PUBLICATION_JOB_PAGE_SIZE}`,
      cursor,
    );
    if (rows.length === 0) return jobs;
    for (const row of rows) {
      jobs.push({
        id: requireExactMemoryScopeId(row.id, 'memory_opt_out_publication_job_identity_invalid'),
        threadId: requireExactMemoryScopeId(
          row.thread_id,
          'memory_opt_out_publication_thread_identity_invalid',
        ),
        sourceEndMessageId: requireExactMemoryProvenanceId(
          row.source_end_message_id,
          'memory_opt_out_publication_source_identity_invalid',
        ),
      });
    }
    cursor = jobs[jobs.length - 1]!.id;
  }
}

function safeRetirementTimestamp(
  db: MemoryDatabase,
  memoryOwnerId: string,
  requestedAt: number,
): number {
  if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
    return fail('memory_opt_out_retirement_timestamp_invalid');
  }
  const latest = db.getFirstSync<{ latest: unknown }>(
    `SELECT MAX(contribution.contributed_at) AS latest
       FROM memory_fact_contributions AS contribution
       LEFT JOIN memory_retired_fact_contributions AS retired
         ON retired.contribution_id = contribution.id
      WHERE contribution.memory_owner_id = ?
        AND retired.contribution_id IS NULL`,
    memoryOwnerId,
  )?.latest;
  if (latest !== null && latest !== undefined && !Number.isSafeInteger(latest)) {
    return fail('memory_opt_out_retirement_clock_invalid');
  }
  return Math.max(requestedAt, typeof latest === 'number' ? latest : 0);
}

/**
 * Fence only unfinished publication work before the reversible memory policy flips off.
 * Completed memory is intentionally preserved for a later re-enable; destructive erasure is a
 * separate explicit command. The policy edge subsequently cancels and discards these jobs.
 */
export function retireActiveMemoryPublicationsBeforeOptOut(
  input: {
    now?: number;
  } = {},
): MemoryOptOutRetirementResult {
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const requestedAt = input.now ?? Date.now();
  let retiredSourceCount = 0;
  let publicationWithdrawals: MemoryOptOutRetirementResult['publicationWithdrawals'] = [];
  runMemoryTransaction(() => {
    const retiredAt = safeRetirementTimestamp(db, memoryOwnerId, requestedAt);
    const activeJobs = loadActivePublicationJobs(db);
    const retiredContributionIds = new Set<string>();
    const retiredFactIds = new Set<string>();
    const closedSources = new Map<string, PersistedExactMemorySourceIdentity>();
    for (;;) {
      const requestedSources = loadUnfencedActivePublicationSourcePage(db, memoryOwnerId);
      if (requestedSources.length === 0) break;
      const result = retireExactMemorySources({
        reason: 'memory_opt_out',
        requestedSources,
        retiredAt,
      });
      if (result.status !== 'retired' || result.closedSourceCount < requestedSources.length) {
        return fail('memory_opt_out_source_retirement_no_progress');
      }
      const operation = loadVerifiedSourceRetirementOperationInTransaction(
        db,
        result.retirementGroupId,
      );
      if (!operation) return fail('memory_opt_out_retirement_operation_invalid');
      for (const id of operation.retiredContributionIds) retiredContributionIds.add(id);
      for (const id of operation.retiredFactIds) retiredFactIds.add(id);
      for (const source of operation.closedSources) closedSources.set(sourceKey(source), source);
      retiredSourceCount += requestedSources.length;
    }
    if (loadUnfencedActivePublicationSourcePage(db, memoryOwnerId).length !== 0) {
      return fail('memory_opt_out_source_residual');
    }
    publicationWithdrawals = loadVerifiedActivePublicationWithdrawals(
      db,
      memoryOwnerId,
      activeJobs,
    );
    cleanupSourceLifecycleArtifactsInTransaction(db, {
      mode: 'memory_opt_out',
      conversationScopes: [],
      ingestionJobIds: activeJobs.map((job) => job.id),
      retiredContributionIds: Array.from(retiredContributionIds).sort(),
      retiredFactIds: Array.from(retiredFactIds).sort(),
      closedSources: Array.from(closedSources.values()),
      now: retiredAt,
    });
    runAfterMemoryTransactionCommit(checkpointMemoryDatabaseAfterSensitiveDeletion);
  });
  return Object.freeze({
    status: retiredSourceCount > 0 ? 'retired' : 'not_required',
    retiredSourceCount,
    publicationWithdrawals,
  });
}
