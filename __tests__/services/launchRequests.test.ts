import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Linking, NativeModules, Platform } from 'react-native';
import {
  MAX_LAUNCH_REQUEST_TEXT_LENGTH,
  parseLaunchRequestUrl,
} from '../../src/services/assistant/launchRequests';
import { useLaunchRequests } from '../../src/navigation/useLaunchRequests';
import { useIncomingChatRequest } from '../../src/screens/useIncomingChatRequest';

const mockEmitterListeners = new Map<string, () => void>();
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addListener: (event: string, listener: () => void) => {
      mockEmitterListeners.set(event, listener);
      return { remove: () => mockEmitterListeners.delete(event) };
    },
  })),
}));

const originalOS = Platform.OS;
function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => {
  setPlatform(originalOS);
  delete NativeModules.KaviLaunchRequests;
  mockEmitterListeners.clear();
  jest.restoreAllMocks();
});

describe('launch request links', () => {
  it.each([
    ['kavi://assist', { kind: 'voice' }],
    ['KAVI://assist/', { kind: 'voice' }],
    [
      'kavi://ask?text=what%27s%20on%20my%20calendar%3F',
      { kind: 'ask', text: "what's on my calendar?" },
    ],
    ['kavi://ask?text=m%C3%A9t%C3%A9o+demain&from=siri', { kind: 'ask', text: 'météo demain' }],
    ['kavi://ask?text=%D8%A7%D9%84%D8%B7%D9%82%D8%B3', { kind: 'ask', text: 'الطقس' }],
    ['kavi://ask?text=', null],
    ['kavi://ask?text=%E0%A4', null],
    ['kavi://expo-sharing', { kind: 'share' }],
    ['kavi://settings', null],
    ['https://example.com', null],
    [null, null],
  ])('reads %s as %j', (url, expected) => {
    expect(parseLaunchRequestUrl(url)).toEqual(expected);
  });

  it('caps the request a link carries', () => {
    const request = parseLaunchRequestUrl(`kavi://ask?text=${'a'.repeat(5_000)}`);

    expect(request).toEqual({ kind: 'ask', text: 'a'.repeat(MAX_LAUNCH_REQUEST_TEXT_LENGTH) });
  });
});

describe('useLaunchRequests', () => {
  it('reports the link that started the app and each link after it (Android)', async () => {
    setPlatform('android');
    let emitUrl: ((event: { url: string }) => void) | undefined;
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('kavi://assist');
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as never);
    const onRequest = jest.fn();

    renderHook(() => useLaunchRequests(onRequest));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({ kind: 'voice' }));

    act(() => emitUrl?.({ url: 'https://example.com' }));
    act(() => emitUrl?.({ url: 'kavi://expo-sharing' }));
    act(() => emitUrl?.({ url: 'kavi://ask?text=hello' }));
    expect(onRequest.mock.calls).toEqual([
      [{ kind: 'voice' }],
      [{ kind: 'share' }],
      [{ kind: 'ask', text: 'hello' }],
    ]);
  });

  it('reads the request a Shortcut left, at launch and when it says another arrived (iOS)', async () => {
    setPlatform('ios');
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    const pending = ['kavi://assist', 'kavi://ask?text=remind%20me', null];
    const consumePendingLaunchRequest = jest.fn(async () => pending.shift() ?? null);
    NativeModules.KaviLaunchRequests = { consumePendingLaunchRequest };
    const onRequest = jest.fn();

    renderHook(() => useLaunchRequests(onRequest));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({ kind: 'voice' }));

    await act(async () => mockEmitterListeners.get('KaviLaunchRequest')?.());
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({ kind: 'ask', text: 'remind me' }));
    await act(async () => mockEmitterListeners.get('KaviLaunchRequest')?.());

    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(consumePendingLaunchRequest).toHaveBeenCalledTimes(3);
  });
});

describe('useIncomingChatRequest', () => {
  it('sends an incoming request once and clears it', async () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    const onConsumed = jest.fn();
    const request = { requestId: 7, text: 'What is on my calendar today?' };

    const view = renderHook(
      ({ incomingRequest }) => useIncomingChatRequest({ incomingRequest, onConsumed, onSend }),
      { initialProps: { incomingRequest: request as unknown } },
    );
    view.rerender({ incomingRequest: { ...request } });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('What is on my calendar today?');
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, { requestId: 1, text: '  ' }, { requestId: 'x', text: 'hi' }])(
    'ignores %j',
    (incomingRequest) => {
      const onSend = jest.fn();

      renderHook(() => useIncomingChatRequest({ incomingRequest, onConsumed: jest.fn(), onSend }));

      expect(onSend).not.toHaveBeenCalled();
    },
  );
});
