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
});
