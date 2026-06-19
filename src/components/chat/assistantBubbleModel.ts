import { Message, ToolCall } from '../../types/message';
import { stripInternalAssistantTranscriptArtifacts } from '../../utils/assistantTextSanitizer';
import { mergeAttachmentLists } from '../../utils/messageAttachments';
import {
  findMatchingToolCallIndex,
  findMatchingToolCallIndexWithinMessage,
  mergeMatchingToolCall,
  mergeMatchingToolCalls,
} from '../../utils/toolCallMatching';
import { getRenderableThinkingText } from './ThinkingBlock';
import { DisplayResponseSegment } from './messageGrouping';
import { buildContentRenderPlan } from './messageContent';

export type AssistantBubbleSegment = DisplayResponseSegment & { isStreaming?: boolean };

export type AssistantBubbleTimelineItem = {
  id: string;
  sourceSegmentId: string;
} & (
  | {
      kind: 'reasoning';
      reasoning: string;
      isStreaming?: boolean;
      timestamp: number;
    }
  | {
      kind: 'content';
      segment: AssistantBubbleSegment;
    }
);

export interface AssistantBubbleViewModel {
  timelineItems: AssistantBubbleTimelineItem[];
  contentSegments: AssistantBubbleSegment[];
  activeToolCall?: ToolCall;
  copyText: string;
  contentWarnings: {
    usesPlainTextFallback: boolean;
    hasTruncatedContent: boolean;
  };
}

function getActiveToolCall(toolCalls?: ToolCall[]): ToolCall | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }

  return [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.status === 'running' || toolCall.status === 'pending');
}

function buildOrderedAssistantSegments(params: {
  message: Message;
  responseSegments?: Array<DisplayResponseSegment & { isStreaming?: boolean }>;
  isStreaming?: boolean;
}): AssistantBubbleSegment[] {
  const { message, responseSegments, isStreaming } = params;

  const rawSegments = responseSegments?.length
    ? responseSegments
    : [
        {
          id: `segment-${message.id}`,
          messageId: message.id,
          content: message.content,
          attachments: message.attachments,
          reasoning: message.reasoning,
          toolCalls: message.toolCalls,
          assistantMetadata: message.assistantMetadata,
          timestamp: message.timestamp,
          isError: message.isError,
          effectId: message.effectId,
          subAgentEvent: message.subAgentEvent,
          isStreaming,
        },
      ];

  return rawSegments.map((segment) => ({
    ...segment,
    toolCalls: collapseSameSegmentToolCalls(segment.toolCalls),
    content: stripInternalAssistantTranscriptArtifacts(segment.content || ''),
  }));
}

function collapseSameSegmentToolCalls(toolCalls: ToolCall[] | undefined): ToolCall[] | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }

  const collapsedToolCalls: ToolCall[] = [];
  for (const toolCall of toolCalls) {
    const existingIndex = findMatchingToolCallIndexWithinMessage(collapsedToolCalls, toolCall);
    if (existingIndex < 0) {
      collapsedToolCalls.push(toolCall);
      continue;
    }

    collapsedToolCalls[existingIndex] = mergeMatchingToolCall(
      collapsedToolCalls[existingIndex],
      toolCall,
    );
  }

  return collapsedToolCalls;
}

function collapseSubAgentLifecycleSegments(
  segments: AssistantBubbleSegment[],
): AssistantBubbleSegment[] {
  const collapsedSegments: AssistantBubbleSegment[] = [];
  const subAgentIndexBySessionId = new Map<string, number>();

  for (const segment of segments) {
    const sessionId = segment.subAgentEvent?.snapshot.sessionId?.trim();
    if (!sessionId) {
      collapsedSegments.push(segment);
      continue;
    }

    const existingIndex = subAgentIndexBySessionId.get(sessionId);
    if (existingIndex === undefined) {
      subAgentIndexBySessionId.set(sessionId, collapsedSegments.length);
      collapsedSegments.push(segment);
      continue;
    }

    const existingSegment = collapsedSegments[existingIndex];
    collapsedSegments[existingIndex] = {
      ...existingSegment,
      messageId: segment.messageId,
      content: segment.content || existingSegment.content,
      reasoning: segment.reasoning ?? existingSegment.reasoning,
      attachments: mergeAttachmentLists(existingSegment.attachments, segment.attachments),
      toolCalls: mergeMatchingToolCalls(existingSegment.toolCalls, segment.toolCalls),
      assistantMetadata: segment.assistantMetadata ?? existingSegment.assistantMetadata,
      timestamp: Math.max(existingSegment.timestamp, segment.timestamp),
      isError: segment.isError ?? existingSegment.isError,
      effectId: segment.effectId ?? existingSegment.effectId,
      subAgentEvent: segment.subAgentEvent,
      isStreaming: segment.isStreaming ?? existingSegment.isStreaming,
    };
  }

  return collapsedSegments;
}

function collapseDuplicateToolCallSnapshots(
  segments: AssistantBubbleSegment[],
): AssistantBubbleSegment[] {
  if (!segments.some((segment) => (segment.toolCalls?.length ?? 0) > 0)) {
    return segments;
  }

  const collapsedSegments: AssistantBubbleSegment[] = segments.map((segment) => ({
    ...segment,
    toolCalls: undefined,
  }));
  const anchoredToolCalls: ToolCall[] = [];
  const anchorLocations: Array<{ segmentIndex: number; toolCallIndex: number }> = [];

  segments.forEach((segment, segmentIndex) => {
    const uniqueSegmentToolCalls: ToolCall[] = [];

    for (const toolCall of segment.toolCalls ?? []) {
      const existingIndex = findMatchingToolCallIndex(anchoredToolCalls, toolCall);
      if (existingIndex < 0) {
        anchoredToolCalls.push(toolCall);
        anchorLocations.push({
          segmentIndex,
          toolCallIndex: uniqueSegmentToolCalls.length,
        });
        uniqueSegmentToolCalls.push(toolCall);
        continue;
      }

      const mergedToolCall = mergeMatchingToolCall(anchoredToolCalls[existingIndex], toolCall);
      anchoredToolCalls[existingIndex] = mergedToolCall;

      const anchor = anchorLocations[existingIndex];
      if (anchor.segmentIndex === segmentIndex) {
        uniqueSegmentToolCalls[anchor.toolCallIndex] = mergedToolCall;
      }

      const anchorSegment = collapsedSegments[anchor.segmentIndex];
      const nextAnchorToolCalls = [...(anchorSegment.toolCalls ?? [])];
      nextAnchorToolCalls[anchor.toolCallIndex] = mergedToolCall;
      collapsedSegments[anchor.segmentIndex] = {
        ...anchorSegment,
        toolCalls: nextAnchorToolCalls,
      };
    }

    collapsedSegments[segmentIndex] = {
      ...collapsedSegments[segmentIndex],
      toolCalls: uniqueSegmentToolCalls.length ? uniqueSegmentToolCalls : undefined,
    };
  });

  return collapsedSegments;
}

function hasRenderableSegmentContent(segment: AssistantBubbleSegment): boolean {
  return (
    !!segment.subAgentEvent ||
    !!segment.content ||
    !!segment.attachments?.length ||
    !!segment.isError ||
    !!segment.toolCalls?.length
  );
}

function isPlainAssistantOutputSegment(segment: AssistantBubbleSegment): boolean {
  return (
    !segment.subAgentEvent &&
    (segment.toolCalls?.length ?? 0) === 0 &&
    (segment.content.trim().length > 0 ||
      (segment.attachments?.length ?? 0) > 0 ||
      !!segment.isError ||
      !!segment.effectId)
  );
}

function isTextOnlyPlainAssistantSegment(segment: AssistantBubbleSegment): boolean {
  return (
    !segment.subAgentEvent &&
    (segment.toolCalls?.length ?? 0) === 0 &&
    (segment.attachments?.length ?? 0) === 0 &&
    !segment.isError &&
    !segment.effectId &&
    segment.content.trim().length > 0
  );
}

function isCompleteFinalAssistantSegment(segment: AssistantBubbleSegment): boolean {
  return (
    isTextOnlyPlainAssistantSegment(segment) &&
    segment.assistantMetadata?.kind === 'final' &&
    segment.assistantMetadata.completionStatus === 'complete'
  );
}

function shouldSuppressSupersededPlainAssistantSegment(
  segment: AssistantBubbleSegment,
  laterSegments: AssistantBubbleSegment[],
): boolean {
  if (!isTextOnlyPlainAssistantSegment(segment)) {
    return false;
  }

  if (segment.assistantMetadata?.kind === 'intermediate') {
    return laterSegments.some(isPlainAssistantOutputSegment);
  }

  if (segment.assistantMetadata?.kind === 'final') {
    return (
      segment.assistantMetadata.completionStatus === 'incomplete' &&
      laterSegments.some(isPlainAssistantOutputSegment)
    );
  }

  return laterSegments.some(isCompleteFinalAssistantSegment);
}

function suppressStaleIncompleteFinalSegments(
  segments: AssistantBubbleSegment[],
): AssistantBubbleSegment[] {
  return segments.filter((segment, index) => {
    const laterSegments = segments.slice(index + 1);
    if (!shouldSuppressSupersededPlainAssistantSegment(segment, laterSegments)) {
      return true;
    }

    return false;
  });
}

function resolveActiveToolCall(
  segments: AssistantBubbleSegment[],
  fallbackToolCalls?: ToolCall[],
): ToolCall | undefined {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const activeToolCall = getActiveToolCall(segments[index]?.toolCalls);
    if (activeToolCall) {
      return activeToolCall;
    }
  }

  return getActiveToolCall(fallbackToolCalls);
}

function resolveContentWarnings(segments: AssistantBubbleSegment[]) {
  let usesPlainTextFallback = false;
  let hasTruncatedContent = false;

  for (const segment of segments) {
    if (segment.subAgentEvent) {
      continue;
    }

    const plan = buildContentRenderPlan(segment.content);
    if (!plan) {
      continue;
    }

    if (plan.mode === 'plain') {
      usesPlainTextFallback = true;
    }
    if (plan.truncated) {
      hasTruncatedContent = true;
    }

    if (usesPlainTextFallback && hasTruncatedContent) {
      break;
    }
  }

  return {
    usesPlainTextFallback,
    hasTruncatedContent,
  };
}

function buildTimelineItems(segments: AssistantBubbleSegment[]): AssistantBubbleTimelineItem[] {
  return segments.flatMap<AssistantBubbleTimelineItem>((segment) => {
    const timelineItems: AssistantBubbleTimelineItem[] = [];
    const reasoning = getRenderableThinkingText(segment.reasoning);

    if (reasoning) {
      timelineItems.push({
        kind: 'reasoning',
        id: `reasoning-${segment.id}`,
        sourceSegmentId: segment.id,
        reasoning,
        isStreaming: segment.isStreaming,
        timestamp: segment.timestamp,
      });
    }

    if (hasRenderableSegmentContent(segment)) {
      timelineItems.push({
        kind: 'content',
        id: `content-${segment.id}`,
        sourceSegmentId: segment.id,
        segment,
      });
    }

    return timelineItems;
  });
}

export function buildAssistantBubbleViewModel(params: {
  message: Message;
  responseSegments?: Array<DisplayResponseSegment & { isStreaming?: boolean }>;
  isStreaming?: boolean;
}): AssistantBubbleViewModel {
  const orderedSegments = suppressStaleIncompleteFinalSegments(
    collapseDuplicateToolCallSnapshots(
      collapseSubAgentLifecycleSegments(buildOrderedAssistantSegments(params)),
    ),
  );
  const contentSegments = orderedSegments.filter(hasRenderableSegmentContent);
  const contentWarnings = resolveContentWarnings(contentSegments);

  return {
    timelineItems: buildTimelineItems(orderedSegments),
    contentSegments,
    activeToolCall: resolveActiveToolCall(contentSegments, params.message.toolCalls),
    copyText: contentSegments
      .map((segment) => segment.content)
      .filter(Boolean)
      .join('\n\n'),
    contentWarnings,
  };
}
