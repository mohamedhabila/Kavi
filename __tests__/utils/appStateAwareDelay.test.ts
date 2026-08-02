import { AppState } from 'react-native';
import { waitForAppStateAwareDelay } from '../../src/utils/appStateAwareDelay';

describe('waitForAppStateAwareDelay', () => {
  const originalState = AppState.currentState;

  afterEach(() => {
    (AppState as { currentState: string | null }).currentState = originalState;
    jest.useRealTimers();
  });

  it('uses the requested timer while the app is active', async () => {
    jest.useFakeTimers();
    (AppState as { currentState: string | null }).currentState = 'active';
    let settled = false;
    const pending = waitForAppStateAwareDelay(16).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(16);
    await pending;
    expect(settled).toBe(true);
  });

  it.each(['background', 'inactive'] as const)(
    'does not depend on a render timer while the app is %s',
    async (state) => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      (AppState as { currentState: string | null }).currentState = state;

      await expect(waitForAppStateAwareDelay(16)).resolves.toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('releases an active timer when the app backgrounds before it fires', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    (AppState as { currentState: string | null }).currentState = 'active';
    let onChange: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        onChange = listener;
        return { remove } as ReturnType<typeof AppState.addEventListener>;
      });

    const pending = waitForAppStateAwareDelay(120);
    (AppState as { currentState: string | null }).currentState = 'background';
    onChange?.('background');

    await expect(pending).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    subscription.mockRestore();
  });
});
