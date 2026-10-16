import { waitFor } from '@testing-library/react-native';

import {
  renderSettingsScreen,
  settingsMocks,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

// A setup card in the chat opens a Settings form filled in with what the guide knows.
describe('SettingsScreen opened by a setup guide', () => {
  setupSettingsScreenTestSuite({ destination: 'connections' });

  it("opens a new MCP connection with the service's address", async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen({
      destination: 'connections',
      section: 'mcp-edit',
      setupDraft: { name: 'Notion', url: 'https://mcp.notion.com/mcp' },
      setupRequestId: 1,
    });

    await waitFor(() => expect(getByText('Add MCP Server')).toBeTruthy());
    expect(getByDisplayValue('Notion')).toBeTruthy();
    expect(getByDisplayValue('https://mcp.notion.com/mcp')).toBeTruthy();
  });

  it('leaves out an address that is not https and anything else the draft carries', async () => {
    const { getByText, getByDisplayValue, queryByDisplayValue } = renderSettingsScreen({
      destination: 'connections',
      section: 'mcp-edit',
      setupDraft: {
        url: 'http://plain.example.com/mcp',
        headers: { Authorization: 'Bearer stolen' },
      },
      setupRequestId: 2,
    });

    await waitFor(() => expect(getByText('Add MCP Server')).toBeTruthy());
    expect(getByDisplayValue('Add MCP Server')).toBeTruthy();
    expect(queryByDisplayValue('http://plain.example.com/mcp')).toBeNull();
    expect(queryByDisplayValue('Bearer stolen')).toBeNull();
  });

  it("opens a new SSH server with the guide's port, username and login type", async () => {
    const { getByText, getByDisplayValue, getByTestId } = renderSettingsScreen({
      destination: 'developer-remote-work',
      section: 'ssh-edit',
      setupDraft: { port: 2222, username: 'ubuntu', authMode: 'private-key' },
      setupRequestId: 3,
    });

    await waitFor(() => expect(getByText('Add SSH Target')).toBeTruthy());
    expect(getByDisplayValue('ubuntu')).toBeTruthy();
    expect(getByDisplayValue('2222')).toBeTruthy();
    expect(getByTestId('ssh-auth-private-key').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('opens a new Expo account of the type the guide names', async () => {
    const { getByTestId } = renderSettingsScreen({
      destination: 'developer-remote-work',
      section: 'expo-account-edit',
      setupDraft: { accountType: 'robot' },
      setupRequestId: 4,
    });

    await waitFor(() =>
      expect(getByTestId('expo-account-type-robot').props.accessibilityState).toEqual({
        selected: true,
      }),
    );
  });

  it('opens Gemini on the Gemini API with a free-tier model, for the AI Studio key the guide hands out', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen({
      destination: 'advanced-ai',
      section: 'provider-edit',
      setupDraft: { provider: 'gemini' },
      setupRequestId: 5,
    });

    await waitFor(() => expect(getByText('Add Provider')).toBeTruthy());
    expect(getByDisplayValue('Gemini')).toBeTruthy();
    expect(
      getByDisplayValue('https://generativelanguage.googleapis.com/v1beta/openai'),
    ).toBeTruthy();
    expect(getByDisplayValue('gemini-3.8-flash')).toBeTruthy();
    expect(settingsMocks.addProvider).not.toHaveBeenCalled();
  });

  it('opens a blank provider form when the draft names no provider Kavi knows', async () => {
    const { getByText, queryByDisplayValue } = renderSettingsScreen({
      destination: 'advanced-ai',
      section: 'provider-edit',
      setupDraft: { provider: 'acme' },
      setupRequestId: 6,
    });

    await waitFor(() => expect(getByText('Add Provider')).toBeTruthy());
    expect(queryByDisplayValue('Gemini')).toBeNull();
  });
});
