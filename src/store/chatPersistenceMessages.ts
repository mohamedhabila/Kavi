import type { Message, MessageProviderReplay, ToolCall } from '../types/message';
import type { SubAgentActivityEntry, SubAgentSnapshot } from '../types/subAgent';
import { stripAttachmentPayload } from '../utils/messageAttachments';
import {
  MAX_PERSISTED_ENRICHED_CONTENT_CHARS,
  MAX_PERSISTED_LIST_ITEMS,
  MAX_PERSISTED_LOG_DETAIL_CHARS,
  MAX_PERSISTED_LOG_TITLE_CHARS,
  MAX_PERSISTED_REASONING_CHARS,
  MAX_PERSISTED_SUB_AGENT_ACTIVITY_ENTRIES,
  MAX_PERSISTED_SUB_AGENT_ACTIVITY_TEXT_CHARS,
  MAX_PERSISTED_SUB_AGENT_OUTPUT_CHARS,
  MAX_PERSISTED_TOOL_ARGUMENT_CHARS,
  MAX_PERSISTED_TOOL_CONTENT_CHARS,
  MAX_PERSISTED_TOOL_ERROR_CHARS,
  MAX_PERSISTED_TOOL_PROGRESS_CHARS,
  MAX_PERSISTED_TOOL_RESULT_CHARS,
  MAX_PERSISTED_USER_CONTENT_CHARS,
} from './chatPersistenceLimits';
import {
  clonePlainRecord,
  clonePlainRecordArray,
  isPlainRecord,
  normalizeText,
  truncateText,
} from './chatPersistencePrimitives';
import { compactPersistedToolContent } from './persistedToolContent';

function sanitizeProviderReplay(
  providerReplay: MessageProviderReplay | undefined,
): MessageProviderReplay | undefined {
  if (!isPlainRecord(providerReplay)) {
    return undefined;
  }

  const openaiResponseId =
    typeof providerReplay.openaiResponseId === 'string' &&
    providerReplay.openaiResponseId.trim().length > 0
      ? providerReplay.openaiResponseId.trim()
      : undefined;
  const openaiResponseInputContext = clonePlainRecordArray(
    providerReplay.openaiResponseInputContext,
  );
  const openaiResponseOutput = clonePlainRecordArray(providerReplay.openaiResponseOutput);
  const geminiParts = clonePlainRecordArray(providerReplay.geminiParts);
  const anthropicBlocks = clonePlainRecordArray(providerReplay.anthropicBlocks);

  if (
    !openaiResponseId &&
    !openaiResponseInputContext &&
    !openaiResponseOutput &&
    !geminiParts &&
    !anthropicBlocks
  ) {
    return undefined;
  }

  return {
    ...(openaiResponseId ? { openaiResponseId } : {}),
    ...(openaiResponseInputContext ? { openaiResponseInputContext } : {}),
    ...(openaiResponseOutput ? { openaiResponseOutput } : {}),
    ...(geminiParts ? { geminiParts } : {}),
    ...(anthropicBlocks ? { anthropicBlocks } : {}),
  };
}

function sanitizeToolCall(toolCall: ToolCall, preserveRaw: boolean): ToolCall {
  const raw = preserveRaw ? clonePlainRecord(toolCall.raw) : undefined;

  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: truncateText(toolCall.arguments, MAX_PERSISTED_TOOL_ARGUMENT_CHARS) || '{}',
    ...(raw ? { raw } : {}),
    status: toolCall.status,
    ...(toolCall.startedAt !== undefined ? { startedAt: toolCall.startedAt } : {}),
    ...(toolCall.updatedAt !== undefined ? { updatedAt: toolCall.updatedAt } : {}),
    ...(toolCall.completedAt !== undefined ? { completedAt: toolCall.completedAt } : {}),
    ...(toolCall.progressText
      ? { progressText: truncateText(toolCall.progressText, MAX_PERSISTED_TOOL_PROGRESS_CHARS) }
      : {}),
    ...(toolCall.result
      ? { result: truncateText(toolCall.result, MAX_PERSISTED_TOOL_RESULT_CHARS) }
      : {}),
    ...(toolCall.error
      ? { error: truncateText(toolCall.error, MAX_PERSISTED_TOOL_ERROR_CHARS) }
      : {}),
  };
}

function sanitizeSubAgentActivity(entry: SubAgentActivityEntry): SubAgentActivityEntry {
  return {
    timestamp: entry.timestamp,
    kind: entry.kind,
    text: truncateText(entry.text, MAX_PERSISTED_SUB_AGENT_ACTIVITY_TEXT_CHARS) || entry.text,
  };
}

function sanitizeSubAgentSnapshot(snapshot: SubAgentSnapshot): SubAgentSnapshot {
  return {
    ...snapshot,
    ...(snapshot.name ? { name: truncateText(snapshot.name, MAX_PERSISTED_LOG_TITLE_CHARS) } : {}),
    ...(snapshot.output
      ? { output: truncateText(snapshot.output, MAX_PERSISTED_SUB_AGENT_OUTPUT_CHARS) }
      : {}),
    ...(snapshot.toolsUsed
      ? { toolsUsed: snapshot.toolsUsed.slice(-MAX_PERSISTED_LIST_ITEMS) }
      : {}),
    ...(snapshot.currentActivity
      ? {
          currentActivity: truncateText(
            snapshot.currentActivity,
            MAX_PERSISTED_SUB_AGENT_ACTIVITY_TEXT_CHARS,
          ),
        }
      : {}),
    ...(snapshot.activeToolName
      ? { activeToolName: truncateText(snapshot.activeToolName, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(snapshot.lastToolResultPreview
      ? {
          lastToolResultPreview: truncateText(
            snapshot.lastToolResultPreview,
            MAX_PERSISTED_LOG_DETAIL_CHARS,
          ),
        }
      : {}),
    ...(snapshot.activityLog
      ? {
          activityLog: snapshot.activityLog
            .slice(-MAX_PERSISTED_SUB_AGENT_ACTIVITY_ENTRIES)
            .map((entry) => sanitizeSubAgentActivity(entry)),
        }
      : {}),
    ...(snapshot.artifacts
      ? { artifacts: snapshot.artifacts.map((attachment) => stripAttachmentPayload(attachment)) }
      : {}),
  };
}

function getMessageContentLimit(message: Message): number {
  if (message.role === 'tool') {
    return MAX_PERSISTED_TOOL_CONTENT_CHARS;
  }

  return MAX_PERSISTED_USER_CONTENT_CHARS;
}

function sanitizeMessageContent(message: Message): string {
  if (message.role === 'assistant') {
    return normalizeText(message.content) || '';
  }

  if (message.role === 'tool') {
    return compactPersistedToolContent(message.content, getMessageContentLimit(message)) || '';
  }

  return truncateText(message.content, getMessageContentLimit(message)) || '';
}

export function sanitizeMessage(
  message: Message,
  options: { preserveReplay: boolean; preserveReasoning: boolean },
): Message {
  const providerReplay = options.preserveReplay
    ? sanitizeProviderReplay(message.providerReplay)
    : undefined;

  return {
    id: message.id,
    role: message.role,
    content: sanitizeMessageContent(message),
    timestamp: message.timestamp,
    ...(message.enrichedContent
      ? {
          enrichedContent: truncateText(
            message.enrichedContent,
            MAX_PERSISTED_ENRICHED_CONTENT_CHARS,
          ),
        }
      : {}),
    ...(message.toolCalls?.length
      ? {
          toolCalls: message.toolCalls.map((toolCall) =>
            sanitizeToolCall(toolCall, options.preserveReplay),
          ),
        }
      : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments?.length
      ? { attachments: message.attachments.map((attachment) => stripAttachmentPayload(attachment)) }
      : {}),
    ...(message.isError ? { isError: true } : {}),
    ...(options.preserveReasoning && message.reasoning
      ? { reasoning: truncateText(message.reasoning, MAX_PERSISTED_REASONING_CHARS) }
      : {}),
    ...(providerReplay ? { providerReplay } : {}),
    ...(message.assistantMetadata ? { assistantMetadata: { ...message.assistantMetadata } } : {}),
    ...(message.effectId ? { effectId: message.effectId } : {}),
    ...(message.subAgentEvent
      ? {
          subAgentEvent: {
            ...message.subAgentEvent,
            snapshot: sanitizeSubAgentSnapshot(message.subAgentEvent.snapshot),
          },
        }
      : {}),
  };
}
