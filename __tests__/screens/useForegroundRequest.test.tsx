import { act, renderHook } from '@testing-library/react-native';
import { appForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import { useForegroundRequest } from '../../src/screens/useForegroundRequest';

describe('useForegroundRequest', () => {
  afterEach(() => {
    appForegroundRequestRegistry.dispose('Resetting foreground request hook test state.');
  });

  it('keeps process-owned work alive while the chat screen is recreated', () => {
    const controller = new AbortController();
    const firstScreen = renderHook(() => useForegroundRequest({ setLoading: jest.fn() }));

    act(() => {
      firstScreen.result.current.registerForegroundRequest(
        'request-1',
        'conversation-1',
        controller,
      );
    });
    expect(firstScreen.result.current.activeForegroundConversationIds).toEqual(
      new Set(['conversation-1']),
    );

    firstScreen.unmount();

    expect(controller.signal.aborted).toBe(false);
    expect(appForegroundRequestRegistry.hasConversation('conversation-1')).toBe(true);

    const recreatedScreen = renderHook(() => useForegroundRequest({ setLoading: jest.fn() }));
    expect(recreatedScreen.result.current.activeForegroundConversationIds).toEqual(
      new Set(['conversation-1']),
    );

    act(() => {
      expect(
        recreatedScreen.result.current.clearForegroundRequest(
          'conversation-1',
          'request-1',
          controller,
        ),
      ).toBe(true);
    });
    expect(controller.signal.aborted).toBe(false);
    recreatedScreen.unmount();
  });
});
