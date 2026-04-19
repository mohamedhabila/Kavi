import type { Message, SubAgentSnapshot, ToolCall } from '../../types';
import { normalizeToolName } from '../../engine/tools/toolNameNormalization';

export function isDelegationToolName(toolName: string | undefined): boolean {
  const normalized = normalizeToolName(toolName || '')
    .trim()
    .toLowerCase();
  return normalized === 'sessions_spawn' || normalized === 'sessions_send';
}

function extractDelegatedSessionId(payload: string | undefined): string | undefined {
  if (typeof payload !== 'string' || !payload.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : '';
    return sessionId || undefined;
  } catch {
    return undefined;
  }
}

function hasDelegationToolResult(toolCall: Pick<ToolCall, 'name' | 'result'>): boolean {
  return isDelegationToolName(toolCall.name) && !!extractDelegatedSessionId(toolCall.result);
}

export function hasObservedDelegatedWork(params: {
  messages?: ReadonlyArray<Pick<Message, 'role' | 'content' | 'toolCalls' | 'subAgentEvent'>>;
  workers?: ReadonlyArray<Pick<SubAgentSnapshot, 'sessionId'>>;
}): boolean {
  if ((params.workers ?? []).some((worker) => worker.sessionId.trim().length > 0)) {
    return true;
  }

  return (params.messages ?? []).some((message) => {
    if (message.subAgentEvent?.snapshot.sessionId?.trim()) {
      return true;
    }

    if ((message.toolCalls ?? []).some((toolCall) => hasDelegationToolResult(toolCall))) {
      return true;
    }

    if (message.role !== 'tool') {
      return false;
    }

    return (message.toolCalls ?? []).some(
      (toolCall) =>
        isDelegationToolName(toolCall.name) && !!extractDelegatedSessionId(message.content),
    );
  });
}
