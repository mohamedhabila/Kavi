import type { AgentRun } from '../../../types/agentRun';
import type { Conversation, ConversationMode } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { selectForegroundSupersededRun } from '../foregroundConversationCancellation';
import { shouldTrackForegroundAgentRun } from '../runTracking';
import { findLatestIncompleteAgentRunAssistantMessage } from './assistantMessages';
import { buildAgentRunMessageScope } from '../../../services/agents/lifecycle/agentRunStateMachine';

function normalizeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function findLatestUserMessage(conversation: Conversation | undefined): Message | undefined {
  return [...(conversation?.messages ?? [])].reverse().find((message) => message.role === 'user');
}

function resolveResumedAssistantDraft(params: {
  conversation: Conversation | undefined;
  existingRun: AgentRun | undefined;
  reuseAssistantDraft?: boolean;
}): Message | undefined {
  if (!params.conversation || !params.existingRun || params.reuseAssistantDraft === false) {
    return undefined;
  }

  const runMessageScope = buildAgentRunMessageScope(params.existingRun);
  const resumedAssistantDraftMessageId = findLatestIncompleteAgentRunAssistantMessage(
    params.conversation.messages,
    runMessageScope,
  )?.id;

  return resumedAssistantDraftMessageId
    ? params.conversation.messages.find((message) => message.id === resumedAssistantDraftMessageId)
    : undefined;
}

export type ForegroundRunBootstrapSelection = {
  assistantMessageId: string;
  existingRun?: AgentRun;
  latestUserMessage?: Message;
  resumedAssistantDraft?: Message;
  shouldAbortPreviousForegroundRequest: boolean;
  shouldInsertPlaceholderAssistant: boolean;
  shouldTrackAgentRun: boolean;
  supersededRun?: AgentRun;
  supersededRunningWorkerCount: number;
};

type StartAgentRunParams = {
  goal: string;
  summary: {
    assistantTurns: number;
  };
  userMessageId: string;
};

export function buildForegroundRunBootstrapSelection(params: {
  conversation?: Conversation;
  createAssistantMessageId: () => string;
  defaultConversationMode?: ConversationMode;
  reuseAgentRunId?: string;
  reuseAssistantDraft?: boolean;
}): ForegroundRunBootstrapSelection {
  const normalizedReuseAgentRunId = normalizeId(params.reuseAgentRunId);
  const latestUserMessage = findLatestUserMessage(params.conversation);
  const shouldTrackAgentRun = shouldTrackForegroundAgentRun({
    conversationMode: params.conversation?.mode,
    defaultConversationMode: params.defaultConversationMode,
    latestUserMessage,
    messageCount: params.conversation?.messages?.length ?? 0,
    reuseAgentRunId: normalizedReuseAgentRunId,
  });
  const { existingRun, supersededRun, supersededRunningWorkerCount } =
    selectForegroundSupersededRun({
      conversation: params.conversation,
      reuseAgentRunId: normalizedReuseAgentRunId,
    });
  const resumedAssistantDraft = resolveResumedAssistantDraft({
    conversation: params.conversation,
    existingRun,
    reuseAssistantDraft: params.reuseAssistantDraft,
  });

  return {
    assistantMessageId: resumedAssistantDraft?.id ?? params.createAssistantMessageId(),
    existingRun,
    latestUserMessage,
    resumedAssistantDraft,
    shouldAbortPreviousForegroundRequest: !normalizedReuseAgentRunId,
    shouldInsertPlaceholderAssistant: !resumedAssistantDraft,
    shouldTrackAgentRun,
    supersededRun,
    supersededRunningWorkerCount,
  };
}

export function startOrReuseForegroundTrackedRun(params: {
  bootstrap: Pick<
    ForegroundRunBootstrapSelection,
    'existingRun' | 'latestUserMessage' | 'shouldTrackAgentRun'
  >;
  clearTrackedRunCancellation: (conversationId: string, runId: string) => void;
  conversationId: string;
  createUserMessageId: () => string;
  startAgentRun: (conversationId: string, params: StartAgentRunParams) => string;
}): string | undefined {
  if (!params.bootstrap.shouldTrackAgentRun) {
    return undefined;
  }

  const trackedAgentRunId =
    params.bootstrap.existingRun?.id ??
    params.startAgentRun(params.conversationId, {
      userMessageId: params.bootstrap.latestUserMessage?.id ?? params.createUserMessageId(),
      goal: params.bootstrap.latestUserMessage?.content?.trim() || 'Continue the current task.',
      summary: {
        assistantTurns: 1,
      },
    });

  params.clearTrackedRunCancellation(params.conversationId, trackedAgentRunId);
  return trackedAgentRunId;
}
