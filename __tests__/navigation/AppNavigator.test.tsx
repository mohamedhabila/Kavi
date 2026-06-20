// ---------------------------------------------------------------------------
// Tests — AppNavigator
// ---------------------------------------------------------------------------

import { act, render } from '@testing-library/react-native';
import { AppNavigator } from '../../src/navigation/AppNavigator';

const mockSetActiveConversation = jest.fn();
const mockSubscribeToNotificationRoutes = jest.fn();
const mockGetPendingNotificationRoute = jest.fn().mockResolvedValue(null);
const mockRunJobNow = jest.fn().mockResolvedValue({ status: 'completed' });
let mockChatHydrated = true;
const mockChatHydrationListeners = new Set<() => void>();
const mockChatState = {
  conversations: [{ id: 'conv-1' }],
  setActiveConversation: (...args: any[]) => mockSetActiveConversation(...args),
};

function emitChatHydrated(): void {
  mockChatHydrated = true;
  for (const listener of Array.from(mockChatHydrationListeners)) {
    listener();
  }
}

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      header: '#111',
      border: '#333',
      text: '#fff',
      primary: '#0f0',
      danger: '#f00',
    },
  }),
  getNavigationTheme: (colors: any) => ({
    dark: colors.mode === 'dark',
    colors: {
      primary: colors.primary,
      background: colors.background,
      card: colors.header,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  }),
  AppPalette: {},
}));

// Mock screens to avoid deep rendering
jest.mock('../../src/screens/ChatScreen', () => ({
  ChatScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'ChatScreen'));
  },
}));

jest.mock('../../src/screens/ConversationFilesScreen', () => ({
  ConversationFilesScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(
      View,
      null,
      React.createElement(Text, null, 'ConversationFilesScreen'),
    );
  },
}));

jest.mock('../../src/screens/SettingsScreen', () => ({
  SettingsScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'SettingsScreen'));
  },
}));

jest.mock('../../src/components/sidebar/Sidebar', () => ({
  Sidebar: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'Sidebar'));
  },
}));

// Mock new screens added by the rewrite
jest.mock('../../src/screens/SchedulerScreen', () => ({
  SchedulerScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'SchedulerScreen'));
  },
}));

jest.mock('../../src/screens/McpStatusScreen', () => ({
  McpStatusScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'McpStatusScreen'));
  },
}));

jest.mock('../../src/screens/SkillsScreen', () => ({
  SkillsScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'SkillsScreen'));
  },
}));

jest.mock('../../src/screens/CanvasScreen', () => ({
  CanvasScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'CanvasScreen'));
  },
}));

jest.mock('../../src/screens/VoiceScreen', () => ({
  VoiceScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'VoiceScreen'));
  },
}));

jest.mock('../../src/screens/GatewayScreen', () => ({
  GatewayScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'GatewayScreen'));
  },
}));

jest.mock('../../src/screens/RemoteWorkScreen', () => ({
  RemoteWorkScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'RemoteWorkScreen'));
  },
}));

jest.mock('../../src/screens/ApprovalHistoryScreen', () => ({
  ApprovalHistoryScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(
      View,
      null,
      React.createElement(Text, null, 'ApprovalHistoryScreen'),
    );
  },
}));

jest.mock('../../src/components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: (_props: any) => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(View, null, React.createElement(Text, null, 'OnboardingWizard'));
  },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatState,
    persist: {
      hasHydrated: () => mockChatHydrated,
      onFinishHydration: (listener: () => void) => {
        mockChatHydrationListeners.add(listener);
        return () => {
          mockChatHydrationListeners.delete(listener);
        };
      },
    },
  },
}));

jest.mock('../../src/services/notifications/service', () => ({
  subscribeToNotificationRoutes: (...args: any[]) => mockSubscribeToNotificationRoutes(...args),
  getPendingNotificationRoute: (...args: any[]) => mockGetPendingNotificationRoute(...args),
}));

jest.mock('../../src/services/scheduler/engine', () => ({
  runJobNow: (...args: any[]) => mockRunJobNow(...args),
}));

const AsyncStorageMod = require('@react-native-async-storage/async-storage');
const mockAsyncStorage = AsyncStorageMod.default || AsyncStorageMod;

describe('AppNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChatHydrated = true;
    mockChatHydrationListeners.clear();
    mockChatState.conversations = [{ id: 'conv-1' }];
    // Default: onboarding not complete
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockGetPendingNotificationRoute.mockResolvedValue(null);
    mockSubscribeToNotificationRoutes.mockImplementation(() => jest.fn());
    mockRunJobNow.mockResolvedValue({ status: 'completed' });
  });

  it('should render without crashing', async () => {
    render(<AppNavigator />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(true).toBe(true);
  });

  it('should show onboarding when not completed', async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    const { findByText } = render(<AppNavigator />);
    const wizard = await findByText('OnboardingWizard');
    expect(wizard).toBeTruthy();
  });

  it('should render drawer navigator when onboarding is completed', async () => {
    mockAsyncStorage.getItem.mockResolvedValue('true');
    const { queryByText } = render(<AppNavigator />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // When onboarding is complete, OnboardingWizard should NOT be rendered
    expect(queryByText('OnboardingWizard')).toBeNull();
  });

  it('verifies onboarding key is checked', async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    render(<AppNavigator />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('kavi_onboarding_complete');
  });

  it('activates the linked conversation when a notification route arrives', async () => {
    mockAsyncStorage.getItem.mockResolvedValue('true');
    let routeHandler:
      | ((route: { conversationId?: string; jobId?: string; source?: string }) => void)
      | undefined;
    mockSubscribeToNotificationRoutes.mockImplementation((handler) => {
      routeHandler = handler;
      return jest.fn();
    });

    render(<AppNavigator />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      routeHandler?.({ conversationId: 'conv-1' });
    });
    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-1');
  });

  it('runs a scheduled job when a wake notification route arrives', async () => {
    mockAsyncStorage.getItem.mockResolvedValue('true');
    let routeHandler:
      | ((route: { conversationId?: string; jobId?: string; source?: string }) => void)
      | undefined;
    mockSubscribeToNotificationRoutes.mockImplementation((handler) => {
      routeHandler = handler;
      return jest.fn();
    });

    render(<AppNavigator />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      routeHandler?.({ jobId: 'job-1', source: 'scheduled_task_wake' });
    });
    expect(mockRunJobNow).toHaveBeenCalledWith('job-1', { trigger: 'notification-tap' });
  });

  it('waits for chat hydration before activating a pending notification conversation', async () => {
    mockChatHydrated = false;
    mockAsyncStorage.getItem.mockResolvedValue('true');
    mockGetPendingNotificationRoute.mockResolvedValue({ conversationId: 'conv-1' });

    render(<AppNavigator />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockSetActiveConversation).not.toHaveBeenCalled();

    await act(async () => {
      emitChatHydrated();
    });

    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-1');
  });
});
