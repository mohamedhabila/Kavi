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
const mockCreateSideThread = jest.fn((parentId: string, _options?: any) => `side-of-${parentId}`);
const mockSetActiveConversation = jest.fn();
const mockDeleteConversation = jest.fn();
let mockActiveConversationId: string | null = 'conv1';
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
      activeConversationId: mockActiveConversationId,
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
  useSettingsStore: Object.assign(
    (selector: (s: any) => any) =>
      selector({
        providers: mockProviders,
        systemPrompt: 'You are helpful',
        activeProviderId: 'openai',
        activeModel: 'gpt-5.4',
        disableLongTermMemory: false,
        memoryConsolidationMode: 'auto',
        consolidationProvider: null,
      }),
    {
      getState: () => ({
        providers: mockProviders,
        systemPrompt: 'You are helpful',
        activeProviderId: 'openai',
        activeModel: 'gpt-5.4',
        disableLongTermMemory: false,
        memoryConsolidationMode: 'auto',
        consolidationProvider: null,
      }),
    },
  ),
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
    mockActiveConversationId = 'conv1';
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

  it('renders recent chats from the conversation store and marks the active chat', () => {
    const { getByText, getByTestId } = render(<Sidebar {...defaultProps} />);
    expect(getByText('First Chat')).toBeTruthy();
    expect(getByText('Second Chat')).toBeTruthy();
    expect(getByTestId('sidebar-recent-chat-conv1').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('starts a new chat in one tap', () => {
    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByTestId('sidebar-new-chat'));
    expect(mockCreateSideThread).toHaveBeenCalledWith('conv1', {
      providerId: 'openai',
      modelOverride: 'gpt-5.4',
      title: 'New Conversation',
    });
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Chat');
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  it('should materialize the canonical thread before starting a side thread when none is active', () => {
    mockActiveConversationId = null;
    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByTestId('sidebar-new-chat'));
    expect(mockGetOrCreateCanonicalThread).toHaveBeenCalledWith(
      'openai',
      'You are helpful',
      'gpt-5.4',
    );
    expect(mockCreateSideThread).toHaveBeenCalledWith('canonical-openai', {
      providerId: 'openai',
      modelOverride: 'gpt-5.4',
      title: 'New Conversation',
    });
  });

  it('should route users to settings instead of starting a side thread without a provider', () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockProviders = [];

    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByTestId('sidebar-new-chat'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'No provider configured. Go to Settings to add one.',
    );
    expect(mockCreateSideThread).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Settings', {
      destination: 'advanced-ai',
    });
  });

  it('should navigate to settings', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByText('Settings'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Settings', { destination: 'home' });
  });

  it.each([
    ['sidebar-activity', 'Activity'],
    ['sidebar-library', 'Library'],
    ['sidebar-more', 'More'],
  ])('opens the grouped destination from %s', (testID, routeName) => {
    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    fireEvent.press(getByTestId(testID));
    expect(mockNavigation.navigate).toHaveBeenCalledWith(routeName);
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  it('keeps specialist and developer screens out of primary navigation', () => {
    const { queryByText } = render(<Sidebar {...defaultProps} />);
    expect(queryByText('Scheduled Tasks')).toBeNull();
    expect(queryByText('MCP Servers')).toBeNull();
    expect(queryByText('Terminal')).toBeNull();
    expect(queryByText('Code Editor')).toBeNull();
    expect(queryByText('Remote Work')).toBeNull();
  });

  it('keeps Activity selected while viewing detailed work activity', () => {
    const props = {
      ...defaultProps,
      state: {
        ...defaultProps.state,
        index: 0,
        routes: [
          {
            key: 'agent-roster',
            name: 'AgentRoster',
            params: { initialTab: 'queue' },
          },
        ],
        routeNames: ['AgentRoster'],
      },
    } as any;

    const { getByTestId } = render(<Sidebar {...props} />);

    expect(getByTestId('sidebar-activity').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('sidebar-more').props.accessibilityState).toEqual({ selected: false });
  });

  it('keeps the originating hub selected for a shared child route', () => {
    const props = {
      ...defaultProps,
      state: {
        ...defaultProps.state,
        index: 0,
        routes: [
          {
            key: 'approval-history',
            name: 'ApprovalHistory',
            params: { returnTo: { name: 'More' } },
          },
        ],
        routeNames: ['ApprovalHistory'],
      },
    } as any;

    const { getByTestId } = render(<Sidebar {...props} />);

    expect(getByTestId('sidebar-activity').props.accessibilityState).toEqual({ selected: false });
    expect(getByTestId('sidebar-more').props.accessibilityState).toEqual({ selected: true });
  });

  it('returns to the active Assistant from any route in one tap', () => {
    const props = {
      ...defaultProps,
      state: {
        ...defaultProps.state,
        routes: [{ key: 'settings', name: 'Settings' }],
        routeNames: ['Settings'],
      },
    } as any;
    const { getByTestId } = render(<Sidebar {...props} />);

    expect(getByTestId('sidebar-assistant').props.accessibilityLabel).toBe('Assistant');
    fireEvent.press(getByTestId('sidebar-assistant'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith('Chat');
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  it('opens the exact selected recent conversation', () => {
    const { getByTestId } = render(<Sidebar {...defaultProps} />);

    fireEvent.press(getByTestId('sidebar-recent-chat-conv2'));

    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv2');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Chat');
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  it('opens the complete Chats route from recent chats', () => {
    const { getByTestId } = render(<Sidebar {...defaultProps} />);

    const seeAll = getByTestId('sidebar-see-all-chats');
    expect(seeAll.props.accessibilityLabel).toBe('See all');
    fireEvent.press(seeAll);

    expect(mockNavigation.navigate).toHaveBeenCalledWith('Chats');
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  describe('contextual memory', () => {
    it('omits empty Focus and memory diagnostics from primary navigation', () => {
      const { queryByTestId } = render(<Sidebar {...defaultProps} />);
      expect(queryByTestId('sidebar-todays-focus')).toBeNull();
      expect(queryByTestId('sidebar-open-threads')).toBeNull();
      expect(queryByTestId('sidebar-recall-input')).toBeNull();
      expect(queryByTestId('sidebar-pinned-moments')).toBeNull();
      expect(queryByTestId('sidebar-memory-stats')).toBeNull();
    });
  });
});
