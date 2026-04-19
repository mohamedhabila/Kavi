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

  it('should create new conversation on plus button press', () => {
    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    const plusIcon = getByTestId('icon-Plus');
    fireEvent.press(plusIcon.parent || plusIcon);
    expect(mockCreateConversation).toHaveBeenCalledWith('openai', 'You are helpful', 'gpt-5.4');
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });

  it('should route users to settings instead of creating a providerless conversation', () => {
    jest.spyOn(Alert, 'alert');
    mockProviders = [];

    const { getByTestId } = render(<Sidebar {...defaultProps} />);
    const plusIcon = getByTestId('icon-Plus');
    fireEvent.press(plusIcon.parent || plusIcon);

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'No provider configured. Go to Settings to add one.',
    );
    expect(mockCreateConversation).not.toHaveBeenCalled();
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
});
