import type { Message } from '../../types/message';
import { buildToolResultPlaceholder, isToolResultPlaceholder } from '../../utils/toolResultSummary';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { compactResearchToolMessage } from './modelContextResearchCompaction';
import { compactSessionToolMessage } from './modelContextSessionCompaction';

const DEFAULT_RECENT_TOOL_RESULTS_TO_KEEP = 4;

function compactModelVisibleToolMessage(message: Message): Message {
  return compactResearchToolMessage(compactSessionToolMessage(message));
}

function compactHistoricalToolMessages(params: {
  messages: ReadonlyArray<Message>;
  recentToolResultsToKeep: number;
}): Message[] {
  const toolIndices: number[] = [];
  for (let index = 0; index < params.messages.length; index += 1) {
    const message = params.messages[index];
    if (message.role !== 'tool' || isToolResultPlaceholder(message.content)) {
      continue;
    }
    toolIndices.push(index);
  }

  if (toolIndices.length <= params.recentToolResultsToKeep) {
    return [...params.messages];
  }

  const compactedToolIndices = new Set(
    toolIndices.slice(0, toolIndices.length - params.recentToolResultsToKeep),
  );
  return params.messages.map((message, index) => {
    if (!compactedToolIndices.has(index)) {
      return message;
    }

    const toolName = normalizeToolName(message.toolCalls?.[0]?.name || message.toolCallId || '');
    return {
      ...message,
      content: buildToolResultPlaceholder('compacted', toolName || 'tool', message.content),
    };
  });
}

export function sanitizeModelVisibleWorkingMessages(
  messages: ReadonlyArray<Message>,
  options?: {
    compactHistoricalToolResults?: boolean;
    dropAssistantSubAgentEvents?: boolean;
    recentToolResultsToKeep?: number;
  },
): Message[] {
  const sanitized: Message[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (
      options?.dropAssistantSubAgentEvents &&
      message.role === 'assistant' &&
      message.subAgentEvent
    ) {
      continue;
    }

    sanitized.push(message.role === 'tool' ? compactModelVisibleToolMessage(message) : message);
  }

  if (options?.compactHistoricalToolResults !== true) {
    return sanitized;
  }

  return compactHistoricalToolMessages({
    messages: sanitized,
    recentToolResultsToKeep: Math.max(
      0,
      options?.recentToolResultsToKeep ?? DEFAULT_RECENT_TOOL_RESULTS_TO_KEEP,
    ),
  });
}
