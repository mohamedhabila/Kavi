import { useCallback, useEffect, useState } from 'react';
import { createForegroundRequestRegistry } from '../engine/graph/foregroundRun/requestRegistry';

type UseForegroundRequestParams = {
  setLoading: (isLoading: boolean) => void;
};

export function useForegroundRequest({ setLoading }: UseForegroundRequestParams): {
  activeForegroundConversationIds: ReadonlySet<string>;
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  clearForegroundRequest: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  clearForegroundRequestForConversation: (conversationId: string) => boolean;
  foregroundStreamingMessageIds: ReadonlyMap<string, string>;
  isCurrentForegroundRequest: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  registerForegroundRequest: (
    requestId: string,
    conversationId: string,
    abortController: AbortController,
  ) => void;
  setForegroundRequestStreamingMessageId: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
    messageId: string | null,
  ) => boolean;
} {
  const [registry] = useState(createForegroundRequestRegistry);
  const [activeForegroundConversationIds, setActiveForegroundConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [foregroundStreamingMessageIds, setForegroundStreamingMessageIds] = useState<
    ReadonlyMap<string, string>
  >(new Map());

  const publishRegistryState = useCallback(() => {
    const activeConversationIds = registry.getActiveConversationIds();
    const streamingMessageIds = new Map<string, string>();
    for (const conversationId of activeConversationIds) {
      const messageId = registry.getStreamingMessageId(conversationId);
      if (messageId) {
        streamingMessageIds.set(conversationId, messageId);
      }
    }

    setActiveForegroundConversationIds(activeConversationIds);
    setForegroundStreamingMessageIds(streamingMessageIds);
    setLoading(registry.size > 0);
  }, [registry, setLoading]);

  const registerForegroundRequest = useCallback(
    (requestId: string, conversationId: string, abortController: AbortController) => {
      registry.register({
        requestId,
        conversationId,
        controller: abortController,
      });
      publishRegistryState();
    },
    [publishRegistryState, registry],
  );

  const isCurrentForegroundRequest = useCallback(
    (conversationId: string, requestId: string, abortController: AbortController) =>
      registry.isCurrent({
        conversationId,
        requestId,
        controller: abortController,
      }),
    [registry],
  );

  const clearForegroundRequest = useCallback(
    (conversationId: string, requestId: string, abortController: AbortController) => {
      const cleared = registry.clear({
        conversationId,
        requestId,
        controller: abortController,
      });
      if (!cleared) {
        return false;
      }

      publishRegistryState();
      return true;
    },
    [publishRegistryState, registry],
  );

  const abortForegroundRequestForConversation = useCallback(
    (conversationId: string, reason?: string) =>
      registry.abortForConversation(conversationId, reason),
    [registry],
  );

  const clearForegroundRequestForConversation = useCallback(
    (conversationId: string) => {
      if (!registry.clearForConversation(conversationId)) {
        return false;
      }

      publishRegistryState();
      return true;
    },
    [publishRegistryState, registry],
  );

  const setForegroundRequestStreamingMessageId = useCallback(
    (
      conversationId: string,
      requestId: string,
      abortController: AbortController,
      messageId: string | null,
    ) => {
      const updated = registry.setStreamingMessageId(
        { conversationId, requestId, controller: abortController },
        messageId,
      );
      if (updated) {
        publishRegistryState();
      }
      return updated;
    },
    [publishRegistryState, registry],
  );

  useEffect(
    () => () => {
      registry.dispose('Foreground request owner was disposed.');
      setLoading(false);
    },
    [registry, setLoading],
  );

  return {
    activeForegroundConversationIds,
    abortForegroundRequestForConversation,
    clearForegroundRequest,
    clearForegroundRequestForConversation,
    foregroundStreamingMessageIds,
    isCurrentForegroundRequest,
    registerForegroundRequest,
    setForegroundRequestStreamingMessageId,
  };
}
