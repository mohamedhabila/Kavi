import type { AgentRun, AgentRunStatus } from '../../../types/agentRun';
import type { Message } from '../../../types/message';
import type { SubAgentCompletionState, SubAgentSnapshot } from '../../../types/subAgent';
import { hasCompleteFinalAssistantMetadata } from '../../../utils/assistantMessageMetadata';
import { isSteeringUserMessage } from '../../../utils/steeringMessages';

export type AgentRunMessageScope = {
  userMessageId: string;
  runStartedAt?: number;
};

export function buildAgentRunMessageScope(
  run: Pick<AgentRun, 'userMessageId' | 'createdAt'>,
): AgentRunMessageScope {
  return {
    userMessageId: run.userMessageId,
    runStartedAt: run.createdAt,
  };
}

function resolveAgentRunMessageSliceStartIndex(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): number {
  const userMessageId = typeof scope === 'string' ? scope : scope.userMessageId;
  const anchoredIndex = messages.findIndex((message) => message.id === userMessageId);
  if (anchoredIndex >= 0) {
    return anchoredIndex;
  }

  const runStartedAt = typeof scope === 'string' ? undefined : scope.runStartedAt;
  if (typeof runStartedAt !== 'number' || !Number.isFinite(runStartedAt)) {
    return -1;
  }

  return messages.findIndex(
    (message) => typeof message.timestamp === 'number' && message.timestamp >= runStartedAt,
  );
}

export function getAgentRunMessageSlice(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): Message[] {
  const startIndex = resolveAgentRunMessageSliceStartIndex(messages, scope);
  if (startIndex < 0) {
    return [];
  }

  let endIndex = messages.length;
  let acceptsClarificationResponse = false;
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (isSteeringUserMessage(message)) {
      // The run read this message at its next step; its turn continues past it.
      continue;
    }
    if (message.role === 'user') {
      if (acceptsClarificationResponse) {
        acceptsClarificationResponse = false;
        continue;
      }
      endIndex = index;
      break;
    }
    if (message.role === 'assistant' && !message.subAgentEvent) {
      acceptsClarificationResponse =
        message.assistantMetadata?.finishReason === 'request_clarification';
    }
  }

  return messages.slice(startIndex, endIndex);
}

function hasVisibleFinalAssistantText(message: Message): boolean {
  return message.role === 'assistant' && message.content.trim().length > 0;
}

export function hasDeliveredFinalAssistantResponse(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): boolean {
  return getLatestAssistantProjectionFinalResponse(messages, scope) !== undefined;
}

/**
 * Return a delivered final only when the latest assistant projection is final.
 * Sub-agent event messages are observational and do not supersede the owning
 * assistant projection.
 */
export function getLatestAssistantProjectionFinalResponsePreview(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): string | undefined {
  return getLatestAssistantProjectionFinalResponse(messages, scope)?.content.trim();
}

/**
 * Return the exact delivered final projection for a run. Callers that persist
 * lineage must use the message identity instead of inferring it from preview
 * text, which may be duplicated or replaced later in the same run slice.
 */
export function getLatestAssistantProjectionFinalResponse(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): Message | undefined {
  const assistantMessages = getAgentRunMessageSlice(messages, scope).filter(
    (message) => message.role === 'assistant',
  );
  const projection = [...assistantMessages].reverse().find((message) => !message.subAgentEvent);
  return projection &&
    hasCompleteFinalAssistantMetadata(projection) &&
    hasVisibleFinalAssistantText(projection)
    ? projection
    : undefined;
}

export function summarizeBackgroundWorkerRunOutcome(
  workers: Array<Pick<SubAgentSnapshot, 'status' | 'output' | 'completionState'>>,
): { status: Exclude<AgentRunStatus, 'running'>; summary: string } {
  if (workers.some((worker) => worker.status === 'error' || worker.status === 'timeout')) {
    return {
      status: 'failed',
      summary: 'Background work finished with at least one failed worker.',
    };
  }

  if (workers.some((worker) => worker.status === 'cancelled')) {
    return {
      status: 'cancelled',
      summary: 'Background work stopped after a worker was cancelled.',
    };
  }

  if (
    workers.some(
      (worker) =>
        worker.status === 'completed' &&
        resolveWorkerCompletionState(worker) !== 'verified_success',
    )
  ) {
    return {
      status: 'failed',
      summary: 'Background work finished without verified worker completion.',
    };
  }

  return {
    status: 'completed',
    summary: 'All background workers finished.',
  };
}

function resolveWorkerCompletionState(
  worker: Pick<SubAgentSnapshot, 'output' | 'completionState'>,
): SubAgentCompletionState | undefined {
  return worker.completionState;
}
