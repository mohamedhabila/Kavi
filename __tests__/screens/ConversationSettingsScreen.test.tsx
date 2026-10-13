import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ConversationSettingsScreen } from '../../src/screens/ConversationSettingsScreen';

const mockNavigate = jest.fn();
const mockBackToChat = jest.fn();
const mockUpdateModel = jest.fn();
const mockUpdatePersona = jest.fn();
const mockSetActiveProviderAndModel = jest.fn();
const mockSetLastUsedModel = jest.fn();
let mockRouteParams: Record<string, unknown> = { conversationId: 'conversation-1' };

const mockConversation: any = {
  id: 'conversation-1',
  title: 'Plan a family trip',
  messages: [],
  providerId: 'provider-1',
  modelOverride: 'model-1',
  personaId: 'default',
  systemPrompt: '',
  createdAt: 1,
  updatedAt: 1,
};

const mockChatState = {
  conversations: [mockConversation],
  activeConversationId: 'conversation-1',
  isLoading: false,
  updateModelInConversation: mockUpdateModel,
  updatePersonaInConversation: mockUpdatePersona,
};

const mockSettingsState = {
  providers: [
    {
      id: 'provider-1',
      name: 'OpenRouter',
      model: 'model-1',
      enabled: true,
      availableModels: ['model-1', 'model-2'],
    },
  ],
  activeModel: 'model-1',
  activeProviderId: 'provider-1',
  setActiveProviderAndModel: mockSetActiveProviderAndModel,
  setLastUsedModel: mockSetLastUsedModel,
};

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ name: 'ConversationSettings', params: mockRouteParams }),
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: () => mockBackToChat,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => <>{children}</>,
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (state: typeof mockChatState) => unknown) => selector(mockChatState),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState),
}));

jest.mock('../../src/components/chat/ModelSelector', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    ModelSelector: ({ disabled, onSelect }: any) => (
      <TouchableOpacity
        disabled={disabled}
        onPress={() => onSelect('provider-1', 'model-2')}
        testID="mock-model-selector"
      >
        <Text>model-1</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../src/components/chat/PersonaSelector', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    PersonaSelector: ({ disabled, onSelect, selectedPersonaId }: any) => (
      <TouchableOpacity
        disabled={disabled}
        onPress={() => onSelect('writer')}
        testID="mock-persona-selector"
      >
        <Text>{selectedPersonaId}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000000',
      border: '#333333',
      danger: '#ff4444',
      dangerSoft: '#331111',
      header: '#111111',
      onPrimary: '#ffffff',
      primary: '#3388ff',
      primarySoft: '#112244',
      surface: '#181818',
      surfaceAlt: '#242424',
      text: '#ffffff',
      textSecondary: '#bbbbbb',
      textTertiary: '#888888',
    },
  }),
}));

const translations: Record<string, string> = {
  'chat.advancedAiModel': 'AI model override',
  'chat.advancedAiModelHint': 'Optional model setting',
  'chat.assistantStyle': 'Assistant style',
  'chat.assistantStyleHint': 'Choose a response style.',
  'chat.conversationSettings': 'Conversation settings',
  'chat.hideUsageDetails': 'Hide usage details',
  'chat.logsEmpty': 'No logs yet.',
  'chat.showLogs': 'Show logs',
  'chat.showUsageDetails': 'Show usage details',
  'chat.usageActivity': 'Usage & activity',
  'chat.usageActivityHint': 'Optional technical details.',
  'common.back': 'Back',
  'nav.advancedAI': 'Advanced AI',
};

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}));

describe('ConversationSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { conversationId: 'conversation-1' };
    mockConversation.personaId = 'default';
    mockConversation.logs = undefined;
    mockConversation.usage = undefined;
    mockChatState.isLoading = false;
  });

  it('always offers the assistant style picker, selecting the default persona when none is set', () => {
    mockConversation.personaId = undefined;
    const { getByTestId, getByText } = render(<ConversationSettingsScreen />);

    expect(getByTestId('conversation-style-section')).toBeTruthy();
    expect(getByText('Assistant style')).toBeTruthy();
    expect(getByText('default')).toBeTruthy();
  });

  it("selects the conversation's chosen persona", () => {
    mockConversation.personaId = 'researcher';
    const { getByText } = render(<ConversationSettingsScreen />);

    expect(getByText('researcher')).toBeTruthy();
  });

  it('applies a selected response style to the conversation', () => {
    const { getByTestId } = render(<ConversationSettingsScreen />);

    fireEvent.press(getByTestId('mock-persona-selector'));

    expect(mockUpdatePersona).toHaveBeenCalledWith('conversation-1', 'writer');
  });

  it('applies a conversation model override consistently', () => {
    const { getByTestId } = render(<ConversationSettingsScreen />);

    fireEvent.press(getByTestId('mock-model-selector'));

    expect(mockSetActiveProviderAndModel).toHaveBeenCalledWith('provider-1', 'model-2');
    expect(mockUpdateModel).toHaveBeenCalledWith('conversation-1', 'provider-1', 'model-2');
    expect(mockSetLastUsedModel).toHaveBeenCalledWith('provider-1', 'model-2');
  });

  it('links advanced provider setup without exposing it in the primary header', () => {
    const { getByTestId } = render(<ConversationSettingsScreen />);

    const advancedAi = getByTestId('conversation-open-advanced-ai');
    expect(advancedAi.props.accessibilityLabel).toBe('Advanced AI');
    fireEvent.press(advancedAi);
    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      destination: 'advanced-ai',
      returnTo: {
        name: 'ConversationSettings',
        params: {
          conversationId: 'conversation-1',
        },
      },
    });
  });

  it('keeps usage details collapsed until requested', () => {
    const { getByTestId, queryByTestId } = render(<ConversationSettingsScreen />);

    expect(queryByTestId('chat-usage-strip')).toBeNull();
    const usageToggle = getByTestId('conversation-usage-toggle');
    expect(usageToggle.props.accessibilityLabel).toBe('Show usage details');
    expect(usageToggle.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(usageToggle);

    expect(getByTestId('chat-usage-strip')).toBeTruthy();
    expect(getByTestId('conversation-usage-toggle').props.accessibilityLabel).toBe(
      'Hide usage details',
    );
    expect(getByTestId('conversation-usage-toggle').props.accessibilityState).toEqual({
      expanded: true,
    });
    fireEvent.press(getByTestId('chat-logs-toggle'));
    expect(getByTestId('chat-logs-panel')).toBeTruthy();
  });

  it('opens usage directly from the two-tap chat overflow route', () => {
    mockRouteParams = { conversationId: 'conversation-1', showUsage: true };
    const { getByTestId } = render(<ConversationSettingsScreen />);

    expect(getByTestId('conversation-usage-details')).toBeTruthy();
    expect(getByTestId('chat-usage-strip')).toBeTruthy();
  });

  it('keeps the complete event log available in the expanded details', () => {
    mockConversation.logs = Array.from({ length: 15 }, (_value, index) => ({
      id: `log-${index + 1}`,
      timestamp: 1_700_000_000_000 + index,
      level: 'info',
      kind: 'system',
      title: `Log ${index + 1}`,
      detail: `Detail ${index + 1}`,
    }));
    const { getByTestId, getByText } = render(<ConversationSettingsScreen />);

    fireEvent.press(getByTestId('conversation-usage-toggle'));
    fireEvent.press(getByTestId('chat-logs-toggle'));

    expect(getByTestId('chat-logs-scroll')).toBeTruthy();
    expect(getByText('15/15')).toBeTruthy();
    expect(getByText('Log 1')).toBeTruthy();
    expect(getByText('Log 15')).toBeTruthy();
  });
});
