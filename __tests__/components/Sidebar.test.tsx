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

  it('should render conversation list', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    expect(getByText('First Chat')).toBeTruthy();
    expect(getByText('Second Chat')).toBeTruthy();
  });

  it('should render usage summaries for conversations', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);

    expect(getByText('1.2K tok · $0.0042')).toBeTruthy();
    expect(getByText('0 tok · $0.0000')).toBeTruthy();
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

  it('should select conversation on press', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByText('Second Chat'));
    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv2');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Chat');
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

  it('should show delete confirmation on long press', () => {
    jest.spyOn(Alert, 'alert');
    const { getByText } = render(<Sidebar {...defaultProps} />);
    fireEvent(getByText('First Chat'), 'onLongPress');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Chat',
      'Delete "First Chat"?',
      expect.any(Array),
    );
  });

  it('hides side-thread conversations from the main list', () => {
    mockConversations.push({
      id: 'side-1',
      title: 'Tangent off First Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerId: 'openai',
      // @ts-expect-error model field on test fixture for legacy parity
      model: 'gpt-5.4',
      isSideThread: true,
      parentConversationId: 'conv1',
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
    } as any);

    try {
      const { queryByText, getByText } = render(<Sidebar {...defaultProps} />);
      // Main conversations still visible.
      expect(getByText('First Chat')).toBeTruthy();
      expect(getByText('Second Chat')).toBeTruthy();
      // Side thread filtered out.
      expect(queryByText('Tangent off First Chat')).toBeNull();
    } finally {
      mockConversations.pop();
    }
  });

  it('hides archived conversations from the main list and exposes them under the Archived section', () => {
    mockConversations.push({
      id: 'archived-1',
      title: 'Pre-collapse Chat',
      messages: [],
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      providerId: 'openai',
      // @ts-expect-error legacy fixture shape
      model: 'gpt-5.4',
      archivedFromMigration: true,
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
    } as any);

    try {
      const { queryByText, getByTestId } = render(<Sidebar {...defaultProps} />);
      // Hidden from main list by default.
      expect(queryByText('Pre-collapse Chat')).toBeNull();
      // Archived header is rendered with the count.
      const toggle = getByTestId('sidebar-archived-toggle');
      expect(toggle).toBeTruthy();
      // Expand and verify the archived row appears.
      fireEvent.press(toggle);
      expect(getByTestId('sidebar-archived-item-archived-1')).toBeTruthy();
      expect(queryByText('Pre-collapse Chat')).toBeTruthy();
    } finally {
      mockConversations.pop();
    }
  });

  // Phase 161 §4.8 — Chunk L: new memory-driven IA above the conversation list.
  describe('memory IA sections (Chunk L)', () => {
    it("renders the Today's focus tile, recall input, and time-bucket container", () => {
      const { getByTestId } = render(<Sidebar {...defaultProps} />);
      expect(getByTestId('sidebar-todays-focus')).toBeTruthy();
      expect(getByTestId('sidebar-open-threads')).toBeTruthy();
      expect(getByTestId('sidebar-recall-input')).toBeTruthy();
      expect(getByTestId('sidebar-pinned-moments')).toBeTruthy();
      expect(getByTestId('sidebar-time-buckets')).toBeTruthy();
    });

    it('groups conversations into Today and Yesterday time buckets', () => {
      const { getByTestId, queryByTestId } = render(<Sidebar {...defaultProps} />);
      // First Chat (now) → today; Second Chat (now-86400000) → yesterday.
      expect(getByTestId('sidebar-time-bucket-today')).toBeTruthy();
      expect(getByTestId('sidebar-time-bucket-yesterday')).toBeTruthy();
      expect(queryByTestId('sidebar-time-bucket-thisWeek')).toBeNull();
    });

    it('collapses a time bucket on header press and hides its rows', () => {
      const { getByTestId, queryByText } = render(<Sidebar {...defaultProps} />);
      expect(queryByText('First Chat')).toBeTruthy();
      fireEvent.press(getByTestId('sidebar-time-bucket-toggle-today'));
      expect(queryByText('First Chat')).toBeNull();
      // Yesterday bucket is unaffected.
      expect(queryByText('Second Chat')).toBeTruthy();
    });

    it('opens the Memory screen when the recall input is submitted', () => {
      const { getByTestId } = render(<Sidebar {...defaultProps} />);
      const input = getByTestId('sidebar-recall-input');
      fireEvent.changeText(input, 'beach trip');
      fireEvent(input, 'submitEditing');
      expect(mockNavigation.navigate).toHaveBeenCalledWith('Memory');
      expect(mockNavigation.closeDrawer).toHaveBeenCalled();
    });
  });
});
