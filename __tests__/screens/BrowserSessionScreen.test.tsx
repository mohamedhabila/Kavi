import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { BrowserSessionScreen } from '../../src/screens/BrowserSessionScreen';

const mockOpenDrawer = jest.fn();
const mockNavigate = jest.fn();
const mockTakeScreenshot = jest.fn();
const mockGetBrowserProviderReadiness = jest.fn();

const remoteStoreState = {
  sessions: {} as Record<string, any>,
};

const traceStoreState = {
  traces: {} as Record<string, any[]>,
};

const settingsStoreState = {
  browserProviders: [] as any[],
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    openDrawer: mockOpenDrawer,
    navigate: mockNavigate,
  }),
}));

jest.mock('@react-navigation/drawer', () => ({
  DrawerNavigationProp: {},
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      header: '#111',
      border: '#333',
      primary: '#09f',
      onPrimary: '#fff',
      success: '#0f0',
      warning: '#fc0',
      danger: '#f00',
      text: '#fff',
      textSecondary: '#bbb',
      textTertiary: '#777',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (key === 'browserSessions.startedAt') {
        return `Started at ${params?.time ?? ''}`;
      }
      return key;
    },
  }),
}));

jest.mock('../../src/services/remote/store', () => ({
  useRemoteStore: (selector: (state: typeof remoteStoreState) => unknown) =>
    selector(remoteStoreState),
}));

jest.mock('../../src/services/browser/traceStore', () => ({
  useBrowserTraceStore: (selector: (state: typeof traceStoreState) => unknown) =>
    selector(traceStoreState),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settingsStoreState) => unknown) =>
    selector(settingsStoreState),
}));

jest.mock('../../src/services/browser/providers/readiness', () => ({
  getBrowserProviderReadiness: (...args: any[]) => mockGetBrowserProviderReadiness(...args),
}));

jest.mock('../../src/services/browser/jobs', () => ({
  takeScreenshot: (...args: any[]) => mockTakeScreenshot(...args),
}));

describe('BrowserSessionScreen', () => {
  let openUrlSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    remoteStoreState.sessions = {};
    traceStoreState.traces = {};
    settingsStoreState.browserProviders = [];
    mockGetBrowserProviderReadiness.mockReturnValue({ launchable: false });
    mockTakeScreenshot.mockResolvedValue('file:///tmp/browser-shot.png');
  });

  afterEach(() => {
    openUrlSpy.mockRestore();
  });

  it('renders the provider configuration empty state and opens settings', () => {
    const { getByText } = render(<BrowserSessionScreen />);

    expect(getByText('browserSessions.noProviderTitle')).toBeTruthy();
    fireEvent.press(getByText('browserSessions.openSettings'));

    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  it('renders the no-session state when browser support is configured but no sessions exist', () => {
    settingsStoreState.browserProviders = [{ providerId: 'playwright' }];
    mockGetBrowserProviderReadiness.mockReturnValue({ launchable: true });

    const { getByText } = render(<BrowserSessionScreen />);

    expect(getByText('browserSessions.emptyTitle')).toBeTruthy();
    expect(getByText('browserSessions.emptyDescription')).toBeTruthy();
  });

  it('renders live sessions and refreshes screenshots for the active session', async () => {
    settingsStoreState.browserProviders = [{ providerId: 'playwright' }];
    mockGetBrowserProviderReadiness.mockReturnValue({ launchable: true });
    remoteStoreState.sessions = {
      'session-1': {
        id: 'session-1',
        kind: 'browser-live',
        status: 'closed',
        providerId: 'browserbase',
        startedAt: Date.now() - 30_000,
        lastActivityAt: 100,
        externalId: 'ext-one',
        summary: 'Older session',
      },
      'session-2': {
        id: 'session-2',
        kind: 'browser-live',
        status: 'connected',
        providerId: 'playwright',
        startedAt: Date.now() - 10_000,
        lastActivityAt: 200,
        externalId: 'ext-two',
        summary: 'Newest session',
        liveViewUrl: 'https://example.test/live',
      },
      other: {
        id: 'other',
        kind: 'ssh',
        status: 'connected',
        providerId: 'ssh',
        startedAt: Date.now(),
        lastActivityAt: 999,
      },
    };
    traceStoreState.traces = {
      'session-1': [],
      'session-2': [
        {
          id: 'trace-1',
          action: 'click',
          description: 'Clicked the submit button',
          durationMs: 120,
          status: 'error',
          error: 'Button was not visible',
          pageUrl: 'https://example.test/dashboard',
          timestamp: Date.now() - 5_000,
        },
      ],
    };

    const screen = render(<BrowserSessionScreen />);

    await waitFor(() => {
      expect(mockTakeScreenshot).toHaveBeenCalledWith('session-2');
    });

    await waitFor(() => {
      expect(screen.queryByText('browserSessions.noScreenshot')).toBeNull();
    });

    expect(screen.getByText('browserSessions.quickActions')).toBeTruthy();
    expect(screen.getByText('browserSessions.liveView')).toBeTruthy();
    expect(screen.getByText('Older session')).toBeTruthy();
    expect(screen.getByText('browserSessions.statusConnected')).toBeTruthy();
    expect(screen.getByText('Clicked the submit button')).toBeTruthy();
    expect(screen.getByText('Button was not visible')).toBeTruthy();
    expect(screen.getByText('https://example.test/dashboard')).toBeTruthy();

    fireEvent.press(screen.getByText('browserSessions.liveView'));
    await waitFor(() => {
      expect(openUrlSpy).toHaveBeenCalledWith('https://example.test/live');
    });

    const priorCalls = mockTakeScreenshot.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByText('common.refresh'));
    });

    await waitFor(() => {
      expect(mockTakeScreenshot.mock.calls.length).toBe(priorCalls + 1);
    });

    screen.unmount();
  });

  it('clears stale screenshots when the active session disconnects', async () => {
    settingsStoreState.browserProviders = [{ providerId: 'playwright' }];
    mockGetBrowserProviderReadiness.mockReturnValue({ launchable: true });
    remoteStoreState.sessions = {
      'session-1': {
        id: 'session-1',
        kind: 'browser-live',
        status: 'connected',
        providerId: 'playwright',
        startedAt: Date.now() - 10_000,
        lastActivityAt: 200,
        externalId: 'ext-one',
        summary: 'Active session',
      },
    };

    const screen = render(<BrowserSessionScreen />);

    await waitFor(() => {
      expect(mockTakeScreenshot).toHaveBeenCalledWith('session-1');
    });

    remoteStoreState.sessions = {
      'session-1': {
        ...remoteStoreState.sessions['session-1'],
        status: 'closed',
      },
    };

    screen.rerender(<BrowserSessionScreen />);

    await waitFor(() => {
      expect(screen.getByText('browserSessions.noScreenshot')).toBeTruthy();
    });

    screen.unmount();
  });
});
