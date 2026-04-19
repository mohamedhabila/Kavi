import { launchBrowserLiveSession, stopBrowserLiveSession } from '../../src/services/browser/jobs';
import { resetRemoteStore, useRemoteStore } from '../../src/services/remote/store';

const mockGetSecure = jest.fn();

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

const browserProviders = [
  {
    id: 'browser-1',
    name: 'Primary Browserbase',
    provider: 'browserbase' as const,
    baseUrl: 'https://api.browserbase.com',
    authMode: 'api-key-header' as const,
    apiKeyRef: 'browser_key_1',
    projectId: 'proj_123',
    enabled: true,
  },
];

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ browserProviders }),
  },
}));

describe('browser live sessions', () => {
  beforeEach(() => {
    resetRemoteStore();
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue('bb_test_key');
  });

  it('launches and tracks a Browserbase live session', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: 'sess_123' }) })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            debuggerFullscreenUrl: 'https://debug.example.com',
            wsUrl: 'wss://debug.example.com/ws',
          }),
      }) as any;

    const sessionId = await launchBrowserLiveSession(browserProviders[0]);
    const session = useRemoteStore.getState().sessions[sessionId];
    const jobs = Object.values(useRemoteStore.getState().jobs);

    expect(session.liveViewUrl).toBe('https://debug.example.com');
    expect(session.status).toBe('connected');
    expect(jobs[0]?.status).toBe('completed');
    expect(
      jobs[0]?.artifacts.some((artifact) => artifact.uri === 'https://debug.example.com'),
    ).toBe(true);
  });

  it('stops a tracked Browserbase live session', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: 'sess_123' }) })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            debuggerFullscreenUrl: 'https://debug.example.com',
            wsUrl: 'wss://debug.example.com/ws',
          }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => '' }) as any;

    const sessionId = await launchBrowserLiveSession(browserProviders[0]);
    await stopBrowserLiveSession(sessionId);

    expect((global.fetch as jest.Mock).mock.calls[2][0]).toContain('/v1/sessions/sess_123');
    expect(useRemoteStore.getState().sessions[sessionId]?.status).toBe('closed');
  });
});
