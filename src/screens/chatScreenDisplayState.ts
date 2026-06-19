import {
  buildDisplayMessages,
  getMessageDisplayAttachments,
  mergeAssistantMessages,
  type DisplayMessageItem,
  type DisplayResponseSegment,
} from '../components/chat/messageGrouping';
import { reconcileAssistantMessagesWithToolResults } from '../components/chat/messageProjectionReconciliation';
import { resolveDisplayedSubAgentSnapshot } from '../services/agents/lifecycle/stateMachine';
import { AgentRun } from '../types/agentRun';
import { Message, ToolCall } from '../types/message';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';
import {
  filterVisibleAssistantMessagesForAgentRun,
  findAgentRunDisplayAnchorMessageId,
  isRenderableDisplayMessage,
} from './chatScreen/displayProjection';

export type StreamingDraft = {
  content?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  effectId?: Message['effectId'];
};

export type ResolvedDisplayMessageItem = DisplayMessageItem & {
  resolvedMessage: Message;
  resolvedResponseSegments?: Array<DisplayResponseSegment & { isStreaming: boolean }>;
  isStreaming: boolean;
  agentRun?: AgentRun;
};

type StableDisplayMessageCacheEntry = {
  item: DisplayMessageItem;
  sourceSignatures: string[];
};

type ResolvedDisplayMessageCacheEntry = {
  item: ResolvedDisplayMessageItem;
  sourceSignatures: string[];
  draftSignature: string;
  isStreaming: boolean;
  retryMessageId?: string;
  agentRunSignature: string;
  liveSubAgentSignature: string;
};

export const INITIAL_CHAT_SOURCE_MESSAGE_LIMIT = 80;
export const CHAT_SOURCE_MESSAGE_PAGE_SIZE = 80;

export interface ChatDisplayStateCache {
  stableDisplayMessages: Map<string, StableDisplayMessageCacheEntry>;
  resolvedDisplayMessages: Map<string, ResolvedDisplayMessageCacheEntry>;
}

export function createChatDisplayStateCache(): ChatDisplayStateCache {
  return {
    stableDisplayMessages: new Map(),
    resolvedDisplayMessages: new Map(),
  };
}

export function clearChatDisplayStateCache(cache: ChatDisplayStateCache): void {
  cache.stableDisplayMessages.clear();
  cache.resolvedDisplayMessages.clear();
}

function resolveStreamingDraftContent(
  draft: StreamingDraft | undefined,
  persistedContent: string,
): string {
  if (typeof draft?.content === 'string' && draft.content.length > 0) {
    return draft.content;
  }

  return persistedContent;
}

function isValidStreamingToolCall(toolCall: ToolCall | undefined): toolCall is ToolCall {
  return Boolean(toolCall?.id?.trim() && toolCall?.name?.trim());
}

function buildStreamingDraftToolCallSignature(toolCall: ToolCall): string {
  return [
    toolCall.id,
    toolCall.name,
    toolCall.status,
    toolCall.arguments,
    toolCall.startedAt ?? '',
    toolCall.updatedAt ?? '',
    toolCall.completedAt ?? '',
    toolCall.progressText ?? '',
    toolCall.result ?? '',
    toolCall.error ?? '',
  ].join('\u0001');
}

export function buildStreamingDraftSignature(draft: StreamingDraft | undefined): string {
  if (!draft) {
    return '';
  }

  const validToolCalls = draft.toolCalls?.filter(isValidStreamingToolCall) ?? [];

  return [
    draft.content ?? '',
    draft.reasoning ?? '',
    draft.effectId ?? '',
    validToolCalls.map(buildStreamingDraftToolCallSignature).join('\u0002'),
  ].join('\u0003');
}

export function normalizeStreamingDraft(
  draft: StreamingDraft | undefined,
): StreamingDraft | undefined {
  if (!draft) {
    return undefined;
  }

  const nextDraft: StreamingDraft = {};
  const hasReasoning = typeof draft.reasoning === 'string' && draft.reasoning.length > 0;
  const validToolCalls = draft.toolCalls?.filter(isValidStreamingToolCall) ?? [];
  const hasToolCalls = validToolCalls.length > 0;
  const hasEffect = !!draft.effectId;

  if (
    typeof draft.content === 'string' &&
    (draft.content.length > 0 || hasReasoning || hasToolCalls || hasEffect)
  ) {
    nextDraft.content = draft.content;
  }
  if (hasReasoning) {
    nextDraft.reasoning = draft.reasoning;
  }
  if (hasToolCalls) {
    nextDraft.toolCalls = validToolCalls;
  }
  if (hasEffect) {
    nextDraft.effectId = draft.effectId;
  }

  return Object.keys(nextDraft).length > 0 ? nextDraft : undefined;
}

export function mergeStreamingToolCall(
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

export function mergeStreamingToolCalls(
  existingToolCalls: ToolCall[] | undefined,
  toolCalls: ToolCall[],
): ToolCall[] {
  const validToolCalls = toolCalls.filter(isValidStreamingToolCall);
  return (
    validToolCalls.reduce<ToolCall[] | undefined>(
      (currentToolCalls, toolCall) => mergeStreamingToolCall(currentToolCalls, toolCall),
      existingToolCalls,
    ) ?? []
  );
}

function resolveStreamingDraftMessage(
  sourceMessage: Message,
  draft: StreamingDraft | undefined,
): Message {
  if (!draft) {
    return sourceMessage;
  }

  const resolvedMessage: Message = {
    ...sourceMessage,
    content: resolveStreamingDraftContent(draft, sourceMessage.content),
    reasoning: draft.reasoning ?? sourceMessage.reasoning,
    toolCalls: draft.toolCalls?.length ? draft.toolCalls : sourceMessage.toolCalls,
    effectId: draft.effectId ?? sourceMessage.effectId,
  };

  return {
    ...resolvedMessage,
    attachments: getMessageDisplayAttachments(resolvedMessage),
  };
}

function buildSourceMessages(
  messageById: ReadonlyMap<string, Message>,
  sourceMessageIds: string[],
): Message[] {
  return sourceMessageIds
    .map((sourceMessageId) => messageById.get(sourceMessageId))
    .filter((message): message is Message => !!message);
}

function getProjectionSourceMessageIds(item: DisplayMessageItem): string[] {
  return item.projectionSourceMessageIds ?? item.sourceMessageIds;
}

function hashText(value: string | undefined): string {
  if (!value) {
    return '0:0';
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

function buildAttachmentDisplaySignature(
  attachment: NonNullable<Message['attachments']>[number],
): string {
  return [
    attachment.id,
    attachment.type,
    attachment.uri,
    attachment.name,
    attachment.mimeType,
    attachment.size,
    attachment.workspacePath ?? '',
    attachment.durationMs ?? '',
    hashText(attachment.transcript),
    attachment.waveformLevels?.join(',') ?? '',
  ].join('\u0006');
}

function buildToolCallDisplaySignature(toolCall: ToolCall): string {
  return [
    toolCall.id,
    toolCall.name,
    hashText(toolCall.arguments),
    toolCall.status,
    toolCall.startedAt ?? '',
    toolCall.updatedAt ?? '',
    toolCall.completedAt ?? '',
    hashText(toolCall.progressText),
    hashText(toolCall.result),
    hashText(toolCall.error),
  ].join('\u0006');
}

function buildSubAgentEventDisplaySignature(message: Message): string {
  const event = message.subAgentEvent;
  if (!event) {
    return '';
  }

  const snapshot = event.snapshot;
  return [
    event.type,
    event.event,
    snapshot.sessionId,
    snapshot.parentConversationId,
    snapshot.parentSessionId ?? '',
    snapshot.agentRunId ?? '',
    snapshot.workstreamId ?? '',
    snapshot.name ?? '',
    snapshot.depth,
    snapshot.startedAt,
    snapshot.updatedAt,
    snapshot.deadlineAt ?? '',
    snapshot.status,
    snapshot.sandboxPolicy,
    snapshot.launchState ?? '',
    hashText(snapshot.output),
    snapshot.toolsUsed?.join('\u0007') ?? '',
    snapshot.iterations ?? '',
    snapshot.lastProgressAt ?? '',
    snapshot.modelResponsePendingSince ?? '',
    hashText(snapshot.currentActivity),
    snapshot.activeToolName ?? '',
    snapshot.activeToolStartedAt ?? '',
    hashText(snapshot.lastToolResultPreview),
    snapshot.activityLog
      ?.map((entry) => [entry.timestamp, entry.kind, hashText(entry.text)].join('\u0008'))
      .join('\u0009') ?? '',
    snapshot.artifacts?.map(buildAttachmentDisplaySignature).join('\u0009') ?? '',
  ].join('\u0006');
}

function buildMessageDisplaySignature(message: Message): string {
  return [
    message.id,
    message.role,
    message.timestamp,
    message.toolCallId ?? '',
    message.isError ? '1' : '0',
    hashText(message.content),
    hashText(message.enrichedContent),
    hashText(message.reasoning),
    message.assistantMetadata
      ? [
          message.assistantMetadata.kind,
          message.assistantMetadata.completionStatus,
          message.assistantMetadata.finishReason ?? '',
        ].join('\u0007')
      : '',
    message.effectId ?? '',
    message.attachments?.map(buildAttachmentDisplaySignature).join('\u0007') ?? '',
    message.toolCalls?.map(buildToolCallDisplaySignature).join('\u0007') ?? '',
    buildSubAgentEventDisplaySignature(message),
  ].join('\u0005');
}

function buildSourceSignatures(messages: Message[]): string[] {
  return messages.map(buildMessageDisplaySignature);
}

function areSignatureListsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((signature, index) => signature === right[index])
  );
}

function getVisibleSourceMessageStartIndex(messages: Message[], limit: number): number {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (messages.length <= normalizedLimit) {
    return 0;
  }

  let startIndex = messages.length - normalizedLimit;
  while (startIndex > 0 && messages[startIndex]?.role !== 'user') {
    startIndex -= 1;
  }

  return startIndex;
}

export function getVisibleSourceMessageWindow(
  messages: Message[],
  limit: number,
): { visibleMessages: Message[]; hiddenSourceMessageCount: number } {
  const startIndex = getVisibleSourceMessageStartIndex(messages, limit);
  return {
    visibleMessages: startIndex === 0 ? messages : messages.slice(startIndex),
    hiddenSourceMessageCount: startIndex,
  };
}

function buildAgentRunSignature(agentRun?: AgentRun): string {
  if (!agentRun) {
    return '';
  }

  return [
    agentRun.id,
    agentRun.updatedAt,
    agentRun.status,
    agentRun.currentPhase,
    agentRun.latestSummary ?? '',
    agentRun.checkpoints.length,
  ].join(':');
}

function buildLiveSubAgentSignature(
  item: DisplayMessageItem,
  liveSubAgentSnapshotsById: ReadonlyMap<string, NonNullable<Message['subAgentEvent']>['snapshot']>,
): string {
  return (
    item.responseSegments
      ?.map((segment) => {
        if (!segment.subAgentEvent) {
          return '';
        }

        const liveSnapshot = resolveDisplayedSubAgentSnapshot(
          segment.subAgentEvent.snapshot,
          liveSubAgentSnapshotsById.get(segment.subAgentEvent.snapshot.sessionId),
        );

        return [
          liveSnapshot.sessionId,
          liveSnapshot.updatedAt,
          liveSnapshot.status,
          liveSnapshot.currentActivity ?? '',
          liveSnapshot.activeToolName ?? '',
          liveSnapshot.lastToolResultPreview ?? '',
          liveSnapshot.iterations ?? 0,
          liveSnapshot.toolsUsed?.length ?? 0,
        ].join(':');
      })
      .join('|') ?? ''
  );
}

export function buildAgentRunDisplayItemMap(
  messages: Message[],
  displayMessages: DisplayMessageItem[],
  agentRuns: AgentRun[],
): Map<string, AgentRun> {
  if (!messages.length || !displayMessages.length || !agentRuns.length) {
    return new Map();
  }

  const displayItemIdBySourceMessageId = new Map<string, string>();
  for (const item of displayMessages) {
    if (item.message.role !== 'assistant') {
      continue;
    }

    for (const sourceMessageId of item.sourceMessageIds) {
      displayItemIdBySourceMessageId.set(sourceMessageId, item.id);
    }
  }

  const nextMap = new Map<string, AgentRun>();
  for (const run of agentRuns) {
    const anchorMessageId = findAgentRunDisplayAnchorMessageId(messages, run);
    if (!anchorMessageId) {
      continue;
    }

    const displayItemId = displayItemIdBySourceMessageId.get(anchorMessageId);
    if (!displayItemId) {
      continue;
    }

    const existingRun = nextMap.get(displayItemId);
    if (!existingRun || existingRun.updatedAt <= run.updatedAt) {
      nextMap.set(displayItemId, run);
    }
  }

  return nextMap;
}

export function getStableDisplayMessages(
  messages: Message[],
  cache: ChatDisplayStateCache,
): DisplayMessageItem[] {
  const rawItems = buildDisplayMessages(messages.filter(isRenderableDisplayMessage));
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const nextCache = new Map<string, StableDisplayMessageCacheEntry>();

  const stableItems = rawItems.map((item) => {
    const sourceMessages = buildSourceMessages(messageById, getProjectionSourceMessageIds(item));
    const sourceSignatures = buildSourceSignatures(sourceMessages);
    const cached = cache.stableDisplayMessages.get(item.id);

    if (
      cached &&
      cached.item.retryMessageId === item.retryMessageId &&
      areSignatureListsEqual(cached.sourceSignatures, sourceSignatures)
    ) {
      nextCache.set(item.id, cached);
      return cached.item;
    }

    const nextEntry = { item, sourceSignatures };
    nextCache.set(item.id, nextEntry);
    return item;
  });

  cache.stableDisplayMessages = nextCache;
  return stableItems;
}

export function resolveDisplayMessages(params: {
  displayMessages: DisplayMessageItem[];
  messageById: ReadonlyMap<string, Message>;
  cache: ChatDisplayStateCache;
  streamingDrafts: Record<string, StreamingDraft>;
  streamingMessageId: string | null;
  liveSubAgentSnapshotsById: ReadonlyMap<string, NonNullable<Message['subAgentEvent']>['snapshot']>;
  agentRunByDisplayItemId: ReadonlyMap<string, AgentRun>;
}): ResolvedDisplayMessageItem[] {
  const {
    agentRunByDisplayItemId,
    cache,
    displayMessages,
    liveSubAgentSnapshotsById,
    messageById,
    streamingDrafts,
    streamingMessageId,
  } = params;
  const nextCache = new Map<string, ResolvedDisplayMessageCacheEntry>();

  const resolvedItems = displayMessages
    .map((item) => {
      const projectionSourceMessages = buildSourceMessages(
        messageById,
        getProjectionSourceMessageIds(item),
      );
      const sourceSignatures = buildSourceSignatures(projectionSourceMessages);
      const sourceMessages = buildSourceMessages(messageById, item.sourceMessageIds);
      const agentRun = agentRunByDisplayItemId.get(item.id);
      const isStreaming =
        !!streamingMessageId && item.sourceMessageIds.includes(streamingMessageId);
      const draftSignature = isStreaming
        ? item.sourceMessageIds
            .map(
              (sourceMessageId) =>
                `${sourceMessageId}:${buildStreamingDraftSignature(
                  streamingDrafts[sourceMessageId],
                )}`,
            )
            .join('|')
        : '';
      const agentRunSignature = buildAgentRunSignature(agentRun);
      const liveSubAgentSignature = buildLiveSubAgentSignature(item, liveSubAgentSnapshotsById);
      const cached = cache.resolvedDisplayMessages.get(item.id);

      if (
        cached &&
        cached.retryMessageId === item.retryMessageId &&
        cached.isStreaming === isStreaming &&
        cached.draftSignature === draftSignature &&
        cached.agentRunSignature === agentRunSignature &&
        cached.liveSubAgentSignature === liveSubAgentSignature &&
        areSignatureListsEqual(cached.sourceSignatures, sourceSignatures)
      ) {
        nextCache.set(item.id, cached);
        return cached.item;
      }

      const resolvedSourceMessages = sourceMessages.map((sourceMessage) => {
        const draft = streamingDrafts[sourceMessage.id];
        if (!draft) {
          return sourceMessage;
        }

        return resolveStreamingDraftMessage(sourceMessage, draft);
      });
      const resolvedProjectionSourceMessages = projectionSourceMessages.map((sourceMessage) => {
        const draft = streamingDrafts[sourceMessage.id];
        return draft ? resolveStreamingDraftMessage(sourceMessage, draft) : sourceMessage;
      });
      const resolvedAssistantMessages =
        item.message.role === 'assistant'
          ? reconcileAssistantMessagesWithToolResults(
              resolvedSourceMessages,
              resolvedProjectionSourceMessages,
            )
          : resolvedSourceMessages;
      const visibleAssistantMessages =
        item.message.role === 'assistant'
          ? filterVisibleAssistantMessagesForAgentRun(resolvedAssistantMessages, agentRun)
          : resolvedAssistantMessages;
      const resolvedSourceMessageById = new Map(
        visibleAssistantMessages.map((message) => [message.id, message]),
      );

      if (item.message.role === 'assistant' && visibleAssistantMessages.length === 0) {
        return null;
      }

      let resolvedMessage = item.message;
      if (item.message.role === 'assistant' && visibleAssistantMessages.length > 0) {
        resolvedMessage =
          visibleAssistantMessages.length === 1
            ? visibleAssistantMessages[0]
            : mergeAssistantMessages(visibleAssistantMessages);
      }

      const latestSubAgentSegmentIndexBySessionId = new Map<string, number>();
      item.responseSegments?.forEach((segment, index) => {
        const sessionId = (
          resolvedSourceMessageById.get(segment.messageId)?.subAgentEvent?.snapshot.sessionId ??
          segment.subAgentEvent?.snapshot.sessionId
        )?.trim();
        if (sessionId) {
          latestSubAgentSegmentIndexBySessionId.set(sessionId, index);
        }
      });

      const resolvedResponseSegments = item.responseSegments?.map((segment, index) => {
        const resolvedSourceMessage = resolvedSourceMessageById.get(segment.messageId);
        const resolvedAttachments = resolvedSourceMessage
          ? getMessageDisplayAttachments(resolvedSourceMessage)
          : segment.attachments;
        const persistedSubAgentSnapshot =
          resolvedSourceMessage?.subAgentEvent?.snapshot ?? segment.subAgentEvent?.snapshot;
        const shouldMergeLiveSubAgentSnapshot =
          !!persistedSubAgentSnapshot &&
          latestSubAgentSegmentIndexBySessionId.get(persistedSubAgentSnapshot.sessionId) === index;
        const liveSubAgentSnapshot =
          persistedSubAgentSnapshot && shouldMergeLiveSubAgentSnapshot
            ? liveSubAgentSnapshotsById.get(persistedSubAgentSnapshot.sessionId)
            : undefined;
        const resolvedSubAgentEvent = segment.subAgentEvent
          ? {
              ...segment.subAgentEvent,
              snapshot: persistedSubAgentSnapshot
                ? resolveDisplayedSubAgentSnapshot(persistedSubAgentSnapshot, liveSubAgentSnapshot)
                : segment.subAgentEvent.snapshot,
            }
          : (resolvedSourceMessage?.subAgentEvent ?? segment.subAgentEvent);

        return {
          ...segment,
          content: resolvedSourceMessage?.content ?? segment.content,
          attachments: resolvedAttachments?.length ? resolvedAttachments : undefined,
          reasoning: resolvedSourceMessage?.reasoning ?? segment.reasoning,
          toolCalls: resolvedSourceMessage?.toolCalls?.length
            ? resolvedSourceMessage.toolCalls
            : undefined,
          assistantMetadata: resolvedSourceMessage?.assistantMetadata ?? segment.assistantMetadata,
          timestamp: resolvedSourceMessage?.timestamp ?? segment.timestamp,
          isError: resolvedSourceMessage?.isError ?? segment.isError,
          effectId: resolvedSourceMessage?.effectId ?? segment.effectId,
          subAgentEvent: resolvedSubAgentEvent,
          isStreaming: resolvedSourceMessage?.id === streamingMessageId,
        };
      });

      const resolvedItem: ResolvedDisplayMessageItem = {
        ...item,
        resolvedMessage,
        resolvedResponseSegments,
        isStreaming,
        agentRun,
      };

      nextCache.set(item.id, {
        item: resolvedItem,
        sourceSignatures,
        draftSignature,
        isStreaming,
        retryMessageId: item.retryMessageId,
        agentRunSignature,
        liveSubAgentSignature,
      });
      return resolvedItem;
    })
    .filter((item): item is ResolvedDisplayMessageItem => !!item);

  cache.resolvedDisplayMessages = nextCache;
  return resolvedItems;
}
