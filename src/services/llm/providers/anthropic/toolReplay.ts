import type { ChatCompletionMessage } from '../../support/contracts';
import { isPlainRecord, safeJsonParse } from '../../core/json';
import { readTrimmedString } from '../../core/toolCallNormalization';
import { normalizeAnthropicAssistantBlock, stringifyAnthropicContent } from './contentBlocks';

function getAnthropicAssistantBlocksFromProviderReplay(providerReplay: unknown): any[] | undefined {
  const replay = isPlainRecord(providerReplay) ? providerReplay : undefined;
  const assistantBlocks = Array.isArray(replay?.anthropicBlocks)
    ? replay.anthropicBlocks
    : undefined;

  return assistantBlocks && assistantBlocks.length > 0 ? assistantBlocks : undefined;
}

function replayedAnthropicAssistantBlocksCoverToolCalls(
  replayBlocks: unknown[],
  toolCalls: unknown[],
): boolean {
  const expectedToolUseIds = new Set<string>();

  if (Array.isArray(toolCalls)) {
    for (const toolCall of toolCalls) {
      const id = readTrimmedString((toolCall as any)?.id) ?? '';
      const name = readTrimmedString((toolCall as any)?.function?.name) ?? '';
      if (id && name) {
        expectedToolUseIds.add(id);
      }
    }
  }

  const normalizedReplayBlocks = replayBlocks
    .map((block) => normalizeAnthropicAssistantBlock(block))
    .filter((block): block is Record<string, any> => Boolean(block));

  if (normalizedReplayBlocks.length === 0) {
    return false;
  }

  if (
    normalizedReplayBlocks.some(
      (block) => block.type === 'thinking' && typeof block.signature !== 'string',
    )
  ) {
    return false;
  }

  if (expectedToolUseIds.size === 0) {
    return true;
  }

  const replayToolUseIds = new Set(
    normalizedReplayBlocks
      .filter((block) => block.type === 'tool_use' && typeof block.id === 'string')
      .map((block) => block.id as string),
  );

  if (replayToolUseIds.size === 0) {
    return false;
  }

  return Array.from(expectedToolUseIds).every((id) => replayToolUseIds.has(id));
}

export interface NormalizeAnthropicAssistantBlocksOptions {
  stripThinkingWithoutToolUse?: boolean;
}

function stripUnpairedAnthropicThinkingBlocks(blocks: any[]): any[] {
  if (blocks.some((block) => isPlainRecord(block) && block.type === 'tool_use')) {
    return blocks;
  }

  return blocks.filter(
    (block) =>
      !isPlainRecord(block) ||
      (block.type !== 'thinking' && block.type !== 'redacted_thinking'),
  );
}

export function normalizeAnthropicAssistantBlocks(
  message: ChatCompletionMessage,
  options: NormalizeAnthropicAssistantBlocksOptions = {},
): any[] {
  const contentBlocks: any[] = [];
  const seenToolUseIds = new Set<string>();
  const toolCalls = Array.isArray((message as any).tool_calls) ? (message as any).tool_calls : [];
  const hasToolCalls = toolCalls.some((toolCall: any) => {
    const id = readTrimmedString(toolCall?.id) ?? '';
    const name = readTrimmedString(toolCall?.function?.name) ?? '';
    return id.length > 0 && name.length > 0;
  });
  const replayBlocks = getAnthropicAssistantBlocksFromProviderReplay(
    (message as any).providerReplay,
  );
  const filteredReplayBlocks = Array.isArray(replayBlocks)
    ? replayBlocks.filter(
        (block) =>
          !options.stripThinkingWithoutToolUse ||
          !isPlainRecord(block) ||
          (block.type !== 'thinking' && block.type !== 'redacted_thinking') ||
          hasToolCalls,
      )
    : undefined;
  const canUseReplayBlocks =
    Array.isArray(filteredReplayBlocks) &&
    filteredReplayBlocks.length > 0 &&
    (hasToolCalls
      ? replayedAnthropicAssistantBlocksCoverToolCalls(filteredReplayBlocks, toolCalls)
      : true);

  const pushText = (value: unknown) => {
    const text = stringifyAnthropicContent(value);
    if (text.length > 0) {
      contentBlocks.push({ type: 'text', text });
    }
  };

  if (canUseReplayBlocks && Array.isArray(filteredReplayBlocks)) {
    for (const block of filteredReplayBlocks) {
      const normalizedBlock = normalizeAnthropicAssistantBlock(block);
      if (!normalizedBlock) {
        continue;
      }
      contentBlocks.push(normalizedBlock);
      if (normalizedBlock.type === 'tool_use' && typeof normalizedBlock.id === 'string') {
        seenToolUseIds.add(normalizedBlock.id);
      }
    }
  }

  if (contentBlocks.length === 0) {
    if (typeof message.content === 'string') {
      pushText(message.content);
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        const normalizedBlock = normalizeAnthropicAssistantBlock(block);
        if (!normalizedBlock) {
          continue;
        }
        contentBlocks.push(normalizedBlock);
        if (normalizedBlock.type === 'tool_use' && typeof normalizedBlock.id === 'string') {
          seenToolUseIds.add(normalizedBlock.id);
        }
      }
    } else if (message.content != null) {
      pushText(message.content);
    }
  }

  for (const toolCall of toolCalls) {
    const id = readTrimmedString(toolCall?.id) ?? '';
    const name = readTrimmedString(toolCall?.function?.name) ?? '';
    if (!id || !name || seenToolUseIds.has(id)) {
      continue;
    }

    const input = safeJsonParse(toolCall.function?.arguments);
    contentBlocks.push({
      type: 'tool_use',
      id,
      name,
      input: isPlainRecord(input) ? input : {},
    });
    seenToolUseIds.add(id);
  }

  const replaySafeBlocks = options.stripThinkingWithoutToolUse
    ? stripUnpairedAnthropicThinkingBlocks(contentBlocks)
    : contentBlocks;

  return replaySafeBlocks.filter(
    (block: any) =>
      !(block.type === 'text' && typeof block.text === 'string' && block.text.length === 0),
  );
}

function messageContainsAnthropicToolUse(message: ChatCompletionMessage): boolean {
  if (message.role !== 'assistant') {
    return false;
  }

  if (Array.isArray((message as any).tool_calls) && (message as any).tool_calls.length > 0) {
    return true;
  }

  if (!Array.isArray(message.content)) {
    return false;
  }

  return message.content.some((block) => isPlainRecord(block) && block.type === 'tool_use');
}

export function isAnthropicToolLoopInProgress(messages: ChatCompletionMessage[]): boolean {
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
    if (messageContainsAnthropicToolUse(message)) {
      return true;
    }
    if (message.role === 'assistant') {
      return false;
    }
  }

  return false;
}

function getAnthropicToolLoopAssistantBlocks(messages: ChatCompletionMessage[]): any[] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'system' || message.role === 'tool') {
      continue;
    }
    if (message.role === 'user') {
      return undefined;
    }
    if (message.role === 'assistant') {
      const blocks = normalizeAnthropicAssistantBlocks(message, {
        stripThinkingWithoutToolUse: true,
      });
      return blocks.some((block: any) => block?.type === 'tool_use') ? blocks : undefined;
    }
  }

  return undefined;
}

function isAnthropicReplayableThinkingBlock(block: unknown): boolean {
  if (!isPlainRecord(block)) {
    return false;
  }

  if (block.type === 'thinking') {
    return typeof block.signature === 'string' && block.signature.length > 0;
  }

  return (
    block.type === 'redacted_thinking' && typeof block.data === 'string' && block.data.length > 0
  );
}

export function canContinueAnthropicThinking(messages: ChatCompletionMessage[]): boolean {
  const assistantBlocks = getAnthropicToolLoopAssistantBlocks(messages);
  if (!assistantBlocks || assistantBlocks.length === 0) {
    return false;
  }

  return assistantBlocks.some((block: any) => isAnthropicReplayableThinkingBlock(block));
}

export function extractAnthropicReasoningText(assistantBlocks: any[]): string | undefined {
  const reasoningParts = assistantBlocks
    .map((block) =>
      isPlainRecord(block) &&
      block.type === 'thinking' &&
      typeof block.thinking === 'string' &&
      block.thinking.trim().length > 0
        ? block.thinking
        : '',
    )
    .filter((part) => part.length > 0);

  return reasoningParts.length > 0 ? reasoningParts.join('\n\n') : undefined;
}

export function buildAnthropicToolRaw(
  id: string,
  name: string,
  argumentsText: string,
): Record<string, any> {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: argumentsText,
    },
  };
}
