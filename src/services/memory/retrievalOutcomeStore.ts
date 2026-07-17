import { runMemoryTransaction } from './access/transaction';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { buildMemoryRetrievalScopeHash } from './retrievalLog';
import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';
import { isMemoryRetrievalEventId } from '../../utils/assistantMessageMetadata';
import { sha256HexUtf8Async } from '../../utils/sha256Async';

export const MEMORY_RETRIEVAL_FEEDBACK_CHOICES = ['helpful', 'wrong', 'irrelevant'] as const;
export type MemoryRetrievalFeedbackChoice = (typeof MEMORY_RETRIEVAL_FEEDBACK_CHOICES)[number];

export type MemoryRetrievalFeedbackTarget = Readonly<{
  retrievalEventId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  assistantMessageId: string;
}>;

export type RecordMemoryRetrievalFeedbackResult =
  | {
      status: 'recorded' | 'updated' | 'unchanged';
      outcome: MemoryRetrievalFeedbackChoice;
      createdAt: number;
      updatedAt: number;
    }
  | { status: 'rejected'; code: 'invalid_input' | 'not_recordable' }
  | { status: 'failed'; code: 'hashing_error' | 'storage_error' };

export type ReadMemoryRetrievalFeedbackResult =
  | { status: 'found'; outcome: MemoryRetrievalFeedbackChoice; updatedAt: number }
  | { status: 'not_found' }
  | { status: 'failed'; code: 'hashing_error' | 'storage_error' };

type RetrievalEventTargetRow = {
  operation: string;
  outcome: string;
  memory_conversation_id_hash: string | null;
  source_thread_id_hash: string | null;
  selected_fact_count: number;
  selected_episode_count: number;
};

type RetrievalOutcomeRow = {
  memory_owner_id: string;
  memory_conversation_id_hash: string;
  source_thread_id_hash: string;
  assistant_message_id_hash: string;
  outcome: MemoryRetrievalFeedbackChoice;
  evidence_source: string;
  contract_version: number;
  created_at: number;
  updated_at: number;
};

type HashedFeedbackTarget = {
  retrievalEventId: string;
  memoryConversationIdHash: string;
  sourceThreadIdHash: string;
  assistantMessageIdHash: string;
};

function isFeedbackChoice(value: unknown): value is MemoryRetrievalFeedbackChoice {
  return (
    typeof value === 'string' &&
    MEMORY_RETRIEVAL_FEEDBACK_CHOICES.includes(value as MemoryRetrievalFeedbackChoice)
  );
}

function isValidTarget(target: MemoryRetrievalFeedbackTarget): boolean {
  return (
    !!target &&
    typeof target === 'object' &&
    isMemoryRetrievalEventId(target.retrievalEventId) &&
    isExactMemoryScopeId(target.memoryConversationId) &&
    isExactMemoryScopeId(target.sourceThreadId) &&
    isExactMemoryScopeId(target.assistantMessageId)
  );
}

async function hashAssistantMessageId(messageId: string): Promise<string> {
  return sha256HexUtf8Async(`assistant_message\u0000${messageId}`);
}

async function hashFeedbackTarget(
  target: MemoryRetrievalFeedbackTarget,
): Promise<HashedFeedbackTarget> {
  const [memoryConversationIdHash, sourceThreadIdHash, assistantMessageIdHash] = await Promise.all([
    buildMemoryRetrievalScopeHash('memory_conversation', target.memoryConversationId),
    buildMemoryRetrievalScopeHash('source_thread', target.sourceThreadId),
    hashAssistantMessageId(target.assistantMessageId),
  ]);
  if (!memoryConversationIdHash || !sourceThreadIdHash) {
    throw new Error('memory_retrieval_feedback_scope_hash_missing');
  }
  return {
    retrievalEventId: target.retrievalEventId,
    memoryConversationIdHash,
    sourceThreadIdHash,
    assistantMessageIdHash,
  };
}

function readRecordableEvent(target: HashedFeedbackTarget): RetrievalEventTargetRow | undefined {
  const event = getMemoryDb().getFirstSync<RetrievalEventTargetRow>(
    `SELECT operation, outcome, memory_conversation_id_hash, source_thread_id_hash,
            selected_fact_count, selected_episode_count
       FROM memory_retrieval_events
      WHERE id = ?`,
    target.retrievalEventId,
  );
  if (
    !event ||
    event.operation !== 'prompt_assembly' ||
    !['completed', 'degraded'].includes(event.outcome) ||
    event.selected_fact_count + event.selected_episode_count <= 0 ||
    event.memory_conversation_id_hash !== target.memoryConversationIdHash ||
    event.source_thread_id_hash !== target.sourceThreadIdHash
  ) {
    return undefined;
  }
  return event;
}

function readOutcomeRow(target: HashedFeedbackTarget): RetrievalOutcomeRow | undefined {
  return (
    getMemoryDb().getFirstSync<RetrievalOutcomeRow>(
      `SELECT memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
            assistant_message_id_hash, outcome, evidence_source, contract_version,
            created_at, updated_at
       FROM memory_retrieval_outcomes
      WHERE retrieval_event_id = ?`,
      target.retrievalEventId,
    ) ?? undefined
  );
}

function outcomeRowMatchesTarget(
  row: RetrievalOutcomeRow,
  target: HashedFeedbackTarget,
  memoryOwnerId: string,
): boolean {
  return (
    row.memory_owner_id === memoryOwnerId &&
    row.memory_conversation_id_hash === target.memoryConversationIdHash &&
    row.source_thread_id_hash === target.sourceThreadIdHash &&
    row.assistant_message_id_hash === target.assistantMessageIdHash &&
    row.evidence_source === 'user_explicit' &&
    row.contract_version === 1 &&
    isFeedbackChoice(row.outcome) &&
    Number.isSafeInteger(row.created_at) &&
    Number.isSafeInteger(row.updated_at) &&
    row.created_at >= 0 &&
    row.updated_at >= row.created_at
  );
}

export async function recordExplicitMemoryRetrievalFeedback(input: {
  target: MemoryRetrievalFeedbackTarget;
  outcome: MemoryRetrievalFeedbackChoice;
  recordedAt?: number;
}): Promise<RecordMemoryRetrievalFeedbackResult> {
  const recordedAt = input.recordedAt ?? Date.now();
  if (
    !isValidTarget(input.target) ||
    !isFeedbackChoice(input.outcome) ||
    !Number.isSafeInteger(recordedAt) ||
    recordedAt < 0
  ) {
    return { status: 'rejected', code: 'invalid_input' };
  }

  let target: HashedFeedbackTarget;
  try {
    target = await hashFeedbackTarget(input.target);
  } catch {
    return { status: 'failed', code: 'hashing_error' };
  }

  try {
    ensureFactSchema();
    return runMemoryTransaction(() => {
      if (!readRecordableEvent(target)) {
        return { status: 'rejected', code: 'not_recordable' } as const;
      }
      const memoryOwnerId = getLocalMemoryVaultOwnerId(getMemoryDb());
      const existing = readOutcomeRow(target);
      if (existing) {
        if (!outcomeRowMatchesTarget(existing, target, memoryOwnerId)) {
          return { status: 'rejected', code: 'not_recordable' } as const;
        }
        if (existing.outcome === input.outcome) {
          return {
            status: 'unchanged',
            outcome: existing.outcome,
            createdAt: existing.created_at,
            updatedAt: existing.updated_at,
          } as const;
        }
        const updatedAt = Math.max(recordedAt, existing.updated_at);
        const changes =
          getMemoryDb().runSync(
            `UPDATE memory_retrieval_outcomes
                SET outcome = ?, updated_at = ?
              WHERE retrieval_event_id = ?
                AND memory_owner_id = ?
                AND memory_conversation_id_hash = ?
                AND source_thread_id_hash = ?
                AND assistant_message_id_hash = ?
                AND evidence_source = 'user_explicit'
                AND contract_version = 1`,
            input.outcome,
            updatedAt,
            target.retrievalEventId,
            memoryOwnerId,
            target.memoryConversationIdHash,
            target.sourceThreadIdHash,
            target.assistantMessageIdHash,
          ).changes ?? 0;
        if (changes !== 1) {
          throw new Error('memory_retrieval_feedback_update_conflict');
        }
        return {
          status: 'updated',
          outcome: input.outcome,
          createdAt: existing.created_at,
          updatedAt,
        } as const;
      }

      getMemoryDb().runSync(
        `INSERT INTO memory_retrieval_outcomes(
           retrieval_event_id, memory_owner_id, memory_conversation_id_hash,
           source_thread_id_hash, assistant_message_id_hash, outcome,
           evidence_source, contract_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'user_explicit', 1, ?, ?)`,
        target.retrievalEventId,
        memoryOwnerId,
        target.memoryConversationIdHash,
        target.sourceThreadIdHash,
        target.assistantMessageIdHash,
        input.outcome,
        recordedAt,
        recordedAt,
      );
      return {
        status: 'recorded',
        outcome: input.outcome,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      } as const;
    });
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}

export async function readExplicitMemoryRetrievalFeedback(
  targetInput: MemoryRetrievalFeedbackTarget,
): Promise<ReadMemoryRetrievalFeedbackResult> {
  if (!isValidTarget(targetInput)) {
    return { status: 'not_found' };
  }
  let target: HashedFeedbackTarget;
  try {
    target = await hashFeedbackTarget(targetInput);
  } catch {
    return { status: 'failed', code: 'hashing_error' };
  }
  try {
    ensureFactSchema();
    if (!readRecordableEvent(target)) {
      return { status: 'not_found' };
    }
    const row = readOutcomeRow(target);
    const memoryOwnerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    if (!row || !outcomeRowMatchesTarget(row, target, memoryOwnerId)) {
      return { status: 'not_found' };
    }
    return { status: 'found', outcome: row.outcome, updatedAt: row.updated_at };
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}
