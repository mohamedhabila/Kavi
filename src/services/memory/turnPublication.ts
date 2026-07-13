import { resolveGraphTaskId } from '../../engine/goals/graphTaskScope';
import { getGoalById } from '../../engine/goals/types';
import { useChatStore } from '../../store/useChatStore';
import type { Conversation } from '../../types/conversation';
import type { LlmProviderConfig } from '../../types/provider';
import { recordCompletedTurnForMemory, type RecordCompletedTurnForMemoryResult } from './lifecycle';
import { resolveCodeOwnedMemoryConversationId } from './memoryScopeIdentity';
import { syncActiveTaskFromGoal } from './tasks';
import { upsertGoalTaskEntry } from './taskStack';

export interface RecordConversationTurnMemoryOptions {
  sourceEndMessageId: string;
  memoryConversationId?: string | null;
  sourceRunId?: string;
}

export type RecordConversationTurnMemory = (
  conversationId: string,
  activeChatProvider: LlmProviderConfig | undefined,
  options: RecordConversationTurnMemoryOptions,
) => Promise<RecordCompletedTurnForMemoryResult>;

function resolveSourceTaskContext(
  conversation: Conversation,
  sourceRunId: string | undefined,
): { taskId?: string; goalTitle?: string } {
  if (!sourceRunId) return {};
  const sourceRun = conversation.agentRuns?.find((candidate) => candidate.id === sourceRunId);
  if (!sourceRun) {
    throw new Error('memory_turn_publication_source_run_unavailable');
  }
  const graph = sourceRun.controlGraph;
  const taskId = resolveGraphTaskId({
    goals: graph?.goals,
    activeTaskId: graph?.activeTaskId,
  });
  if (!taskId) return {};
  return {
    taskId,
    goalTitle: getGoalById(graph?.goals ?? [], taskId)?.title,
  };
}

function assertPublishedTurn(result: RecordCompletedTurnForMemoryResult): void {
  if (result.enqueued && result.jobId) return;
  if (result.skipped === 'opt_out' || result.skipped === 'ephemeral_thread') return;
  throw new Error(`memory_turn_publication_${result.skipped ?? 'not_enqueued'}`);
}

/** Publish one exact persisted assistant final into the durable memory queue. */
export async function publishConversationTurnMemory(
  conversationId: string,
  activeChatProvider: LlmProviderConfig | undefined,
  options: RecordConversationTurnMemoryOptions,
): Promise<RecordCompletedTurnForMemoryResult> {
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
  const { taskId, goalTitle } = resolveSourceTaskContext(conversation, options.sourceRunId);
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
  assertPublishedTurn(result);

  if (result.enqueued && taskId && goalTitle) {
    try {
      upsertGoalTaskEntry(memoryConversationId, taskId, goalTitle, 'active');
      syncActiveTaskFromGoal({
        threadId: memoryConversationId,
        goalId: taskId,
        goalTitle,
        threadTitle: conversation.title,
      });
    } catch {
      // Task projection is ancillary to the already-durable source publication.
    }
  }

  return result;
}
