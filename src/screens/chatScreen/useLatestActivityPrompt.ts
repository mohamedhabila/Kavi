import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ToolCall } from '../../types/message';
import type { ResolvedDisplayMessageItem } from '../chatScreenDisplayState';

type UseLatestActivityPromptParams = {
  forceNextScrollRef: MutableRefObject<boolean>;
  resolvedDisplayMessages: ResolvedDisplayMessageItem[];
  scrollToBottom: (animated: boolean) => void;
  shouldAutoFollowRef: MutableRefObject<boolean>;
  streamingMessageId: string | null;
};

const buildToolCallsSignature = (toolCalls: ToolCall[] | undefined) =>
  (toolCalls ?? [])
    .map((toolCall) =>
      [
        toolCall.id,
        toolCall.name,
        toolCall.status,
        toolCall.arguments.length,
        toolCall.progressText?.length ?? 0,
        toolCall.result?.length ?? 0,
        toolCall.error?.length ?? 0,
      ].join('\u0002'),
    )
    .join('\u0003');

const buildLatestActivitySignature = (
  resolvedDisplayMessages: ResolvedDisplayMessageItem[],
  streamingMessageId: string | null,
) => {
  const latestItem = resolvedDisplayMessages.at(-1);
  if (!latestItem) {
    return '';
  }

  const message = latestItem.resolvedMessage;
  const latestResponseSegment = latestItem.resolvedResponseSegments?.at(-1);

  return [
    latestItem.id,
    message.id,
    message.timestamp,
    message.content.length,
    message.reasoning?.length ?? 0,
    message.attachments?.length ?? 0,
    buildToolCallsSignature(message.toolCalls),
    latestResponseSegment?.content?.length ?? 0,
    latestResponseSegment?.reasoning?.length ?? 0,
    latestItem.isStreaming ? 'streaming' : 'settled',
    streamingMessageId ?? '',
  ].join('\u0001');
};

export function useLatestActivityPrompt(params: UseLatestActivityPromptParams) {
  const {
    forceNextScrollRef,
    resolvedDisplayMessages,
    scrollToBottom,
    shouldAutoFollowRef,
    streamingMessageId,
  } = params;
  const [hasNewLatestActivity, setHasNewLatestActivity] = useState(false);
  const latestActivitySignature = useMemo(
    () => buildLatestActivitySignature(resolvedDisplayMessages, streamingMessageId),
    [resolvedDisplayMessages, streamingMessageId],
  );
  const previousLatestActivitySignatureRef = useRef(latestActivitySignature);

  useEffect(() => {
    if (previousLatestActivitySignatureRef.current === latestActivitySignature) {
      return;
    }

    const hadPreviousActivity = previousLatestActivitySignatureRef.current.length > 0;
    previousLatestActivitySignatureRef.current = latestActivitySignature;

    if (!hadPreviousActivity || forceNextScrollRef.current || shouldAutoFollowRef.current) {
      setHasNewLatestActivity(false);
      return;
    }

    setHasNewLatestActivity(true);
  }, [forceNextScrollRef, latestActivitySignature, shouldAutoFollowRef]);

  const syncLatestActivityPrompt = useCallback(() => {
    if (forceNextScrollRef.current || shouldAutoFollowRef.current) {
      setHasNewLatestActivity(false);
    }
  }, [forceNextScrollRef, shouldAutoFollowRef]);

  const handleJumpToLatest = useCallback(() => {
    setHasNewLatestActivity(false);
    forceNextScrollRef.current = true;
    scrollToBottom(true);
  }, [forceNextScrollRef, scrollToBottom]);

  return {
    handleJumpToLatest,
    hasNewLatestActivity,
    syncLatestActivityPrompt,
  };
}
