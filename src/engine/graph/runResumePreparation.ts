import type { AgentRun, AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import { prepareAgentRunControlGraphForResume } from '../../services/agents/agentControlGraphState';

function latestUserMessageId(messages: ReadonlyArray<Message>): string | undefined {
  return [...messages].reverse().find((message) => message.role === 'user')?.id;
}

function messageContainsUserId(messages: ReadonlyArray<Message>, id: string | undefined): boolean {
  return Boolean(id && messages.some((message) => message.role === 'user' && message.id === id));
}

function normalizeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export type AgentRunResumePreparation = {
  initialAgentControlGraphState?: AgentRunControlGraphState;
  workflowScopeUserMessageId?: string;
};

export function prepareE2EOrchestratorTurnResume(params: {
  graphState?: AgentRunControlGraphState;
  userMessageId: string;
  messages: ReadonlyArray<Message>;
  updatedAt?: number;
}): AgentRunResumePreparation {
  if (!params.graphState) {
    return prepareAgentRunResumeForOrchestrator({
      fallbackUserMessageId: params.userMessageId,
      messages: params.messages,
      updatedAt: params.updatedAt,
    });
  }

  return prepareAgentRunResumeForOrchestrator({
    existingRun: {
      controlGraph: params.graphState,
      userMessageId: params.userMessageId,
    },
    fallbackUserMessageId: params.userMessageId,
    messages: params.messages,
    updatedAt: params.updatedAt,
  });
}

export function prepareAgentRunResumeForOrchestrator(params: {
  existingRun?: Pick<AgentRun, 'controlGraph' | 'userMessageId'>;
  fallbackUserMessageId?: string;
  messages: ReadonlyArray<Message>;
  updatedAt?: number;
}): AgentRunResumePreparation {
  const latestMessageId = latestUserMessageId(params.messages);
  const requestedScopeUserMessageId =
    normalizeId(params.existingRun?.userMessageId) ??
    normalizeId(params.fallbackUserMessageId) ??
    latestMessageId;
  const workflowScopeUserMessageId = messageContainsUserId(
    params.messages,
    requestedScopeUserMessageId,
  )
    ? requestedScopeUserMessageId
    : latestMessageId;

  if (!params.existingRun) {
    return {
      ...(workflowScopeUserMessageId ? { workflowScopeUserMessageId } : {}),
    };
  }

  const timestamp = params.updatedAt ?? Date.now();

  return {
    initialAgentControlGraphState: prepareAgentRunControlGraphForResume(
      params.existingRun.controlGraph,
      {
        reason: 'resuming a running agent run',
        updatedAt: timestamp,
      },
    ),
    ...(workflowScopeUserMessageId ? { workflowScopeUserMessageId } : {}),
  };
}
