import { fireEvent, render } from '@testing-library/react-native';

import { ToolCallDisplay } from '../../src/components/chat/ToolCallDisplay';
import { parseToolCallSetupCard } from '../../src/components/chat/ToolCallSetupCard';
import { makeToolCall } from '../helpers/toolCallDisplayFixtures';

const mockNavigate = jest.fn();
const mockOpenAssistantSettings = jest.fn(async () => true);
const mockOpenNotificationAccessSettings = jest.fn(async () => true);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('../../src/services/assistant/assistantRole', () => ({
  openAssistantSettings: () => mockOpenAssistantSettings(),
}));
jest.mock('../../src/services/notifications/notificationReader', () => ({
  openNotificationAccessSettings: () => mockOpenNotificationAccessSettings(),
}));
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      border: '#333',
      danger: '#f00',
      success: '#0f0',
      primary: '#08f',
      primarySoft: '#024',
      toolCard: '#111',
      toolCardHeader: '#222',
      codeBackground: '#000',
    },
  }),
  AppPalette: {},
}));

function setupCall(body: Record<string, unknown>) {
  return makeToolCall({
    name: 'setup_guide',
    arguments: JSON.stringify({ topic: body.topic }),
    status: 'completed',
    result: JSON.stringify(body),
  });
}

const NOTION_GUIDE = {
  topic: 'connect_app',
  status: 'setup_needed',
  guide: {
    optionId: 'notion',
    options: [{ id: 'notion', name: 'Notion' }],
    form: {
      kind: 'settings',
      section: 'mcp-edit',
      draft: { name: 'Notion', url: 'https://mcp.notion.com/mcp' },
    },
  },
};

beforeEach(() => jest.clearAllMocks());

describe('setup card', () => {
  it("opens the MCP form with the service's address and comes back to the chat", () => {
    const { getByText, getByTestId } = render(
      <ToolCallDisplay toolCall={setupCall(NOTION_GUIDE)} />,
    );

    expect(getByText('Connect Notion')).toBeTruthy();
    fireEvent.press(getByTestId('setup-card-open-connect_app'));

    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      destination: 'connections',
      section: 'mcp-edit',
      setupDraft: { name: 'Notion', url: 'https://mcp.notion.com/mcp' },
      setupRequestId: expect.any(Number),
      returnTo: { name: 'Chat' },
    });
  });

  it('tells Kavi the person finished, so it checks and carries on', () => {
    const { getByTestId } = render(<ToolCallDisplay toolCall={setupCall(NOTION_GUIDE)} />);

    fireEvent.press(getByTestId('setup-card-done-connect_app'));

    expect(mockNavigate).toHaveBeenCalledWith('Chat', {
      incomingRequest: { requestId: expect.any(Number), text: expect.any(String) },
    });
    const text = mockNavigate.mock.calls[0][1].incomingRequest.text as string;
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe('setupGuide.doneMessage');
  });

  it('opens the phone setting a phone-access guide needs', () => {
    const assistant = render(
      <ToolCallDisplay
        toolCall={setupCall({
          topic: 'phone_access',
          status: 'setup_needed',
          guide: { form: { kind: 'system', access: 'assistant_role' } },
        })}
      />,
    );
    fireEvent.press(assistant.getByTestId('setup-card-open-phone_access'));
    assistant.unmount();

    const notifications = render(
      <ToolCallDisplay
        toolCall={setupCall({
          topic: 'phone_access',
          status: 'setup_needed',
          guide: { form: { kind: 'system', access: 'notification_access' } },
        })}
      />,
    );
    fireEvent.press(notifications.getByTestId('setup-card-open-phone_access'));

    expect(mockOpenAssistantSettings).toHaveBeenCalledTimes(1);
    expect(mockOpenNotificationAccessSettings).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows no buttons once the topic is set up', () => {
    const { queryByTestId, getByTestId } = render(
      <ToolCallDisplay toolCall={setupCall({ ...NOTION_GUIDE, status: 'already_set_up' })} />,
    );

    expect(getByTestId('setup-card-connect_app')).toBeTruthy();
    expect(queryByTestId('setup-card-open-connect_app')).toBeNull();
    expect(queryByTestId('setup-card-done-connect_app')).toBeNull();
  });
});

describe('parseToolCallSetupCard', () => {
  it('reads only setup_guide results with a known topic', () => {
    expect(parseToolCallSetupCard('read_file', JSON.stringify(NOTION_GUIDE))).toBeNull();
    expect(parseToolCallSetupCard('setup_guide', undefined)).toBeNull();
    expect(parseToolCallSetupCard('setup_guide', 'not json')).toBeNull();
    expect(parseToolCallSetupCard('setup_guide', JSON.stringify({ topic: 'quantum' }))).toBeNull();
  });

  it('shows no card when there is no form it knows to open', () => {
    expect(
      parseToolCallSetupCard(
        'setup_guide',
        JSON.stringify({
          topic: 'server',
          status: 'setup_needed',
          guide: { form: { kind: 'settings', section: 'danger-zone' } },
        }),
      ),
    ).toBeNull();
    expect(
      parseToolCallSetupCard(
        'setup_guide',
        JSON.stringify({
          topic: 'phone_access',
          guide: { form: { kind: 'system', access: 'sms' } },
        }),
      ),
    ).toBeNull();
    expect(
      parseToolCallSetupCard(
        'setup_guide',
        JSON.stringify({ topic: 'phone_access', status: 'not_possible_on_this_phone', guide: {} }),
      ),
    ).toBeNull();
  });

  it('names the service only on a connect_app guide', () => {
    expect(
      parseToolCallSetupCard(
        'setup_guide',
        JSON.stringify({ ...NOTION_GUIDE, topic: 'service_key' }),
      ),
    ).not.toHaveProperty('serviceName');
  });
});
