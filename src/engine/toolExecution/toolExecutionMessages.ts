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
    toolCall.failureKind = failureKind ?? 'tool_error';
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
  toolCall.failureKind = failureKind ?? 'runtime_error';
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
  return {
    id: `msg_${timestamp}_${params.idPrefix}_${params.toolCallId}`,
    role: 'tool',
    content: params.content,
    toolCallId: params.toolCallId,
    toolCalls: [{ ...params.toolCall }],
    timestamp,
    ...(params.isError ? { isError: true } : {}),
  };
}
