import type { AgentRun } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type {
  ResolveToolEffectRestartDisposition,
  ToolEffectRestartLookupInput,
} from '../../services/executionJournal/toolEffectRestartDisposition';
import { projectToolCallAfterRestart } from '../../services/executionJournal/toolEffectRestartProjection';
import {
  buildAgentRunMessageScope,
  getAgentRunMessageSlice,
} from '../../services/agents/lifecycle/agentRunStateMachine';

export function settleActiveToolCallsInAgentRunMessages(params: {
  messages: Message[];
  run: Pick<AgentRun, 'userMessageId' | 'createdAt'>;
  timestamp: number;
  errorMessage: string;
}): { messages: Message[]; settledCount: number } {
  const runScope = buildAgentRunMessageScope(params.run);
  const runMessages = getAgentRunMessageSlice(params.messages, runScope);
  if (!runMessages.length) {
    return { messages: params.messages, settledCount: 0 };
  }

  const firstRunMessage = runMessages[0];
  const startIndex = params.messages.findIndex((message) => message.id === firstRunMessage.id);
  if (startIndex < 0) {
    return { messages: params.messages, settledCount: 0 };
  }

  const endIndex = startIndex + runMessages.length;
  let settledCount = 0;
  const nextMessages = params.messages.map((message, index) => {
    if (
      index < startIndex ||
      index >= endIndex ||
      message.role !== 'assistant' ||
      !message.toolCalls?.length
    ) {
      return message;
    }

    let didChange = false;
    const nextToolCalls = message.toolCalls.map((toolCall) => {
      if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
        return toolCall;
      }

      settledCount += 1;
      didChange = true;
      return {
        ...toolCall,
        status: 'failed' as const,
        updatedAt: params.timestamp,
        startedAt: toolCall.startedAt ?? params.timestamp,
        completedAt: toolCall.completedAt ?? params.timestamp,
        result: undefined,
        error: toolCall.error ?? params.errorMessage,
      };
    });

    return didChange
      ? {
          ...message,
          toolCalls: nextToolCalls,
        }
      : message;
  });

  return settledCount > 0
    ? { messages: nextMessages, settledCount }
    : { messages: params.messages, settledCount: 0 };
}

export function recoverActiveToolCallsAfterRestart(params: {
  conversationId: string;
  messages: Message[];
  run: Pick<AgentRun, 'id' | 'userMessageId' | 'createdAt'>;
  timestamp: number;
  interruptedErrorMessage: string;
  resolveToolEffect: ResolveToolEffectRestartDisposition;
}): {
  messages: Message[];
  completedCount: number;
  failedCount: number;
  reconciliationPendingCount: number;
} {
  const runScope = buildAgentRunMessageScope(params.run);
  const runMessages = getAgentRunMessageSlice(params.messages, runScope);
  if (!runMessages.length) {
    return {
      messages: params.messages,
      completedCount: 0,
      failedCount: 0,
      reconciliationPendingCount: 0,
    };
  }

  const firstRunMessage = runMessages[0];
  const startIndex = params.messages.findIndex((message) => message.id === firstRunMessage.id);
  if (startIndex < 0) {
    return {
      messages: params.messages,
      completedCount: 0,
      failedCount: 0,
      reconciliationPendingCount: 0,
    };
  }

  const endIndex = startIndex + runMessages.length;
  const activeDispositions = runMessages.flatMap((message) =>
    message.role === 'assistant'
      ? (message.toolCalls ?? [])
          .filter((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running')
          .map((toolCall) => ({
            key: `${message.id}\u0000${toolCall.id}`,
            disposition: params.resolveToolEffect({
              conversationId: params.conversationId,
              taskId: params.run.id,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              argumentsText: toolCall.arguments,
            }),
          }))
      : [],
  );
  const reconciliationPendingCount = activeDispositions.filter(
    ({ disposition }) => disposition.kind === 'reconciliation_required',
  ).length;
  if (reconciliationPendingCount > 0) {
    return {
      messages: params.messages,
      completedCount: 0,
      failedCount: 0,
      reconciliationPendingCount,
    };
  }
  const dispositionByTool = new Map(
    activeDispositions.map(({ key, disposition }) => [key, disposition]),
  );
  let completedCount = 0;
  let failedCount = 0;
  const nextMessages = params.messages.map((message, index) => {
    if (
      index < startIndex ||
      index >= endIndex ||
      message.role !== 'assistant' ||
      !message.toolCalls?.length
    ) {
      return message;
    }

    let didChange = false;
    const nextToolCalls = message.toolCalls.map((toolCall) => {
      const disposition = dispositionByTool.get(`${message.id}\u0000${toolCall.id}`);
      if (!disposition) return toolCall;
      didChange = true;
      const projection = projectToolCallAfterRestart({
        toolCall,
        disposition,
        timestamp: params.timestamp,
        interruptedErrorMessage: params.interruptedErrorMessage,
      });
      if (projection.recoveredAs === 'completed') {
        completedCount += 1;
      } else {
        failedCount += 1;
      }
      return projection.toolCall;
    });

    return didChange ? { ...message, toolCalls: nextToolCalls } : message;
  });

  return completedCount > 0 || failedCount > 0
    ? {
        messages: nextMessages,
        completedCount,
        failedCount,
        reconciliationPendingCount: 0,
      }
    : {
        messages: params.messages,
        completedCount: 0,
        failedCount: 0,
        reconciliationPendingCount: 0,
      };
}

export function listActiveToolEffectRestartInputs(params: {
  conversationId: string;
  messages: Message[];
  run: Pick<AgentRun, 'id' | 'userMessageId' | 'createdAt'>;
}): ToolEffectRestartLookupInput[] {
  return getAgentRunMessageSlice(params.messages, buildAgentRunMessageScope(params.run)).flatMap(
    (message) =>
      message.role === 'assistant'
        ? (message.toolCalls ?? [])
            .filter((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running')
            .map((toolCall) => ({
              conversationId: params.conversationId,
              taskId: params.run.id,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              argumentsText: toolCall.arguments,
            }))
        : [],
  );
}
