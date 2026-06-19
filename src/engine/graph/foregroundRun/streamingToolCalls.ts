import type { ToolCall } from '../../../types/message';
import { findMatchingToolCallIndexWithinMessage } from '../../../utils/toolCallMatching';

function isValidStreamingToolCall(toolCall: ToolCall | undefined): toolCall is ToolCall {
  return Boolean(toolCall?.id?.trim() && toolCall.name?.trim());
}

export function mergeForegroundStreamingToolCall(
  existingToolCalls: ToolCall[] | undefined,
  toolCall: ToolCall,
): ToolCall[] {
  if (!isValidStreamingToolCall(toolCall)) {
    return existingToolCalls ?? [];
  }

  const currentToolCalls = existingToolCalls ?? [];
  const existingIndex = findMatchingToolCallIndexWithinMessage(currentToolCalls, toolCall);
  const existingToolCall = existingIndex >= 0 ? currentToolCalls[existingIndex] : undefined;
  const mergedToolCall: ToolCall = {
    ...existingToolCall,
    ...toolCall,
    raw: toolCall.raw ?? existingToolCall?.raw,
    startedAt: toolCall.startedAt ?? existingToolCall?.startedAt,
    updatedAt: toolCall.updatedAt ?? existingToolCall?.updatedAt,
    completedAt: toolCall.completedAt ?? existingToolCall?.completedAt,
    progressText: toolCall.progressText ?? existingToolCall?.progressText,
    result: toolCall.result ?? existingToolCall?.result,
    error: toolCall.error ?? existingToolCall?.error,
  };

  if (existingIndex >= 0) {
    return currentToolCalls.map((candidate, index) =>
      index === existingIndex ? mergedToolCall : candidate,
    );
  }

  return [...currentToolCalls, mergedToolCall];
}

export function mergeForegroundStreamingToolCalls(
  existingToolCalls: ToolCall[] | undefined,
  toolCalls: ToolCall[],
): ToolCall[] {
  const validToolCalls = toolCalls.filter(isValidStreamingToolCall);
  return (
    validToolCalls.reduce<ToolCall[] | undefined>(
      (currentToolCalls, toolCall) => mergeForegroundStreamingToolCall(currentToolCalls, toolCall),
      existingToolCalls,
    ) ?? []
  );
}
