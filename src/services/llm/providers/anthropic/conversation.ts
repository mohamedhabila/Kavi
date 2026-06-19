import {
  filterNonEmptyHistory,
  pushNormalizedHistoryMessage,
} from '../../core/conversationHistory';
import { isPlainRecord } from '../../core/json';
import { allIdsPresent, collectIds, readTrimmedString } from '../../core/toolCallNormalization';
import {
  anthropicContentIsEmpty,
  anthropicContentToBlocks,
  mergeAnthropicAssistantContent,
  mergeAnthropicContent,
  orderAnthropicUserBlocks,
} from './contentBlocks';

function collectAnthropicToolUseIds(content: string | any[]): Set<string> {
  return collectIds(anthropicContentToBlocks(content), (block) =>
    isPlainRecord(block) && block.type === 'tool_use' ? readTrimmedString(block.id) : undefined,
  );
}

function collectAnthropicToolResultIds(content: string | any[]): Set<string> {
  return collectIds(anthropicContentToBlocks(content), (block) =>
    isPlainRecord(block) && block.type === 'tool_result'
      ? readTrimmedString(block.tool_use_id)
      : undefined,
  );
}

function stripAnthropicToolUseBlocks(content: string | any[]): string | any[] {
  const blocks = anthropicContentToBlocks(content).filter(
    (block) => !isPlainRecord(block) || block.type !== 'tool_use',
  );

  if (blocks.length === 0) {
    return '';
  }

  return blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0].text : blocks;
}

function filterAnthropicUserToolResults(
  content: string | any[],
  allowedToolUseIds?: Set<string>,
): string | any[] {
  const blocks = anthropicContentToBlocks(content).filter((block) => {
    if (!isPlainRecord(block) || block.type !== 'tool_result') {
      return true;
    }

    const toolUseId = readTrimmedString(block.tool_use_id) ?? '';
    return !!allowedToolUseIds && toolUseId.length > 0 && allowedToolUseIds.has(toolUseId);
  });

  const orderedBlocks = orderAnthropicUserBlocks(blocks);
  if (orderedBlocks.length === 0) {
    return '';
  }

  return orderedBlocks.length === 1 && orderedBlocks[0]?.type === 'text'
    ? orderedBlocks[0].text
    : orderedBlocks;
}

export function normalizeAnthropicConversationHistory(
  messages: Array<{ role: string; content: string | any[] }>,
): Array<{ role: string; content: string | any[] }> {
  const normalized: Array<{ role: string; content: string | any[] }> = [];
  let pendingToolUseIds: Set<string> | null = null;
  let pendingAssistantIndex = -1;

  const pushMessage = (message: { role: string; content: string | any[] }) => {
    pushNormalizedHistoryMessage(normalized, message, {
      isEmptyContent: anthropicContentIsEmpty,
      mergeContent: (existing, incoming, role) =>
        role === 'assistant'
          ? mergeAnthropicAssistantContent(existing, incoming)
          : mergeAnthropicContent(existing, incoming),
    });
  };

  const stripPendingAssistantToolUse = () => {
    if (pendingAssistantIndex < 0 || !pendingToolUseIds || pendingToolUseIds.size === 0) {
      pendingToolUseIds = null;
      pendingAssistantIndex = -1;
      return;
    }

    const assistantMessage = normalized[pendingAssistantIndex];
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      pendingToolUseIds = null;
      pendingAssistantIndex = -1;
      return;
    }

    assistantMessage.content = stripAnthropicToolUseBlocks(assistantMessage.content);
    if (anthropicContentIsEmpty(assistantMessage.content)) {
      normalized.splice(pendingAssistantIndex, 1);
    }

    pendingToolUseIds = null;
    pendingAssistantIndex = -1;
  };

  for (const message of messages) {
    if (message.role === 'assistant') {
      if (pendingToolUseIds) {
        stripPendingAssistantToolUse();
      }

      pushMessage({ ...message });

      const toolUseIds = collectAnthropicToolUseIds(message.content);
      if (toolUseIds.size > 0) {
        pendingToolUseIds = toolUseIds;
        pendingAssistantIndex = normalized.length - 1;
      }
      continue;
    }

    if (message.role === 'user') {
      if (pendingToolUseIds && pendingToolUseIds.size > 0) {
        const filteredContent = filterAnthropicUserToolResults(message.content, pendingToolUseIds);
        const matchedToolResultIds = collectAnthropicToolResultIds(filteredContent);
        const isSatisfied = allIdsPresent(pendingToolUseIds, matchedToolResultIds);

        if (!isSatisfied) {
          stripPendingAssistantToolUse();
          pushMessage({
            ...message,
            content: filterAnthropicUserToolResults(message.content),
          });
        } else {
          pushMessage({ ...message, content: filteredContent });
          pendingToolUseIds = null;
          pendingAssistantIndex = -1;
        }
        continue;
      }

      pushMessage({
        ...message,
        content: filterAnthropicUserToolResults(message.content),
      });
      continue;
    }

    if (pendingToolUseIds) {
      stripPendingAssistantToolUse();
    }
    pushMessage({ ...message });
  }

  if (pendingToolUseIds) {
    stripPendingAssistantToolUse();
  }

  return filterNonEmptyHistory(normalized, anthropicContentIsEmpty);
}
