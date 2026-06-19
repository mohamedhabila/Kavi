import type { Message, ToolCall } from '../types/message';
import { normalizeToolName } from './tools/index';
import { ensureToolResultPairing, deduplicateToolResults } from './toolResultPairingGuard';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
  raw?: Record<string, any>;
};

const SYNTHETIC_GEMINI_TOOL_CALL_ID_PATTERN = /^gemini-call-\d+(?:-[0-9a-f]{8})?(?:-\d+)?$/i;

function isSyntheticGeminiToolCallId(value: string): boolean {
  return SYNTHETIC_GEMINI_TOOL_CALL_ID_PATTERN.test(value.trim());
}

function hasToolCallId(toolCalls: ReadonlyArray<PendingToolCall>, id: string): boolean {
  return toolCalls.some((toolCall) => toolCall.id === id);
}

function resolveUniqueSyntheticToolCallId(
  pendingToolCalls: ReadonlyArray<PendingToolCall>,
  id: string,
): string {
  if (!isSyntheticGeminiToolCallId(id) || !hasToolCallId(pendingToolCalls, id)) {
    return id;
  }

  for (let suffix = pendingToolCalls.length; ; suffix += 1) {
    const candidate = `${id}-${suffix}`;
    if (!hasToolCallId(pendingToolCalls, candidate)) {
      return candidate;
    }
  }
}

function withToolCallId(toolCall: PendingToolCall, id: string): PendingToolCall {
  if (toolCall.id === id) {
    return toolCall;
  }

  const raw = toolCall.raw ? { ...toolCall.raw, id } : undefined;
  return {
    ...toolCall,
    id,
    ...(raw ? { raw } : {}),
  };
}

export function upsertPendingToolCall(
  pendingToolCalls: PendingToolCall[],
  nextToolCall: PendingToolCall,
): PendingToolCall {
  const normalizedName = normalizeToolName(nextToolCall.name);
  const rawToolCall =
    nextToolCall.raw && typeof nextToolCall.raw === 'object' && !Array.isArray(nextToolCall.raw)
      ? nextToolCall.raw
      : undefined;
  const rawFunction =
    rawToolCall?.function &&
    typeof rawToolCall.function === 'object' &&
    !Array.isArray(rawToolCall.function)
      ? rawToolCall.function
      : undefined;
  const normalizedToolCall = {
    ...nextToolCall,
    name: normalizedName,
    ...(rawToolCall
      ? {
          raw: {
            ...rawToolCall,
            function: {
              ...(rawFunction || {}),
              name: normalizedName,
              arguments:
                typeof rawFunction?.arguments === 'string'
                  ? rawFunction.arguments
                  : nextToolCall.arguments,
            },
          },
        }
      : {}),
  };
  const existingIndex = findMatchingToolCallIndexWithinMessage(
    pendingToolCalls,
    normalizedToolCall,
  );
  const nextNormalizedToolCall =
    existingIndex >= 0
      ? normalizedToolCall
      : withToolCallId(
          normalizedToolCall,
          resolveUniqueSyntheticToolCallId(pendingToolCalls, normalizedToolCall.id),
        );
  const existingToolCall = existingIndex >= 0 ? pendingToolCalls[existingIndex] : undefined;
  const mergedToolCall = {
    ...existingToolCall,
    ...nextNormalizedToolCall,
    raw: nextNormalizedToolCall.raw ?? existingToolCall?.raw,
  };

  if (existingIndex >= 0) {
    pendingToolCalls[existingIndex] = mergedToolCall;
  } else {
    pendingToolCalls.push(mergedToolCall);
  }

  return mergedToolCall;
}

export function repairModelVisibleToolResultTranscript(messages: Message[]): Message[] {
  return deduplicateToolResults(ensureToolResultPairing(messages));
}

export function getLastExecutedToolCall(messages: Message[]): ToolCall | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'tool' || !message.toolCalls?.length) {
      continue;
    }
    return message.toolCalls[message.toolCalls.length - 1];
  }
  return undefined;
}

export function collectRecentToolNames(messages: Message[], limit = 4): Set<string> {
  const recentToolNames = new Set<string>();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      break;
    }

    if (!message.toolCalls?.length) {
      continue;
    }

    for (let toolIndex = message.toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const normalizedName = normalizeToolName(message.toolCalls[toolIndex]?.name || '').trim();
      if (!normalizedName) {
        continue;
      }
      recentToolNames.add(normalizedName);
      if (recentToolNames.size >= limit) {
        return recentToolNames;
      }
    }
  }

  return recentToolNames;
}

export function isToolLoopInProgress(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'system') {
      continue;
    }
    if (message.role === 'user') {
      return false;
    }
    if (message.role === 'tool') {
      return true;
    }
    if (message.role === 'assistant') {
      return (message.toolCalls?.length || 0) > 0;
    }
  }

  return false;
}
