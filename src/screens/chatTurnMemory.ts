import { resolveGraphTaskId } from '../engine/goals/graphTaskScope';
import { getActiveGoal } from '../engine/goals/types';
import { recordCompletedTurnForMemory } from '../services/memory/lifecycle';
import { syncActiveTaskFromGoal } from '../services/memory/tasks';
import { upsertGoalTaskEntry } from '../services/memory/taskStack';
import { useChatStore } from '../store/useChatStore';
import type { LlmProviderConfig } from '../types/provider';

export interface RecordConversationTurnMemoryOptions {
  memoryConversationId?: string | null;
}

function resolveMemoryTaskContext(conversationId: string): {
  taskId?: string;
  goalTitle?: string;
} {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) return {};

  const latestRun = [...(conversation.agentRuns ?? [])].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  const graph = latestRun?.controlGraph;
  const activeGoal = getActiveGoal(graph?.goals ?? []);
  const taskId = resolveGraphTaskId({
    goals: graph?.goals,
    activeTaskId: graph?.activeTaskId,
  });
  if (!taskId) return {};
  return {
    taskId,
    goalTitle: activeGoal?.title,
  };
}

export function recordConversationTurnMemory(
  conversationId: string,
  activeChatProvider?: LlmProviderConfig,
  options: RecordConversationTurnMemoryOptions = {},
): void {
  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!latestConversation) {
    return;
  }

  const { taskId, goalTitle } = resolveMemoryTaskContext(conversationId);
  const memoryConversationId = options.memoryConversationId?.trim() || conversationId;

  void recordCompletedTurnForMemory({
    threadId: conversationId,
    memoryConversationId,
    messages: latestConversation.messages,
    threadTitle: latestConversation.title,
    activeChatProvider,
    ...(taskId ? { taskId } : {}),
  })
    .then(() => {
      if (!taskId || !goalTitle) {
        return;
      }
      try {
        upsertGoalTaskEntry(memoryConversationId, taskId, goalTitle, 'active');
        syncActiveTaskFromGoal({
          threadId: memoryConversationId,
          goalId: taskId,
          goalTitle,
          threadTitle: latestConversation.title,
        });
      } catch {
        // Task sync is best-effort; memory recording must not fail.
      }
    })
    .catch(() => undefined);
}
