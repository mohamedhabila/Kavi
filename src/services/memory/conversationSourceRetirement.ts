import { resolveConversationWorkspaceTarget } from '../conversationWorkspace/ownership';
import { useChatStore } from '../../store/useChatStore';
import { resolveRewindUserMessageEligibility } from '../../store/chatStoreUserMessageRewind';
import type { Message } from '../../types/message';
import {
  isEligibleMessageMemoryPublicationSource,
  normalizeMessageMemoryPublication,
} from '../../utils/messageMemoryPublication';
import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { runMemoryTransaction } from './access/transaction';
import {
  persistExactMemorySourceIdentity,
  requireExactMemorySourceIdentity,
  type PersistedExactMemorySourceIdentity,
} from './exactMemorySourceIdentity';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { retireExactMemorySources } from './sourceRetirementCoordinator';
import { MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS } from './sourceRetirementChildCommitments';
import { loadCompleteActiveRetirementGraphInTransaction } from './sourceRetirementActiveGraph';
import { planExactSourceRetirement } from './sourceRetirementPlanner';

export type ConversationRewindRetirementReason = 'message_edit' | 'message_retry';

export type ConversationSourceRetirementResult = Readonly<{
  status: 'not_required' | 'retired';
  retiredSourceCount: number;
}>;

interface ExactTurnSourceRow {
  memory_owner_id: unknown;
  memory_conversation_id: unknown;
  source_thread_id: unknown;
  task_id: unknown;
  source_id: unknown;
}

const SOURCE_ID_LOOKUP_PAGE_SIZE = 128;

function fail(code: string): never {
  throw new Error(code);
}

function collectEnqueuedTurnSourceIds(messages: readonly Message[]): readonly string[] {
  const sourceIds: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.memoryPublication === undefined) continue;
    const publication = normalizeMessageMemoryPublication(message.memoryPublication);
    if (!publication) fail('conversation_rewind_memory_publication_invalid');
    if (publication.disposition === null) {
      fail('conversation_rewind_memory_publication_pending');
    }
    if (publication.disposition !== 'enqueued') continue;
    if (!isEligibleMessageMemoryPublicationSource(message)) {
      fail('conversation_rewind_memory_source_identity_invalid');
    }
    const sourceId = requireExactMemoryProvenanceId(
      message.id,
      'conversation_rewind_memory_source_identity_invalid',
    );
    if (seen.has(sourceId)) fail('conversation_rewind_memory_source_identity_invalid');
    seen.add(sourceId);
    sourceIds.push(sourceId);
  }
  return sourceIds;
}

function decodeExactTurnSourceRow(
  row: ExactTurnSourceRow,
  expectedOwnerId: string,
): PersistedExactMemorySourceIdentity {
  if (
    typeof row.memory_owner_id !== 'string' ||
    typeof row.memory_conversation_id !== 'string' ||
    typeof row.source_thread_id !== 'string' ||
    typeof row.task_id !== 'string' ||
    typeof row.source_id !== 'string'
  ) {
    return fail('conversation_rewind_memory_source_scope_invalid');
  }
  const source = persistExactMemorySourceIdentity(
    requireExactMemorySourceIdentity({
      memoryOwnerId: row.memory_owner_id,
      memoryConversationId: row.memory_conversation_id,
      sourceThreadId: row.source_thread_id,
      taskId: row.task_id === '' ? null : row.task_id,
      sourceKind: 'turn',
      sourceId: row.source_id,
    }),
  );
  if (source.memoryOwnerId !== expectedOwnerId) {
    return fail('conversation_rewind_memory_source_scope_invalid');
  }
  return source;
}

function loadExactTurnSourceRows(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  sourceIds: readonly string[];
}): readonly ExactTurnSourceRow[] {
  return input.db.getAllSync<ExactTurnSourceRow>(
    `WITH target_source(source_id) AS (VALUES ${input.sourceIds.map(() => '(?)').join(', ')})
     SELECT memory_owner_id, memory_conversation_id, source_thread_id, task_id, source_id
       FROM (
         SELECT source.memory_owner_id, source.memory_conversation_id, source.source_thread_id,
                source.task_id, source.source_id
           FROM memory_ingestion_job_sources AS source
           JOIN target_source AS target ON target.source_id = source.source_id
          WHERE source.memory_owner_id = ?
            AND source.memory_conversation_id = ?
            AND source.source_thread_id = ?
            AND source.source_kind = 'turn'
         UNION
         SELECT source.memory_owner_id, source.memory_conversation_id, source.source_thread_id,
                source.task_id, source.source_id
           FROM memory_fact_contribution_sources AS source
           JOIN target_source AS target ON target.source_id = source.source_id
          WHERE source.memory_owner_id = ?
            AND source.memory_conversation_id = ?
            AND source.source_thread_id = ?
            AND source.source_kind = 'turn'
         UNION
         SELECT policy.memory_owner_id,
                policy.memory_conversation_id,
                policy.source_thread_id,
                COALESCE(policy.task_id, '') AS task_id,
                episode.source_end_message_id AS source_id
           FROM memory_episodes AS episode
           JOIN memory_episode_access_policies AS policy
             ON policy.episode_id = episode.id
           JOIN target_source AS target ON target.source_id = episode.source_end_message_id
          WHERE policy.memory_owner_id = ?
            AND policy.memory_conversation_id = ?
            AND policy.source_thread_id = ?
         UNION
         SELECT source.memory_owner_id, source.memory_conversation_id, source.source_thread_id,
                source.task_id, source.source_id
           FROM memory_retired_sources AS source
           JOIN target_source AS target ON target.source_id = source.source_id
          WHERE source.memory_owner_id = ?
            AND source.memory_conversation_id = ?
            AND source.source_thread_id = ?
            AND source.source_kind = 'turn'
       ) AS known_source
      ORDER BY source_id ASC, task_id ASC`,
    ...input.sourceIds,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
    input.memoryOwnerId,
    input.memoryConversationId,
    input.sourceThreadId,
  );
}

function loadExactTurnSources(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  sourceIds: readonly string[];
}): readonly PersistedExactMemorySourceIdentity[] {
  const rows: ExactTurnSourceRow[] = [];
  for (let offset = 0; offset < input.sourceIds.length; offset += SOURCE_ID_LOOKUP_PAGE_SIZE) {
    rows.push(
      ...loadExactTurnSourceRows({
        ...input,
        sourceIds: input.sourceIds.slice(offset, offset + SOURCE_ID_LOOKUP_PAGE_SIZE),
      }),
    );
  }
  const sources = rows.map((row) => decodeExactTurnSourceRow(row, input.memoryOwnerId));
  const sourcesById = new Map<string, PersistedExactMemorySourceIdentity[]>();
  const exactSourceKeys = new Set<string>();
  for (const source of sources) {
    const exactSourceKey = JSON.stringify([
      source.memoryOwnerId,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      source.sourceKind,
      source.sourceId,
    ]);
    if (exactSourceKeys.has(exactSourceKey)) {
      fail('conversation_rewind_memory_source_scope_invalid');
    }
    exactSourceKeys.add(exactSourceKey);
    const group = sourcesById.get(source.sourceId);
    if (group) group.push(source);
    else sourcesById.set(source.sourceId, [source]);
  }
  for (const sourceId of input.sourceIds) {
    if ((sourcesById.get(sourceId)?.length ?? 0) < 1) {
      fail('conversation_rewind_memory_source_scope_unavailable');
    }
  }
  return sources.sort((left, right) => {
    const leftKey = JSON.stringify([left.sourceId, left.taskId]);
    const rightKey = JSON.stringify([right.sourceId, right.taskId]);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function resolveSafeBatchRetiredAt(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  requestedAt: number;
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
}): number {
  const activeAggregates = loadCompleteActiveRetirementGraphInTransaction(
    input.db,
    input.memoryOwnerId,
  );
  const plan = planExactSourceRetirement({
    requestedSources: input.sources,
    activeAggregates,
  });
  const newlyRetiredIds = new Set(plan.newlyRetiredContributionIds);
  let retiredAt = input.requestedAt;
  for (const aggregate of activeAggregates) {
    if (newlyRetiredIds.has(aggregate.contributionId)) {
      retiredAt = Math.max(retiredAt, aggregate.contributedAt);
    }
  }
  return retiredAt;
}

/**
 * Seal every durable turn removed by an edit or retry before its chat source can be replaced.
 * Only code-owned publication receipts and exact persisted source tuples participate.
 */
export function retireConversationSourcesForRewind(input: {
  conversationId: string;
  messageId: string;
  reason: ConversationRewindRetirementReason;
  now?: number;
}): ConversationSourceRetirementResult {
  const conversationId = requireExactMemoryScopeId(
    input.conversationId,
    'conversation_rewind_memory_conversation_identity_invalid',
  );
  const messageId = requireExactMemoryProvenanceId(
    input.messageId,
    'conversation_rewind_memory_message_identity_invalid',
  );
  const snapshot = useChatStore.getState();
  const eligibility = resolveRewindUserMessageEligibility({
    conversations: snapshot.conversations,
    conversationId,
    messageId,
  });
  if (eligibility.status === 'rejected') {
    fail(`conversation_rewind_memory_preflight_${eligibility.reason}`);
  }
  const { conversationIndex, messageIndex } = eligibility;
  const conversation = snapshot.conversations[conversationIndex]!;
  const sourceIds = collectEnqueuedTurnSourceIds(conversation.messages.slice(messageIndex));
  if (sourceIds.length === 0) return { status: 'not_required', retiredSourceCount: 0 };

  const memoryConversationId = requireExactMemoryScopeId(
    resolveConversationWorkspaceTarget({
      conversationId,
      conversations: snapshot.conversations,
    }).workspaceConversationId,
    'conversation_rewind_memory_workspace_identity_invalid',
  );
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const sources = loadExactTurnSources({
    db,
    memoryOwnerId,
    memoryConversationId,
    sourceThreadId: conversationId,
    sourceIds,
  });
  const requestedRetiredAt = input.now ?? Date.now();
  if (!Number.isSafeInteger(requestedRetiredAt) || requestedRetiredAt < 0) {
    fail('conversation_rewind_memory_retirement_timestamp_invalid');
  }
  runMemoryTransaction(() => {
    for (
      let offset = 0;
      offset < sources.length;
      offset += MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources
    ) {
      const requestedSources = sources.slice(
        offset,
        offset + MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources,
      );
      const retiredAt = resolveSafeBatchRetiredAt({
        db,
        memoryOwnerId,
        requestedAt: requestedRetiredAt,
        sources: requestedSources,
      });
      retireExactMemorySources({
        reason: input.reason,
        requestedSources,
        retiredAt,
      });
    }
  });

  for (const sourceId of sourceIds) {
    const transition = useChatStore
      .getState()
      .transitionMessageMemoryPublication(conversationId, sourceId, 'withdrawn');
    if (transition.status !== 'applied') {
      fail('conversation_rewind_memory_publication_commit_failed');
    }
  }
  return { status: 'retired', retiredSourceCount: sources.length };
}
