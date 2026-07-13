import { resolveGraphTaskId } from '../../engine/goals/graphTaskScope';
import { useChatStore } from '../../store/useChatStore';
import type { Conversation } from '../../types/conversation';
import type { LlmProviderConfig } from '../../types/provider';
import { recordCompletedTurnForMemory, type RecordCompletedTurnForMemoryResult } from './lifecycle';
import { resolveCodeOwnedMemoryConversationId } from './memoryScopeIdentity';

export interface RecordConversationTurnMemoryOptions {
  sourceEndMessageId: string;
  memoryConversationId?: string | null;
  sourceRunId?: string;
}

export type MemoryTurnPublicationResult =
  | Readonly<{ disposition: 'enqueued'; jobId: string }>
  | Readonly<{
      disposition: 'opt_out' | 'ephemeral_thread' | 'withdrawn';
      jobId: null;
    }>;

export type RecordConversationTurnMemory = (
  conversationId: string,
  activeChatProvider: LlmProviderConfig | undefined,
  options: RecordConversationTurnMemoryOptions,
) => Promise<MemoryTurnPublicationResult>;

function resolveSourceTaskId(
  conversation: Conversation,
  sourceRunId: string | undefined,
): string | undefined {
  if (!sourceRunId) return undefined;
  const sourceRun = conversation.agentRuns?.find((candidate) => candidate.id === sourceRunId);
  if (!sourceRun) {
    throw new Error('memory_turn_publication_source_run_unavailable');
  }
  return resolveGraphTaskId({
    goals: sourceRun.controlGraph?.goals,
    activeTaskId: sourceRun.controlGraph?.activeTaskId,
  });
}

function resolvePublicationResult(
  result: RecordCompletedTurnForMemoryResult,
): MemoryTurnPublicationResult {
  if (result.enqueued && result.jobId) {
    return { disposition: 'enqueued', jobId: result.jobId };
  }
  if (
    result.skipped === 'opt_out' ||
    result.skipped === 'ephemeral_thread' ||
    result.skipped === 'withdrawn'
  ) {
    return { disposition: result.skipped, jobId: null };
  }
  throw new Error(`memory_turn_publication_${result.skipped ?? 'not_enqueued'}`);
}

/** Publish one exact persisted assistant final into the durable memory queue. */
export async function publishConversationTurnMemory(
  conversationId: string,
  activeChatProvider: LlmProviderConfig | undefined,
  options: RecordConversationTurnMemoryOptions,
): Promise<MemoryTurnPublicationResult> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) {
    throw new Error('memory_turn_publication_conversation_unavailable');
  }

  const memoryConversationId = resolveCodeOwnedMemoryConversationId(
    options.memoryConversationId,
    conversationId,
  );
  const taskId = resolveSourceTaskId(conversation, options.sourceRunId);
  const result = await recordCompletedTurnForMemory({
    threadId: conversationId,
    memoryConversationId,
    sourceEndMessageId: options.sourceEndMessageId,
    messages: conversation.messages,
    threadTitle: conversation.title,
    activeChatProvider,
    sourceRunId: options.sourceRunId,
    ...(taskId ? { taskId } : {}),
  });
  return resolvePublicationResult(result);
}
