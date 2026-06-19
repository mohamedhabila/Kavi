import type { ChatCompletionMessage } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import {
  getOpenAIReasoningItemKey,
  getOpenAIReasoningItemsFromToolCalls,
  readReasoningReplayKey,
} from '../../core/reasoningExtraction';
import { readTrimmedString } from '../../core/toolCallNormalization';
import { toOpenAIResponsesMessageContent, toOpenAIResponsesText } from './content';

function extractOpenAIReplayFunctionCallIds(output: Record<string, any>[]): Set<string> {
  const ids = new Set<string>();

  for (const item of output) {
    if (item.type !== 'function_call') {
      continue;
    }

    const callId = readTrimmedString(item.call_id) ?? readTrimmedString(item.id) ?? '';
    if (callId) {
      ids.add(callId);
    }
  }

  return ids;
}

function getOpenAIReplayFunctionCallItems(output: Record<string, any>[]): Record<string, any>[] {
  return output.filter((item) => item.type === 'function_call');
}

function getOpenAIReplayInputContext(message: ChatCompletionMessage): Record<string, any>[] {
  return Array.isArray(message.providerReplay?.openaiResponseInputContext)
    ? message.providerReplay.openaiResponseInputContext.filter(
        (item: unknown): item is Record<string, any> => isPlainRecord(item),
      )
    : [];
}

function resolveOpenAIReplayFunctionCallId(item: Record<string, any>): string {
  return readTrimmedString(item.call_id) ?? readTrimmedString(item.id) ?? '';
}

function sanitizeOpenAIReplayInputItem(item: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = { ...item };
  const itemId = readTrimmedString(item.id);

  if (item.type === 'function_call' && !readTrimmedString(item.call_id) && itemId) {
    sanitized.call_id = itemId;
  }

  delete sanitized.id;

  if (Array.isArray(item.content)) {
    sanitized.content = item.content.map((part) =>
      isPlainRecord(part) ? sanitizeOpenAIReplayInputItem(part) : part,
    );
  }

  return sanitized;
}

function extractOpenAIReplayReasoningKeys(output: Record<string, any>[]): Set<string> {
  const keys = new Set<string>();

  for (const item of output) {
    if (item.type !== 'reasoning') {
      continue;
    }

    keys.add(readReasoningReplayKey(item));
  }

  return keys;
}

function replayedOpenAIOutputCoversToolCalls(
  replayOutput: Record<string, any>[],
  toolCalls: Record<string, any>[],
  options: { requireReasoningItemsForFunctionCalls?: boolean } = {},
): boolean {
  const replayFunctionCalls = getOpenAIReplayFunctionCallItems(replayOutput);
  if (toolCalls.length === 0 && replayFunctionCalls.length === 0) {
    return true;
  }

  const replayCallIds = extractOpenAIReplayFunctionCallIds(replayFunctionCalls);
  if (replayCallIds.size === 0) {
    return false;
  }

  const requiredReasoningItems = getOpenAIReasoningItemsFromToolCalls(toolCalls);
  const replayReasoningKeys =
    options.requireReasoningItemsForFunctionCalls || requiredReasoningItems.length > 0
      ? extractOpenAIReplayReasoningKeys(replayOutput)
      : undefined;

  if (options.requireReasoningItemsForFunctionCalls && replayFunctionCalls.length > 0) {
    if (!replayReasoningKeys || replayReasoningKeys.size === 0) {
      return false;
    }
  }

  if (requiredReasoningItems.length > 0) {
    if (!replayReasoningKeys || replayReasoningKeys.size === 0) {
      return false;
    }

    if (replayReasoningKeys.size === 0) {
      return false;
    }

    for (const reasoningItem of requiredReasoningItems) {
      if (!replayReasoningKeys.has(readReasoningReplayKey(reasoningItem))) {
        return false;
      }
    }
  }

  return toolCalls.every((toolCall) => {
    const item = buildOpenAIResponseFunctionCallItem(toolCall);
    return !!item && typeof item.call_id === 'string' && replayCallIds.has(item.call_id);
  });
}

export function buildOpenAIResponseFunctionCallItem(
  toolCall: Record<string, any>,
): Record<string, any> | null {
  const functionCall = isPlainRecord(toolCall.function) ? toolCall.function : undefined;
  const metadata = isPlainRecord(toolCall._openai) ? toolCall._openai : undefined;
  const name = readTrimmedString(functionCall?.name) ?? '';
  const callId = readTrimmedString(metadata?.callId) ?? readTrimmedString(toolCall.id) ?? '';

  if (!callId || !name) {
    return null;
  }

  const argumentsText =
    typeof functionCall?.arguments === 'string'
      ? functionCall.arguments
      : JSON.stringify(functionCall?.arguments ?? {});

  const item: Record<string, any> = {
    type: 'function_call',
    call_id: callId,
    name,
    arguments: argumentsText,
    status: 'completed',
  };

  const itemId = readTrimmedString(metadata?.itemId) ?? '';
  if (itemId) {
    item.id = itemId;
  }

  return item;
}

function getOpenAIAssistantFunctionCallIds(message: ChatCompletionMessage): Set<string> {
  const ids = new Set<string>();
  const toolCalls = Array.isArray((message as any).tool_calls)
    ? (message as any).tool_calls.filter((toolCall: unknown): toolCall is Record<string, any> =>
        isPlainRecord(toolCall),
      )
    : [];

  for (const toolCall of toolCalls) {
    const item = buildOpenAIResponseFunctionCallItem(toolCall);
    if (item?.call_id) {
      ids.add(item.call_id);
    }
  }

  const replayOutput = Array.isArray(message.providerReplay?.openaiResponseOutput)
    ? message.providerReplay.openaiResponseOutput.filter(
        (item: unknown): item is Record<string, any> => isPlainRecord(item),
      )
    : [];
  for (const item of getOpenAIReplayFunctionCallItems(replayOutput)) {
    const callId = resolveOpenAIReplayFunctionCallId(item);
    if (callId) {
      ids.add(callId);
    }
  }

  return ids;
}

function getFollowingToolOutputIds(
  messages: ChatCompletionMessage[],
  assistantIndex: number,
): Set<string> {
  const ids = new Set<string>();

  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'tool') {
      break;
    }

    const callId = readTrimmedString(message.tool_call_id) ?? '';
    if (callId) {
      ids.add(callId);
    }
  }

  return ids;
}

function areFunctionCallIdsSatisfied(
  functionCallIds: ReadonlySet<string>,
  toolOutputIds: ReadonlySet<string>,
): boolean {
  for (const callId of functionCallIds) {
    if (!toolOutputIds.has(callId)) {
      return false;
    }
  }
  return true;
}

export function buildOpenAIResponsesInput(
  messages: ChatCompletionMessage[],
  _model = '',
): {
  instructions?: string;
  input: Array<Record<string, any>>;
} {
  const instructionsParts: string[] = [];
  const input: Array<Record<string, any>> = [];
  const emittedReasoningItems = new Set<string>();
  const acceptedFunctionCallIds = new Set<string>();

  const hasMessageContent = (content: string | any[]): boolean => {
    if (typeof content === 'string') {
      return content.trim().length > 0;
    }
    return content.length > 0;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'system') {
      const text = toOpenAIResponsesText(message.content).trim();
      if (text.length > 0) {
        instructionsParts.push(text);
      }
      continue;
    }

    if (message.role === 'tool') {
      const callId = readTrimmedString(message.tool_call_id) ?? '';
      if (!callId) {
        continue;
      }
      if (!acceptedFunctionCallIds.has(callId)) {
        continue;
      }

      input.push({
        type: 'function_call_output',
        call_id: callId,
        output: toOpenAIResponsesText(message.content) || 'No output.',
      });
      continue;
    }

    const toolCalls =
      message.role === 'assistant' && Array.isArray((message as any).tool_calls)
        ? (message as any).tool_calls.filter((toolCall: unknown): toolCall is Record<string, any> =>
            isPlainRecord(toolCall),
          )
        : [];
    const replayOutput =
      message.role === 'assistant' && Array.isArray(message.providerReplay?.openaiResponseOutput)
        ? message.providerReplay.openaiResponseOutput.filter(
            (item: unknown): item is Record<string, any> => isPlainRecord(item),
          )
        : [];
    const replayFunctionCalls = getOpenAIReplayFunctionCallItems(replayOutput);
    const functionCallIds = getOpenAIAssistantFunctionCallIds(message);
    const functionCallsSatisfied =
      functionCallIds.size === 0 ||
      areFunctionCallIdsSatisfied(functionCallIds, getFollowingToolOutputIds(messages, index));

    if (message.role === 'assistant' && replayOutput.length > 0) {
      const canUseReplayOutput =
        functionCallsSatisfied &&
        replayOutput.length > 0 &&
        replayedOpenAIOutputCoversToolCalls(replayOutput, toolCalls);

      if (canUseReplayOutput) {
        for (const item of getOpenAIReplayInputContext(message)) {
          input.push(sanitizeOpenAIReplayInputItem(item));
        }

        for (const item of replayOutput) {
          if (item.type === 'reasoning') {
            const key = getOpenAIReasoningItemKey(item);
            if (emittedReasoningItems.has(key)) {
              continue;
            }
            emittedReasoningItems.add(key);
          }

          if (item.type === 'function_call') {
            const callId = resolveOpenAIReplayFunctionCallId(item);
            if (callId) {
              acceptedFunctionCallIds.add(callId);
            }
          }

          input.push(sanitizeOpenAIReplayInputItem(item));
        }
        continue;
      }
    }

    if (message.role === 'assistant' && toolCalls.length > 0 && functionCallsSatisfied) {
      const reasoningItems = getOpenAIReasoningItemsFromToolCalls(toolCalls);
      for (const item of reasoningItems) {
        const key = getOpenAIReasoningItemKey(item);
        if (emittedReasoningItems.has(key)) {
          continue;
        }
        emittedReasoningItems.add(key);
        input.push(item);
      }

      const assistantContent = toOpenAIResponsesMessageContent(message.content);
      if (hasMessageContent(assistantContent)) {
        input.push({ role: 'assistant', content: assistantContent });
      }

      for (const toolCall of toolCalls) {
        const item = buildOpenAIResponseFunctionCallItem(toolCall);
        if (item) {
          acceptedFunctionCallIds.add(item.call_id);
          input.push(item);
        }
      }
      continue;
    }

    if (message.role === 'assistant' && replayFunctionCalls.length > 0 && functionCallsSatisfied) {
      const assistantContent = toOpenAIResponsesMessageContent(message.content);
      if (hasMessageContent(assistantContent)) {
        input.push({ role: 'assistant', content: assistantContent });
      }

      for (const toolCall of replayFunctionCalls) {
        const callId = resolveOpenAIReplayFunctionCallId(toolCall);
        if (callId) {
          acceptedFunctionCallIds.add(callId);
        }
        input.push(sanitizeOpenAIReplayInputItem(toolCall));
      }
      continue;
    }

    const content = toOpenAIResponsesMessageContent(message.content);
    if (message.role === 'assistant' && !hasMessageContent(content)) {
      continue;
    }

    input.push({
      role: message.role,
      content,
    });
  }

  return {
    ...(instructionsParts.length > 0 ? { instructions: instructionsParts.join('\n\n') } : {}),
    input,
  };
}
