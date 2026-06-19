// ---------------------------------------------------------------------------
// Kavi — E2E scenario memory finalize (structural ingestion drain)
// ---------------------------------------------------------------------------

import { resolveGraphTaskId } from '../../engine/goals/graphTaskScope';
import { getActiveGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { drainIngestionQueue } from '../../services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../services/memory/lifecycle';
import { syncActiveTaskFromGoal } from '../../services/memory/tasks';
import { normalizeTerminalClosedTurnMessages } from '../../services/memory/turnProcessor';

export async function finalizeE2EScenarioTurnMemory(params: {
  conversationId: string;
  threadTitle: string;
  messages: Message[];
  activeChatProvider?: LlmProviderConfig;
  graphState?: AgentRunControlGraphState;
}): Promise<void> {
  const taskId = resolveGraphTaskId({
    goals: params.graphState?.goals,
    activeTaskId: params.graphState?.activeTaskId,
  });
  const normalizedMessages = normalizeTerminalClosedTurnMessages(params.messages);
  const record = await recordCompletedTurnForMemory({
    threadId: params.conversationId,
    messages: normalizedMessages,
    threadTitle: params.threadTitle,
    activeChatProvider: params.activeChatProvider,
    ...(taskId ? { taskId } : {}),
  });

  const activeGoal = getActiveGoal(params.graphState?.goals ?? []);
  if (activeGoal) {
    try {
      syncActiveTaskFromGoal({
        threadId: params.conversationId,
        goalId: activeGoal.id,
        goalTitle: activeGoal.title,
        threadTitle: params.threadTitle,
      });
    } catch {
      // Goal sync is best-effort; ingestion must not fail.
    }
  }

  if (!record.processed) {
    return;
  }

  await drainIngestionQueue({
    loadMessagesForThread: () => normalizedMessages,
    threadTitle: params.threadTitle,
    activeChatProvider: params.activeChatProvider,
  });
}
