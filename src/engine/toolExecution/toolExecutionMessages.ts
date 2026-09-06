import type { Message, ToolCall, ToolCallFailureKind } from '../../types/message';

export type RuntimeToolCallInput = {
  id: string;
  name: string;
  arguments: string;
  raw?: Record<string, any>;
};

export function createRunningToolCall(
  toolCall: RuntimeToolCallInput,
  timestamp = Date.now(),
): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments,
    ...(toolCall.raw ? { raw: toolCall.raw } : {}),
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createFailedToolCall(
  toolCall: RuntimeToolCallInput,
  error: string,
  timestamp = Date.now(),
  failureKind?: ToolCallFailureKind,
): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments,
    ...(failureKind ? { failureKind } : {}),
    status: 'failed',
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    error,
  };
}

export function completeRunningToolCall(
  toolCall: ToolCall,
  result: string,
  failed: boolean,
  timestamp = Date.now(),
  failureKind?: ToolCallFailureKind,
): ToolCall {
  toolCall.status = failed ? 'failed' : 'completed';
  toolCall.updatedAt = timestamp;
  toolCall.completedAt = timestamp;
  toolCall.result = result;
  if (failed) {
    // Only set when the caller supplies a structured kind — an undefined
    // failureKind is a legitimate outcome, rendered as generic failure copy
    // by the UI rather than papered over with a fabricated default.
    if (failureKind) {
      toolCall.failureKind = failureKind;
    }
    toolCall.error = result;
  }
  return toolCall;
}

export function failRunningToolCall(
  toolCall: ToolCall,
  error: string,
  timestamp = Date.now(),
  failureKind?: ToolCallFailureKind,
): ToolCall {
  toolCall.status = 'failed';
  // 'internal' is a deliberate, structured fallback (not a text-sniffed guess)
  // for the rare caller that fails a running call without classifying why.
  toolCall.failureKind = failureKind ?? 'internal';
  toolCall.updatedAt = timestamp;
  toolCall.completedAt = timestamp;
  toolCall.error = error;
  return toolCall;
}

export function buildToolResultMessage(params: {
  idPrefix: string;
  toolCallId: string;
  content: string;
  toolCall: ToolCall;
  isError?: boolean;
  timestamp?: number;
}): Message {
  const timestamp = params.timestamp ?? Date.now();
  const messageToolCall = { ...params.toolCall };
  delete messageToolCall.effectReceipts;
  return {
    id: `msg_${timestamp}_${params.idPrefix}_${params.toolCallId}`,
    role: 'tool',
    content: params.content,
    toolCallId: params.toolCallId,
    toolCalls: [messageToolCall],
    timestamp,
    ...(params.isError ? { isError: true } : {}),
  };
}
