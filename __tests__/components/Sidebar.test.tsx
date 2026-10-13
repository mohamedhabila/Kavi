// ---------------------------------------------------------------------------
// Tests — Sidebar Component
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Sidebar } from '../../src/components/sidebar/Sidebar';

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
  });

  it('offers the one conversation, with no way to start or list others', () => {
    const { getByTestId, queryByTestId, queryByText } = render(<Sidebar {...defaultProps} />);

    expect(getByTestId('sidebar-assistant')).toBeTruthy();
    expect(queryByTestId('sidebar-new-chat')).toBeNull();
    expect(queryByText('Recent chats')).toBeNull();
  });

  it('should render the title', () => {
    const { getByText } = render(<Sidebar {...defaultProps} />);
    expect(getByText('Kavi')).toBeTruthy();
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
