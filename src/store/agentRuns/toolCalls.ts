import type { AgentRun } from '../../types/agentRun';
import type { Message, ToolCall } from '../../types/message';
import type {
  ResolveToolEffectRestartDisposition,
  ToolEffectRestartLookupInput,
} from '../../services/executionJournal/toolEffectRestartDisposition';
import { projectToolCallAfterRestart } from '../../services/executionJournal/toolEffectRestartProjection';
import {
  buildAgentRunMessageScope,
  getAgentRunMessageSlice,
} from '../../services/agents/lifecycle/agentRunStateMachine';
import { getAgentRunPendingAsyncOperations } from '../../services/agents/agentRunAsyncState';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../../engine/mobileController/contracts';

function hasDedicatedMobileControllerOutcome(
  run: Pick<AgentRun, 'controlGraph'>,
  toolCall: Pick<ToolCall, 'id' | 'name'>,
): boolean {
  if (toolCall.name !== MOBILE_UI_ACTION_TOOL_NAME) return false;
  const graph = run.controlGraph;
  const expectedToolCall = graph?.expectedToolCalls[0];
  if (
    graph?.status !== 'waiting_async' ||
    graph.pendingAsyncCount !== 1 ||
    graph.asyncWork.awaitingBackgroundWorkers ||
    graph.expectedToolCalls.length !== 1 ||
    expectedToolCall?.id !== toolCall.id ||
    expectedToolCall.name !== toolCall.name
  ) {
    return false;
  }
  const operations = getAgentRunPendingAsyncOperations(run);
  const operation = operations[0];
  // This tool remains owned by the external controller host. Its exact outcome
  // is journal-settled later and must not be rewritten as an interrupted tool.
  return (
    operations.length === 1 &&
    operation?.kind === 'mobile-controller-handoff' &&
    operation.status === 'running' &&
    operation.mobileControllerHandoff?.toolCallId === toolCall.id
  );
}

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
  executionRunId?: string;
  messages: Message[];
  run: Pick<AgentRun, 'id' | 'userMessageId' | 'createdAt' | 'controlGraph'>;
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
          .filter((toolCall) => !hasDedicatedMobileControllerOutcome(params.run, toolCall))
          .map((toolCall) => ({
            key: `${message.id}\u0000${toolCall.id}`,
            disposition: params.executionRunId
              ? params.resolveToolEffect({
                  conversationId: params.conversationId,
                  executionRunId: params.executionRunId,
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  argumentsText: toolCall.arguments,
                })
              : {
                  kind: 'reconciliation_required' as const,
                  observedAt: null,
                  reason: 'journal_conflict' as const,
                },
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
  executionRunId: string;
  messages: Message[];
  run: Pick<AgentRun, 'id' | 'userMessageId' | 'createdAt' | 'controlGraph'>;
}): ToolEffectRestartLookupInput[] {
  return getAgentRunMessageSlice(params.messages, buildAgentRunMessageScope(params.run)).flatMap(
    (message) =>
      message.role === 'assistant'
        ? (message.toolCalls ?? [])
            .filter((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running')
            .filter((toolCall) => !hasDedicatedMobileControllerOutcome(params.run, toolCall))
            .map((toolCall) => ({
              conversationId: params.conversationId,
              executionRunId: params.executionRunId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              argumentsText: toolCall.arguments,
            }))
        : [],
  );
}
