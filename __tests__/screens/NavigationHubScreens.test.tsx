import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActivityScreen } from '../../src/screens/ActivityScreen';
import { DeveloperWorkScreen } from '../../src/screens/DeveloperWorkScreen';
import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { MoreScreen } from '../../src/screens/MoreScreen';

const mockNavigation = {
  navigate: jest.fn(),
  openDrawer: jest.fn(),
  goBack: jest.fn(),
  canGoBack: jest.fn(),
};
let mockRouteName = 'More';
let mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ name: mockRouteName, params: mockRouteParams }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => <>{children}</>,
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      border: '#333',
      header: '#111',
      primary: '#0f0',
      primarySoft: '#030',
      surface: '#111',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
    },
  }),
}));

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../../src/services/remote/approvalStore', () => ({
  useApprovalStore: (selector: (state: any) => unknown) =>
    selector({
      requests: {
        pending: { status: 'pending' },
        resolved: { status: 'approved' },
      },
    }),
}));

jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: (selector: (state: any) => unknown) =>
    selector({
      jobs: [
        { id: 'enabled', enabled: true },
        { id: 'disabled', enabled: false },
      ],
    }),
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (state: any) => unknown) =>
    selector({ activeConversationId: 'conversation-42' }),
}));

describe('navigation hub screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteName = 'More';
    mockRouteParams = {};
  });

  it('routes Activity choices to decisions, reminders, and detailed work', () => {
    const { getByTestId } = render(<ActivityScreen />);

    fireEvent.press(getByTestId('activity-hub-pending-decisions'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('ApprovalHistory', {
      returnTo: { name: 'Activity' },
    });

    fireEvent.press(getByTestId('activity-hub-reminders-automations'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Scheduler', {
      returnTo: { name: 'Activity' },
    });

    fireEvent.press(getByTestId('activity-hub-work-activity'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('AgentRoster', {
      initialTab: 'queue',
      returnTo: { name: 'Activity' },
    });
  });

  it('opens the active conversation workspace from Library', () => {
    const { getByTestId } = render(<LibraryScreen />);

    fireEvent.press(getByTestId('library-hub-files-creations'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith('ConversationFiles', {
      conversationId: 'conversation-42',
      returnTo: { name: 'Library' },
    });
  });

  it('keeps specialist destinations nested under More', () => {
    const { getByTestId } = render(<MoreScreen />);

    fireEvent.press(getByTestId('more-hub-skills'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Skills', {
      returnTo: { name: 'More' },
    });

    fireEvent.press(getByTestId('more-hub-developer-remote-work'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('DeveloperWork', {
      returnTo: { name: 'More' },
    });
  });

  it('keeps developer tools reachable from their dedicated hub', () => {
    const { getByTestId } = render(<DeveloperWorkScreen />);

    fireEvent.press(getByTestId('developer-work-hub-terminal'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Terminal', {
      returnTo: { name: 'DeveloperWork' },
    });

    fireEvent.press(getByTestId('developer-work-hub-code-editor'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('CodeEditor', {
      returnTo: { name: 'DeveloperWork' },
    });

    fireEvent.press(getByTestId('developer-work-hub-remote-work'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('RemoteWork', {
      returnTo: { name: 'DeveloperWork' },
    });
  });

  it('keeps the active Assistant one tap away from every hub', () => {
    const { getByTestId } = render(<MoreScreen />);

    fireEvent.press(getByTestId('more-hub-open-assistant'));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Chat');

    fireEvent.press(getByTestId('more-hub-leading'));
    expect(mockNavigation.openDrawer).toHaveBeenCalled();
  });

  it('returns a nested hub to its declared parent in one tap', () => {
    mockRouteName = 'DeveloperWork';
    mockRouteParams = { returnTo: { name: 'More' } };
    const { getByTestId } = render(<DeveloperWorkScreen />);

    fireEvent.press(getByTestId('developer-work-hub-leading'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith('More');
  });
});
