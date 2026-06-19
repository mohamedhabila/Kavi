import type { AgentRun, AgentRunStatus } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import type { SubAgentCompletionState, SubAgentSnapshot } from '../../../types/subAgent';
import {
  hasCompleteFinalAssistantMetadata,
  isAssistantFinalResponsePlaceholder,
} from '../../../utils/assistantMessageMetadata';

export type AgentRunMessageScope = {
  userMessageId: string;
  runStartedAt?: number;
};

export function hasNewerRunningAgentRun(
  conversation: Pick<Conversation, 'agentRuns'>,
  run: Pick<AgentRun, 'id' | 'createdAt'>,
): boolean {
  const runCreatedAt =
    typeof run.createdAt === 'number' && Number.isFinite(run.createdAt)
      ? run.createdAt
      : Number.NEGATIVE_INFINITY;

  return (conversation.agentRuns ?? []).some((candidate) => {
    if (candidate.id === run.id || candidate.status !== 'running') {
      return false;
    }

    const candidateCreatedAt =
      typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
        ? candidate.createdAt
        : Number.POSITIVE_INFINITY;

    return candidateCreatedAt >= runCreatedAt;
  });
}

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
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index].role === 'user') {
      endIndex = index;
      break;
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
  const runMessages = getAgentRunMessageSlice(messages, scope);
  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    if (
      hasCompleteFinalAssistantMetadata(runMessages[index]) &&
      !isAssistantFinalResponsePlaceholder(runMessages[index]) &&
      hasVisibleFinalAssistantText(runMessages[index])
    ) {
      return true;
    }
  }

  return false;
}

export function getLatestFinalAssistantResponsePreview(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): string | undefined {
  if (!hasDeliveredFinalAssistantResponse(messages, scope)) {
    return undefined;
  }

  const runMessages = getAgentRunMessageSlice(messages, scope);
  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    if (
      hasCompleteFinalAssistantMetadata(runMessages[index]) &&
      !isAssistantFinalResponsePlaceholder(runMessages[index]) &&
      hasVisibleFinalAssistantText(runMessages[index])
    ) {
      return runMessages[index].content.trim();
    }
  }

  return undefined;
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
