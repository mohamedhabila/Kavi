import { act, renderHook } from '@testing-library/react-native';
import { useLatestActivityPrompt } from '../../../src/screens/chatScreen/useLatestActivityPrompt';

describe('useLatestActivityPrompt', () => {
  it('restores automatic following when the user jumps to the latest activity', () => {
    const forceNextScrollRef = { current: false };
    const shouldAutoFollowRef = { current: false };
    const scrollToBottom = jest.fn();
    const { result } = renderHook(() =>
      useLatestActivityPrompt({
        forceNextScrollRef,
        resolvedDisplayMessages: [],
        scrollToBottom,
        shouldAutoFollowRef,
        streamingMessageId: null,
      }),
    );

    act(() => result.current.handleJumpToLatest());

    expect(forceNextScrollRef.current).toBe(true);
    expect(shouldAutoFollowRef.current).toBe(true);
    expect(scrollToBottom).toHaveBeenCalledWith(true);
  });
});
