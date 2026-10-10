import { act, renderHook } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { FlatList } from 'react-native';
import { useChatScrollController } from '../../src/screens/useChatScrollController';

describe('useChatScrollController', () => {
  let nextFrameId: number;
  let frameCallbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    nextFrameId = 1;
    frameCallbacks = new Map();
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((frameId) => {
      frameCallbacks.delete(frameId);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderController() {
    const scrollToEnd = jest.fn();
    const flatListRef = {
      current: { scrollToEnd },
    } as unknown as RefObject<FlatList<unknown> | null>;
    const hook = renderHook(() => useChatScrollController({ flatListRef }));

    return { ...hook, scrollToEnd };
  }

  function flushFrame(frameId = 1) {
    const callback = frameCallbacks.get(frameId);
    frameCallbacks.delete(frameId);
    callback?.(16);
  }

  it('coalesces repeated layout requests into one frame and preserves animated intent', () => {
    const { result, scrollToEnd } = renderController();

    act(() => {
      result.current.scrollToBottom(false);
      result.current.scrollToBottom(true);
      result.current.scrollToBottom(false);
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).not.toHaveBeenCalled();

    act(() => flushFrame());

    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  it('cancels pending automatic scroll when the user starts dragging', () => {
    const { result, scrollToEnd } = renderController();

    act(() => {
      result.current.scrollToBottom(false);
      result.current.handleUserScrollStart();
      result.current.maybeScrollToBottom(false);
    });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(frameCallbacks.size).toBe(0);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('keeps following while streamed content grows without a user gesture', () => {
    const { result, scrollToEnd } = renderController();

    act(() => {
      result.current.listMetricsRef.current = {
        contentHeight: 1_800,
        layoutHeight: 600,
        offsetY: 400,
      };
      result.current.updateAutoFollowState();
      result.current.maybeScrollToBottom(false);
    });

    expect(result.current.shouldAutoFollowRef.current).toBe(true);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    act(() => flushFrame());
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('resumes automatic following only when a gesture ends near the latest content', () => {
    const { result, scrollToEnd } = renderController();

    act(() => {
      result.current.handleUserScrollStart();
      result.current.listMetricsRef.current = {
        contentHeight: 1_000,
        layoutHeight: 600,
        offsetY: 400,
      };
      result.current.handleUserScrollEnd();
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => flushFrame());
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });

    act(() => {
      result.current.handleUserScrollStart();
      result.current.listMetricsRef.current = {
        contentHeight: 1_800,
        layoutHeight: 600,
        offsetY: 120,
      };
      result.current.handleUserScrollEnd();
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  describe('followLatestOnLayout', () => {
    function readAwayFromLatest(result: ReturnType<typeof renderController>['result']) {
      act(() => {
        result.current.handleUserScrollStart();
        result.current.listMetricsRef.current = {
          contentHeight: 1_800,
          layoutHeight: 600,
          offsetY: 120,
        };
        result.current.handleUserScrollEnd();
      });
    }

    it('keeps the latest message in view when the keyboard shrinks the transcript', () => {
      const { result, scrollToEnd } = renderController();

      act(() => result.current.followLatestOnLayout());
      act(() => flushFrame());

      expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    });

    it('leaves a reader who scrolled up where they are', () => {
      const { result, scrollToEnd } = renderController();
      readAwayFromLatest(result);

      act(() => result.current.followLatestOnLayout());

      expect(requestAnimationFrame).not.toHaveBeenCalled();
      expect(scrollToEnd).not.toHaveBeenCalled();
    });

    it('keeps a pending send scroll for the message it was set for', () => {
      const { result, scrollToEnd } = renderController();
      readAwayFromLatest(result);

      // Sending marks the next content change as forced, then clearing the composer
      // resizes the transcript before the sent message is measured.
      act(() => {
        result.current.forceNextScrollRef.current = true;
        result.current.followLatestOnLayout();
      });
      expect(result.current.forceNextScrollRef.current).toBe(true);

      act(() => result.current.maybeScrollToBottom(false));
      act(() => flushFrame());

      expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
      expect(result.current.forceNextScrollRef.current).toBe(false);
    });

    it('does not fight a gesture in progress', () => {
      const { result, scrollToEnd } = renderController();

      act(() => {
        result.current.handleUserScrollStart();
        result.current.followLatestOnLayout();
      });

      expect(requestAnimationFrame).not.toHaveBeenCalled();
      expect(scrollToEnd).not.toHaveBeenCalled();
    });
  });
});
