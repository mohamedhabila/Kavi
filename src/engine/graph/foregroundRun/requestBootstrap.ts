import type { Conversation } from '../../../types/conversation';
import type { ForegroundAgentRunCounters } from '../foregroundRunPhaseEffects';
import {
  buildForegroundRunBootstrapSelection,
  type ForegroundRunBootstrapSelection,
} from './bootstrap';
import type { RunChatOptions } from './contracts';

export type ForegroundRunRequestBootstrapResult = {
  abortController: AbortController;
  assistantMessageId: string;
  bootstrap: ForegroundRunBootstrapSelection;
  foregroundRequestId: string;
  initialCounters: ForegroundAgentRunCounters;
  trackedAgentRunId: string | undefined;
};

export function prepareForegroundRunRequestBootstrap(params: {
  conversation: Conversation | undefined;
  conversationId: string;
  createAssistantMessageId: () => string;
  createForegroundRequestId: () => string;
  defaultConversationMode: Conversation['mode'];
  options?: RunChatOptions;
  registerForegroundRequest: (requestId: string, abortController: AbortController) => void;
  shouldAutoAbortPreviousForegroundRequest: (reason: string) => void;
  startTrackedRun: (bootstrap: ForegroundRunBootstrapSelection) => string | undefined;
  supersedeExistingRun: (runId: string, runningWorkerCount: number) => void;
}): ForegroundRunRequestBootstrapResult {
  const bootstrap = buildForegroundRunBootstrapSelection({
    conversation: params.conversation,
    createAssistantMessageId: params.createAssistantMessageId,
    defaultConversationMode: params.defaultConversationMode,
    reuseAgentRunId: params.options?.reuseAgentRunId,
    reuseAssistantDraft: params.options?.reuseAssistantDraft,
  });

  if (bootstrap.shouldAbortPreviousForegroundRequest) {
    params.shouldAutoAbortPreviousForegroundRequest('Superseded by a new user turn.');
  }

  if (bootstrap.supersededRun && params.conversation) {
    params.supersedeExistingRun(bootstrap.supersededRun.id, bootstrap.supersededRunningWorkerCount);
  }

  const abortController = new AbortController();
  const foregroundRequestId = params.createForegroundRequestId();
  params.registerForegroundRequest(foregroundRequestId, abortController);

  return {
    abortController,
    assistantMessageId: bootstrap.assistantMessageId,
    bootstrap,
    foregroundRequestId,
    initialCounters: {
      assistantTurns: (bootstrap.existingRun?.summary.assistantTurns ?? 0) + 1,
      startedTools: bootstrap.existingRun?.summary.startedTools ?? 0,
      completedTools: bootstrap.existingRun?.summary.completedTools ?? 0,
      failedTools: bootstrap.existingRun?.summary.failedTools ?? 0,
      spawnedSubAgents: bootstrap.existingRun?.summary.spawnedSubAgents ?? 0,
      runStartedAt: bootstrap.existingRun?.createdAt ?? Date.now(),
    },
    trackedAgentRunId: params.startTrackedRun(bootstrap),
  };
}
