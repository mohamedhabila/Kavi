import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';
import { FlatList } from 'react-native';
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from './chatScreenConstants';

type UseChatScrollControllerParams = {
  flatListRef: RefObject<FlatList<any> | null>;
};

export function useChatScrollController({ flatListRef }: UseChatScrollControllerParams): {
  clearInteractionReleaseTimer: () => void;
  clearPendingScrollFrames: () => void;
  forceNextScrollRef: MutableRefObject<boolean>;
  handleUserScrollEnd: () => void;
  handleUserScrollStart: () => void;
  interactionReleaseTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  listMetricsRef: MutableRefObject<{
    contentHeight: number;
    layoutHeight: number;
    offsetY: number;
  }>;
  maybeScrollToBottom: (animated: boolean) => void;
  resetScrollState: () => void;
  scrollToBottom: (animated: boolean) => void;
  shouldAutoFollowRef: MutableRefObject<boolean>;
  updateAutoFollowState: () => void;
} {
  const listMetricsRef = useRef({ contentHeight: 0, layoutHeight: 0, offsetY: 0 });
  const shouldAutoFollowRef = useRef(true);
  const forceNextScrollRef = useRef(false);
  const isUserInteractingRef = useRef(false);
  const interactionReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollAnimatedRef = useRef(false);

  const updateAutoFollowState = useCallback(() => {
    // Content growth and layout changes can temporarily move the measured
    // viewport away from the bottom before the queued scroll-to-end runs.
    // Only a real user gesture may revoke follow mode; otherwise a streaming
    // response can strand the reader above its latest content.
    if (!isUserInteractingRef.current) {
      return;
    }

    const { contentHeight, layoutHeight, offsetY } = listMetricsRef.current;
    if (layoutHeight <= 0) {
      shouldAutoFollowRef.current = true;
      return;
    }

    const distanceFromBottom = contentHeight - (offsetY + layoutHeight);
    shouldAutoFollowRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const clearPendingScrollFrames = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    pendingScrollAnimatedRef.current = false;
  }, []);

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      pendingScrollAnimatedRef.current = pendingScrollAnimatedRef.current || animated;
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const shouldAnimate = pendingScrollAnimatedRef.current;
        pendingScrollAnimatedRef.current = false;
        flatListRef.current?.scrollToEnd({ animated: shouldAnimate });
      });
    },
    [flatListRef],
  );

  const clearInteractionReleaseTimer = useCallback(() => {
    if (!interactionReleaseTimerRef.current) {
      return;
    }

    clearTimeout(interactionReleaseTimerRef.current);
    interactionReleaseTimerRef.current = null;
  }, []);

  const maybeScrollToBottom = useCallback(
    (animated: boolean) => {
      if (isUserInteractingRef.current) {
        return;
      }

      if (!forceNextScrollRef.current && !shouldAutoFollowRef.current) {
        return;
      }

      scrollToBottom(animated);
      forceNextScrollRef.current = false;
    },
    [scrollToBottom],
  );

  const handleUserScrollStart = useCallback(() => {
    clearInteractionReleaseTimer();
    clearPendingScrollFrames();
    isUserInteractingRef.current = true;
    forceNextScrollRef.current = false;
  }, [clearInteractionReleaseTimer, clearPendingScrollFrames]);

  const handleUserScrollEnd = useCallback(() => {
    clearInteractionReleaseTimer();
    updateAutoFollowState();
    isUserInteractingRef.current = false;

    if (shouldAutoFollowRef.current) {
      maybeScrollToBottom(false);
    }
  }, [clearInteractionReleaseTimer, maybeScrollToBottom, updateAutoFollowState]);

  const resetScrollState = useCallback(() => {
    listMetricsRef.current = { contentHeight: 0, layoutHeight: 0, offsetY: 0 };
    shouldAutoFollowRef.current = true;
    forceNextScrollRef.current = true;
    isUserInteractingRef.current = false;
    clearInteractionReleaseTimer();
    clearPendingScrollFrames();
  }, [clearInteractionReleaseTimer, clearPendingScrollFrames]);

  return {
    clearInteractionReleaseTimer,
    clearPendingScrollFrames,
    forceNextScrollRef,
    handleUserScrollEnd,
    handleUserScrollStart,
    interactionReleaseTimerRef,
    listMetricsRef,
    maybeScrollToBottom,
    resetScrollState,
    scrollToBottom,
    shouldAutoFollowRef,
    updateAutoFollowState,
  };
}
