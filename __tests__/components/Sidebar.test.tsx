// ---------------------------------------------------------------------------
// Tests — Sidebar Component
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { Sidebar } from '../../src/components/sidebar/Sidebar';

// Mock stores
const mockConversations = [
  {
    id: 'conv1',
    title: 'First Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    providerId: 'openai',
    model: 'gpt-5.4',
    usage: {
      entries: [],
      totalInput: 800,
      totalOutput: 434,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 1234,
      totalCost: 0.0042,
      totalCalls: 2,
    },
  },
  {
    id: 'conv2',
    title: 'Second Chat',
    messages: [],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
    providerId: 'openai',
    model: 'gpt-5.4',
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCalls: 0,
    },
  },
];

const mockCreateConversation = jest.fn();
const mockGetOrCreateCanonicalThread = jest.fn(
  (providerId: string, _systemPrompt: string, _model?: string) => `canonical-${providerId}`,
);
const mockCreateSideThread = jest.fn(
  (parentId: string, _options?: any) => `side-of-${parentId}`,
);
const mockSetActiveConversation = jest.fn();
const mockDeleteConversation = jest.fn();
let mockProviders = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    enabled: true,
  },
];

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (s: any) => any) => {
    const state = {
      conversations: mockConversations,
      activeConversationId: 'conv1',
      createConversation: mockCreateConversation,
      getOrCreateCanonicalThread: mockGetOrCreateCanonicalThread,
      createSideThread: mockCreateSideThread,
      setActiveConversation: mockSetActiveConversation,
      deleteConversation: mockDeleteConversation,
    };
    return selector(state);
  },
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: any) => any) => {
    const state = {
      providers: mockProviders,
      systemPrompt: 'You are helpful',
      activeProviderId: 'openai',
      activeModel: 'gpt-5.4',
    };
    return selector(state);
  },
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      panel: '#111',
      border: '#333',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
    },
  }),
  AppPalette: {},
}));

// Mock safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockNavigation = {
  closeDrawer: jest.fn(),
  navigate: jest.fn(),
  openDrawer: jest.fn(),
  dispatch: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
  isFocused: jest.fn(),
  canGoBack: jest.fn(),
  getParent: jest.fn(),
  getState: jest.fn(),
  setParams: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  getId: jest.fn(),
  emit: jest.fn(),
  toggleDrawer: jest.fn(),
  jumpTo: jest.fn(),
} as any;

const defaultProps = {
  navigation: mockNavigation,
  state: {
    routes: [],
    index: 0,
    key: '',
    type: 'drawer',
    routeNames: [],
    stale: false as const,
    history: [],
  },
  descriptors: {},
} as any;

describe('Sidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProviders = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5.4',
        enabled: true,
      },
    ];
  });

  it('should render the title', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    expect(getByText('Kavi')).toBeTruthy();
  });

  it('should not render the legacy conversation list UX', () => {
    const { queryByText, queryByTestId } = render(<Sidebar {...defaultProps} />);
    expect(queryByText('First Chat')).toBeNull();
    expect(queryByText('Second Chat')).toBeNull();
    expect(queryByTestId('sidebar-time-buckets')).toBeNull();
    expect(queryByTestId('sidebar-archived-section')).toBeNull();
  });

  it('should open the thread-options sheet and start a side thread', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const start = (buttons || []).find((b) => b.text === 'Start a side thread');
      start?.onPress?.();
    });
    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByTestId('sidebar-thread-options'));
    expect(alertSpy).toHaveBeenCalled();
    expect(mockCreateSideThread).toHaveBeenCalledWith('conv1', {
      providerId: 'openai',
      modelOverride: 'gpt-5.4',
    });
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Chat');
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  it('should materialize the canonical thread before starting a side thread when none is active', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const start = (buttons || []).find((b) => b.text === 'Start a side thread');
      start?.onPress?.();
    });
    const originalActiveConversationId = 'conv1';
    const useChatStoreModule = jest.requireMock('../../src/store/useChatStore') as {
      useChatStore: (selector: (s: any) => any) => any;
    };
    const originalUseChatStore = useChatStoreModule.useChatStore;
    useChatStoreModule.useChatStore = (selector: (s: any) => any) =>
      selector({
        conversations: mockConversations,
        activeConversationId: null,
        createConversation: mockCreateConversation,
        getOrCreateCanonicalThread: mockGetOrCreateCanonicalThread,
        createSideThread: mockCreateSideThread,
        setActiveConversation: mockSetActiveConversation,
        deleteConversation: mockDeleteConversation,
      });

    try {
      const { getByTestId } = render(<Sidebar {...defaultProps} />);
      fireEvent.press(getByTestId('sidebar-thread-options'));
      expect(alertSpy).toHaveBeenCalled();
      expect(mockGetOrCreateCanonicalThread).toHaveBeenCalledWith(
        'openai',
        'You are helpful',
        'gpt-5.4',
      );
      expect(mockCreateSideThread).toHaveBeenCalledWith('canonical-openai', {
        providerId: 'openai',
        modelOverride: 'gpt-5.4',
      });
    } finally {
      useChatStoreModule.useChatStore = originalUseChatStore;
      mockActiveConversationId = originalActiveConversationId;
    }
  });

  it('should route users to settings instead of starting a side thread without a provider', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, _msg, buttons) => {
      // Simulate the user tapping "Start a side thread" from the sheet.
      if (title === 'Thread options') {
        const start = (buttons || []).find((b) => b.text === 'Start a side thread');
        start?.onPress?.();
      }
    });
    mockProviders = [];

    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByTestId('sidebar-thread-options'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'No provider configured. Go to Settings to add one.',
    );
    expect(mockCreateSideThread).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Settings');
  });

  it('should navigate to settings', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByText('Settings'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Settings');
  });

  it('should navigate to remote work', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByText('Remote Work'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('RemoteWork');
  });

  // Phase 161 §4.8 — Chunk L: memory-driven IA above the single-thread shell.
  describe('memory IA sections (Chunk L)', () => {
    it("renders the Today's focus tile and memory IA without the legacy chat list", () => {
      const { getByTestId, queryByTestId } = render(<Sidebar {...defaultProps} />);
      expect(getByTestId('sidebar-todays-focus')).toBeTruthy();
      expect(getByTestId('sidebar-open-threads')).toBeTruthy();
      expect(getByTestId('sidebar-recall-input')).toBeTruthy();
      expect(getByTestId('sidebar-pinned-moments')).toBeTruthy();
      expect(queryByTestId('sidebar-time-buckets')).toBeNull();
      expect(queryByTestId('sidebar-archived-section')).toBeNull();
    });

    it('opens the Memory screen when the recall input is submitted', () => {
      const { getByTestId } = render(<Sidebar {...defaultProps} />);
      const input = getByTestId('sidebar-recall-input');
      fireEvent.changeText(input, 'beach trip');
      fireEvent(input, 'submitEditing');
      expect(mockNavigation.navigate).toHaveBeenCalledWith('Memory', {
        tab: 'facts',
        query: 'beach trip',
      });
      expect(mockNavigation.closeDrawer).toHaveBeenCalled();
    });
  });
});
