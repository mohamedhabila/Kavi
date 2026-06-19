import type { AgentRun } from '../../types/agentRun';
import type { Message } from '../../types/message';
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
