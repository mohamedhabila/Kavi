import {
  buildDisplayMessages,
  getMessageDisplayAttachments,
  mergeAssistantMessages,
  type DisplayMessageItem,
  type DisplayResponseSegment,
} from '../components/chat/messageGrouping';
import { resolveDisplayedSubAgentSnapshot } from '../services/agents/workflowState';
import { AgentRun, Message, ToolCall } from '../types';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';

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
  sourceMessages: Message[];
};

type ResolvedDisplayMessageCacheEntry = {
  item: ResolvedDisplayMessageItem;
  sourceMessages: Message[];
  draftSignature: string;
  isStreaming: boolean;
  retryMessageId?: string;
  agentRunSignature: string;
  liveSubAgentSignature: string;
};

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

function findAgentRunAnchorMessageId(messages: Message[], run: AgentRun): string | undefined {
  const userMessageIndex = messages.findIndex((message) => message.id === run.userMessageId);
  if (userMessageIndex < 0) {
    return undefined;
  }

  const assistantMessages: Message[] = [];
  for (let index = userMessageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (candidate.role === 'user') {
      break;
    }

    if (candidate.role === 'assistant') {
      assistantMessages.push(candidate);
    }
  }

  if (!assistantMessages.length) {
    return undefined;
  }

  const preferredMessage =
    [...assistantMessages].reverse().find((message) => !message.subAgentEvent) ??
    assistantMessages[assistantMessages.length - 1];

  return preferredMessage?.id;
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
    const anchorMessageId = findAgentRunAnchorMessageId(messages, run);
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
  const rawItems = buildDisplayMessages(messages);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const nextCache = new Map<string, StableDisplayMessageCacheEntry>();

  const stableItems = rawItems.map((item) => {
    const sourceMessages = buildSourceMessages(messageById, item.sourceMessageIds);
    const cached = cache.stableDisplayMessages.get(item.id);

    if (
      cached &&
      cached.item.retryMessageId === item.retryMessageId &&
      cached.sourceMessages.length === sourceMessages.length &&
      cached.sourceMessages.every((message, index) => message === sourceMessages[index])
    ) {
      nextCache.set(item.id, cached);
      return cached.item;
    }

    const nextEntry = { item, sourceMessages };
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

  const resolvedItems = displayMessages.map((item) => {
    const sourceMessages = buildSourceMessages(messageById, item.sourceMessageIds);
    const agentRun = agentRunByDisplayItemId.get(item.id);
    const isStreaming = !!streamingMessageId && item.sourceMessageIds.includes(streamingMessageId);
    const draftSignature = isStreaming
      ? item.sourceMessageIds
          .map(
            (sourceMessageId) =>
              `${sourceMessageId}:${buildStreamingDraftSignature(streamingDrafts[sourceMessageId])}`,
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
      cached.sourceMessages.length === sourceMessages.length &&
      cached.sourceMessages.every((message, index) => message === sourceMessages[index])
    ) {
      nextCache.set(item.id, cached);
      return cached.item;
    }

    let hasDraft = false;
    const resolvedSourceMessages = sourceMessages.map((sourceMessage) => {
      const draft = streamingDrafts[sourceMessage.id];
      if (!draft) {
        return sourceMessage;
      }

      hasDraft = true;
      return resolveStreamingDraftMessage(sourceMessage, draft);
    });
    const resolvedSourceMessageById = new Map(
      resolvedSourceMessages.map((message) => [message.id, message]),
    );

    let resolvedMessage = item.message;
    if (item.message.role === 'assistant' && hasDraft && resolvedSourceMessages.length > 0) {
      resolvedMessage =
        resolvedSourceMessages.length === 1
          ? resolvedSourceMessages[0]
          : mergeAssistantMessages(resolvedSourceMessages);
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
      sourceMessages,
      draftSignature,
      isStreaming,
      retryMessageId: item.retryMessageId,
      agentRunSignature,
      liveSubAgentSignature,
    });
    return resolvedItem;
  });

  cache.resolvedDisplayMessages = nextCache;
  return resolvedItems;
}
