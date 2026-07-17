import type { Message } from '../../types/message';
import {
  isEligibleMessageMemoryPublicationSource,
  normalizeMessageMemoryPublication,
} from '../../utils/messageMemoryPublication';
import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { checkpointMemoryDatabaseAfterSensitiveDeletion } from './database';
import {
  persistExactMemorySourceIdentity,
  requireExactMemorySourceIdentity,
  type PersistedExactMemorySourceIdentity,
} from './exactMemorySourceIdentity';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { advanceRestrictiveMemoryAuthorityInTransaction } from './memoryAuthority';
import {
  loadExistingSourceRetirementFencesInTransaction,
  loadVerifiedSourceRetirementOperationInTransaction,
} from './sourceRetirementStore';
import { retireExactMemorySources } from './sourceRetirementCoordinator';
import { MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS } from './sourceRetirementChildCommitments';
import { cleanupSourceLifecycleArtifactsInTransaction } from './sourceLifecycleArtifactCleanup';

const KNOWN_SOURCE_PAGE_SIZE = MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources;
const PUBLICATION_PROOF_ID_PAGE_SIZE = 128;

interface ExactSourceRow {
  memory_owner_id: unknown;
  memory_conversation_id: unknown;
  source_thread_id: unknown;
  task_id: unknown;
  source_kind: unknown;
  source_id: unknown;
}

export interface ConversationDeletionTarget {
  conversationId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  messages: ReadonlyArray<Message>;
}

export interface ConversationPublicationWithdrawal {
  conversationId: string;
  sourceEndMessageId: string;
}

export type ConversationDeletionRetirementResult = Readonly<{
  status: 'not_required' | 'retired';
  retiredSourceCount: number;
  publicationWithdrawals: ReadonlyArray<Readonly<ConversationPublicationWithdrawal>>;
}>;

interface ValidatedConversationDeletionTarget {
  conversationId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  publishedSourceIds: ReadonlyArray<string>;
  publicationWithdrawals: ReadonlyArray<Readonly<ConversationPublicationWithdrawal>>;
}

function fail(code: string): never {
  throw new Error(code);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
    return fail('conversation_delete_memory_source_identity_invalid');
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
    return fail('conversation_delete_memory_source_owner_invalid');
  }
  return source;
}

function validateTarget(input: ConversationDeletionTarget): ValidatedConversationDeletionTarget {
  const conversationId = requireExactMemoryScopeId(
    input.conversationId,
    'conversation_delete_memory_conversation_identity_invalid',
  );
  const memoryConversationId = requireExactMemoryScopeId(
    input.memoryConversationId,
    'conversation_delete_memory_workspace_identity_invalid',
  );
  const sourceThreadId = requireExactMemoryScopeId(
    input.sourceThreadId,
    'conversation_delete_memory_thread_identity_invalid',
  );
  if (sourceThreadId !== conversationId) {
    return fail('conversation_delete_memory_thread_identity_invalid');
  }
  if (!Array.isArray(input.messages)) {
    return fail('conversation_delete_memory_messages_invalid');
  }
  const receiptSourceIds = new Set<string>();
  const publishedSourceIds: string[] = [];
  const publicationWithdrawals: ConversationPublicationWithdrawal[] = [];
  for (const message of input.messages) {
    if (message.memoryPublication === undefined) continue;
    const publication = normalizeMessageMemoryPublication(message.memoryPublication);
    if (!publication || !isEligibleMessageMemoryPublicationSource(message)) {
      return fail('conversation_delete_memory_publication_invalid');
    }
    const sourceEndMessageId = requireExactMemoryProvenanceId(
      message.id,
      'conversation_delete_memory_publication_source_invalid',
    );
    if (receiptSourceIds.has(sourceEndMessageId)) {
      return fail('conversation_delete_memory_publication_source_invalid');
    }
    receiptSourceIds.add(sourceEndMessageId);
    if (publication.disposition === 'enqueued' || publication.disposition === 'withdrawn') {
      publishedSourceIds.push(sourceEndMessageId);
    }
    if (publication.disposition === null || publication.disposition === 'enqueued') {
      publicationWithdrawals.push({ conversationId, sourceEndMessageId });
    }
  }
  return {
    conversationId,
    memoryConversationId,
    sourceThreadId,
    publishedSourceIds: Object.freeze(publishedSourceIds.sort(compareOrdinal)),
    publicationWithdrawals: Object.freeze(publicationWithdrawals),
  };
}

function loadUnfencedKnownSourcePage(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  sourceThreadId: string;
  memoryConversationId: string;
}): ReadonlyArray<PersistedExactMemorySourceIdentity> {
  const rows = input.db.getAllSync<ExactSourceRow>(
    `WITH known_source AS (
       SELECT memory_owner_id, memory_conversation_id, source_thread_id,
              task_id, source_kind, source_id
         FROM memory_ingestion_job_sources
        WHERE memory_owner_id = ? AND memory_conversation_id = ? AND source_thread_id = ?
       UNION
       SELECT memory_owner_id, memory_conversation_id, source_thread_id,
              task_id, source_kind, source_id
         FROM memory_fact_contribution_sources
        WHERE memory_owner_id = ? AND memory_conversation_id = ? AND source_thread_id = ?
     )
     SELECT known.memory_owner_id, known.memory_conversation_id, known.source_thread_id,
            known.task_id, known.source_kind, known.source_id
       FROM known_source AS known
       LEFT JOIN memory_retired_sources AS retired
         ON retired.memory_owner_id = known.memory_owner_id
        AND retired.memory_conversation_id = known.memory_conversation_id
        AND retired.source_thread_id = known.source_thread_id
        AND retired.task_id = known.task_id
        AND retired.source_kind = known.source_kind
        AND retired.source_id = known.source_id
      WHERE retired.retirement_group_id IS NULL
      ORDER BY known.memory_conversation_id ASC, known.task_id ASC,
               known.source_kind ASC, known.source_id ASC
      LIMIT ${KNOWN_SOURCE_PAGE_SIZE}`,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
  );
  const sources = rows.map((row) => decodeSourceRow(row, input.memoryOwnerId));
  const keys = new Set(sources.map(sourceKey));
  if (keys.size !== sources.length) {
    return fail('conversation_delete_memory_source_identity_invalid');
  }
  return Object.freeze(sources);
}

function safeRetirementTimestamp(
  db: MemoryDatabase,
  memoryOwnerId: string,
  requestedAt: number,
): number {
  if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
    return fail('conversation_delete_memory_retirement_timestamp_invalid');
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
    return fail('conversation_delete_memory_retirement_clock_invalid');
  }
  return Math.max(requestedAt, typeof latest === 'number' ? latest : 0);
}

function loadRetiredTurnSources(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  sourceThreadId: string;
  memoryConversationId: string;
  sourceIds: ReadonlyArray<string>;
}): ReadonlyArray<PersistedExactMemorySourceIdentity> {
  const rows: ExactSourceRow[] = [];
  for (let offset = 0; offset < input.sourceIds.length; offset += PUBLICATION_PROOF_ID_PAGE_SIZE) {
    const sourceIds = input.sourceIds.slice(offset, offset + PUBLICATION_PROOF_ID_PAGE_SIZE);
    rows.push(
      ...input.db.getAllSync<ExactSourceRow>(
        `SELECT memory_owner_id, memory_conversation_id, source_thread_id,
                task_id, source_kind, source_id
           FROM memory_retired_sources
          WHERE memory_owner_id = ? AND memory_conversation_id = ? AND source_thread_id = ?
            AND source_kind = 'turn'
            AND source_id IN (${sourceIds.map(() => '?').join(', ')})
          ORDER BY memory_conversation_id ASC, task_id ASC, source_id ASC`,
        input.memoryOwnerId,
        input.memoryConversationId,
        input.sourceThreadId,
        ...sourceIds,
      ),
    );
  }
  const sources = rows.map((row) => decodeSourceRow(row, input.memoryOwnerId));
  for (let offset = 0; offset < sources.length; offset += KNOWN_SOURCE_PAGE_SIZE) {
    const page = sources.slice(offset, offset + KNOWN_SOURCE_PAGE_SIZE);
    const fences = loadExistingSourceRetirementFencesInTransaction(input.db, page);
    if (fences.length !== page.length) {
      return fail('conversation_delete_memory_publication_fence_invalid');
    }
  }
  return sources;
}

function assertPublishedSourcesFenced(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  target: ValidatedConversationDeletionTarget;
}): void {
  if (input.target.publishedSourceIds.length === 0) return;
  const sources = loadRetiredTurnSources({
    db: input.db,
    memoryOwnerId: input.memoryOwnerId,
    sourceThreadId: input.target.conversationId,
    memoryConversationId: input.target.memoryConversationId,
    sourceIds: input.target.publishedSourceIds,
  });
  const fencedSourceIds = new Set(sources.map((source) => source.sourceId));
  if (input.target.publishedSourceIds.some((sourceId) => !fencedSourceIds.has(sourceId))) {
    return fail('conversation_delete_memory_publication_fence_unavailable');
  }
}

/**
 * Fence every exact source owned by conversations before their chat records become unreachable.
 * Chat persistence is a separate store, so callers must apply returned receipt transitions and
 * remove chat state only after this function commits. A retry is safe because fences are monotonic.
 */
export function retireConversationSourcesBeforeDeletion(input: {
  targets: ReadonlyArray<Readonly<ConversationDeletionTarget>>;
  now?: number;
}): ConversationDeletionRetirementResult {
  if (!Array.isArray(input.targets)) {
    return fail('conversation_delete_memory_targets_invalid');
  }
  const targets = input.targets
    .map(validateTarget)
    .sort((left, right) => compareOrdinal(left.conversationId, right.conversationId));
  if (new Set(targets.map((target) => target.conversationId)).size !== targets.length) {
    return fail('conversation_delete_memory_conversation_identity_invalid');
  }
  const publicationWithdrawals = Object.freeze(
    targets.flatMap((target) => target.publicationWithdrawals),
  );
  if (targets.length === 0) {
    return { status: 'not_required', retiredSourceCount: 0, publicationWithdrawals };
  }

  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const requestedAt = input.now ?? Date.now();
  let retiredSourceCount = 0;
  runMemoryTransaction(() => {
    const retiredAt = safeRetirementTimestamp(db, memoryOwnerId, requestedAt);
    const retiredContributionIds = new Set<string>();
    const retiredFactIds = new Set<string>();
    const closedSources = new Map<string, PersistedExactMemorySourceIdentity>();
    for (const target of targets) {
      for (;;) {
        const requestedSources = loadUnfencedKnownSourcePage({
          db,
          memoryOwnerId,
          sourceThreadId: target.conversationId,
          memoryConversationId: target.memoryConversationId,
        });
        if (requestedSources.length === 0) break;
        const result = retireExactMemorySources({
          reason: 'conversation_delete',
          requestedSources,
          retiredAt,
        });
        if (result.status !== 'retired' || result.closedSourceCount < requestedSources.length) {
          return fail('conversation_delete_memory_source_retirement_no_progress');
        }
        const operation = loadVerifiedSourceRetirementOperationInTransaction(
          db,
          result.retirementGroupId,
        );
        if (!operation) return fail('conversation_delete_memory_retirement_operation_invalid');
        for (const id of operation.retiredContributionIds) retiredContributionIds.add(id);
        for (const id of operation.retiredFactIds) retiredFactIds.add(id);
        for (const source of operation.closedSources) closedSources.set(sourceKey(source), source);
        retiredSourceCount += requestedSources.length;
      }
      if (
        loadUnfencedKnownSourcePage({
          db,
          memoryOwnerId,
          sourceThreadId: target.conversationId,
          memoryConversationId: target.memoryConversationId,
        }).length !== 0
      ) {
        return fail('conversation_delete_memory_source_residual');
      }
      assertPublishedSourcesFenced({ db, memoryOwnerId, target });
    }
    cleanupSourceLifecycleArtifactsInTransaction(db, {
      mode: 'conversation_delete',
      conversationScopes: targets.map((target) => ({
        memoryConversationId: target.memoryConversationId,
        sourceThreadId: target.sourceThreadId,
      })),
      ingestionJobIds: [],
      retiredContributionIds: Array.from(retiredContributionIds).sort(compareOrdinal),
      retiredFactIds: Array.from(retiredFactIds).sort(compareOrdinal),
      closedSources: Array.from(closedSources.values()),
      now: retiredAt,
    });
    advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);
    runAfterMemoryTransactionCommit(checkpointMemoryDatabaseAfterSensitiveDeletion);
  });

  return Object.freeze({
    status:
      retiredSourceCount > 0 || publicationWithdrawals.length > 0 ? 'retired' : 'not_required',
    retiredSourceCount,
    publicationWithdrawals,
  });
}
