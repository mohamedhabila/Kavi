import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { LOCALE_DISPLAY_NAMES } from '../../src/i18n/registry';

import {
  renderSettingsScreen,
  settingsMocks,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

describe('SettingsScreen general', () => {
  setupSettingsScreenTestSuite();

  it('should render the settings screen with title', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('Settings')).toBeTruthy();
  });

  it('opens Advanced AI as a focused provider destination', () => {
    const { getByTestId, getByText, queryByText } = renderSettingsScreen({
      destination: 'advanced-ai',
    });

    expect(getByTestId('settings-advanced-ai')).toBeTruthy();
    expect(getByText('Advanced AI')).toBeTruthy();
    expect(getByText('AI Providers')).toBeTruthy();
    expect(queryByText('MCP Servers')).toBeNull();
    expect(queryByText('Clear All Conversations')).toBeNull();
  });

  it('renders a compact, searchable Settings home', () => {
    const { getAllByRole, getByTestId, queryByTestId } = renderSettingsScreen({
      destination: 'home',
    });

    expect(getByTestId('settings-home')).toBeTruthy();
    expect(getAllByRole('button').length + 1).toBeLessThan(40);

    fireEvent.changeText(getByTestId('settings-home-search'), 'privacy');

    expect(getByTestId('settings-home-memory-privacy')).toBeTruthy();
    expect(queryByTestId('settings-home-advanced-ai')).toBeNull();
  });

  it('opens a Settings category as a child of the home', () => {
    const { getByTestId } = renderSettingsScreen({
      destination: 'home',
      returnTo: { name: 'More' },
    });

    fireEvent.press(getByTestId('settings-home-tools-permissions'));

    expect(settingsMocks.navigate).toHaveBeenCalledWith('Settings', {
      destination: 'tools-permissions',
      parentDestination: 'home',
      returnTo: { name: 'More' },
    });
  });

  it('keeps Assistant and appearance controls in distinct destinations', () => {
    const assistant = renderSettingsScreen({ destination: 'assistant-personalization' });
    expect(assistant.getByText('Thinking Level')).toBeTruthy();
    expect(assistant.getByText('Configure Personas')).toBeTruthy();
    expect(assistant.queryByText('Appearance')).toBeNull();
    assistant.unmount();

    const appearance = renderSettingsScreen({ destination: 'appearance-language' });
    expect(appearance.getByText('Appearance')).toBeTruthy();
    expect(appearance.getByText('Language')).toBeTruthy();
    expect(appearance.queryByText('Thinking Level')).toBeNull();
    expect(appearance.queryByText('Configure Personas')).toBeNull();
  });

  it('limits Connections to browser and MCP services', () => {
    const { getByText, queryByText } = renderSettingsScreen({ destination: 'connections' });

    expect(getByText('Browser Providers')).toBeTruthy();
    expect(getByText('MCP Servers')).toBeTruthy();
    expect(queryByText('SSH Targets')).toBeNull();
    expect(queryByText('AI Providers')).toBeNull();
  });

  it('limits Memory & privacy to memory and saved-data controls', () => {
    const { getByText, queryByText } = renderSettingsScreen({ destination: 'memory-privacy' });

    expect(getByText('Clear All Conversations')).toBeTruthy();
    expect(queryByText('Appearance')).toBeNull();
    expect(queryByText('MCP Servers')).toBeNull();
  });

  it('opens Voice and Automations with a return path to their Settings category', () => {
    const { getByTestId } = renderSettingsScreen({ destination: 'notifications-voice' });

    fireEvent.press(getByTestId('settings-open-voice'));
    expect(settingsMocks.navigate).toHaveBeenLastCalledWith('Voice', {
      returnTo: {
        name: 'Settings',
        params: { destination: 'notifications-voice', parentDestination: 'home' },
      },
    });

    fireEvent.press(getByTestId('settings-open-scheduler'));
    expect(settingsMocks.navigate).toHaveBeenLastCalledWith('Scheduler', {
      returnTo: {
        name: 'Settings',
        params: { destination: 'notifications-voice', parentDestination: 'home' },
      },
    });
  });

  it('clears transient destination state when returning from Advanced AI', () => {
    const { getByTestId } = renderSettingsScreen({
      destination: 'advanced-ai',
      returnTo: { name: 'More' },
    });

    const arrowIcon = getByTestId('icon-ArrowLeft');
    fireEvent.press(arrowIcon.parent || arrowIcon);

    expect(settingsMocks.setParams).toHaveBeenCalledWith({
      destination: undefined,
      parentDestination: undefined,
      returnTo: undefined,
      section: undefined,
      serverId: undefined,
    });
    expect(settingsMocks.navigate).toHaveBeenCalledWith('More');
  });

  it('returns category details to Settings home before leaving Settings', () => {
    const { getByTestId } = renderSettingsScreen({
      destination: 'tools-permissions',
      parentDestination: 'home',
      returnTo: { name: 'More' },
    });

    fireEvent.press(getByTestId('settings-back'));

    expect(settingsMocks.navigate).toHaveBeenCalledWith('Settings', {
      destination: 'home',
      parentDestination: undefined,
      returnTo: { name: 'More' },
    });
    expect(settingsMocks.setParams).not.toHaveBeenCalled();
  });

  it('should render theme section', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('Appearance')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
    expect(getByText('System')).toBeTruthy();
  });

  it('should render quick setup and section navigation chips', () => {
    const { getByText, getAllByText } = renderSettingsScreen();
    expect(getByText('Quick Setup')).toBeTruthy();
    expect(getByText('Overview')).toBeTruthy();
    expect(getAllByText('Assistant').length).toBeGreaterThan(0);
    expect(getAllByText('Tools').length).toBeGreaterThan(0);
    expect(getAllByText('Surfaces').length).toBeGreaterThan(0);
  });

  it('should change theme on button press', () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Light'));
    expect(settingsMocks.setTheme).toHaveBeenCalledWith('light');
  });

  it('should change theme to system', () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('System'));
    expect(settingsMocks.setTheme).toHaveBeenCalledWith('system');
  });

  it('should render system prompt section', () => {
    const { getAllByText, getByDisplayValue } = renderSettingsScreen();
    expect(getAllByText('System Prompt').length).toBeGreaterThan(0);
    expect(getByDisplayValue('You are helpful')).toBeTruthy();
  });

  it('should update system prompt', () => {
    const { getByDisplayValue } = renderSettingsScreen();
    fireEvent.changeText(getByDisplayValue('You are helpful'), 'New prompt');
    expect(settingsMocks.setSystemPrompt).toHaveBeenCalledWith('New prompt');
  });

  it('should render providers section', () => {
    const { getByText, getAllByText } = renderSettingsScreen();
    expect(getByText('AI Providers')).toBeTruthy();
    expect(getAllByText('OpenAI').length).toBeGreaterThanOrEqual(1);
  });

  it('should render MCP servers section', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('MCP Servers')).toBeTruthy();
    expect(getByText('Test MCP')).toBeTruthy();
    expect(getByText('Manual server · Auto transport · No auth')).toBeTruthy();
  });

  it('should render execution surface sections', () => {
    const { getByText, getAllByText } = renderSettingsScreen();
    expect(getByText('Execution Surfaces')).toBeTruthy();
    expect(getAllByText('SSH Targets').length).toBeGreaterThan(0);
    expect(getAllByText('Workspace Targets').length).toBeGreaterThan(0);
    expect(getAllByText('Browser Providers').length).toBeGreaterThan(0);
    expect(getAllByText('Expo Accounts').length).toBeGreaterThan(0);
    expect(getAllByText('Expo Projects').length).toBeGreaterThan(0);
  });

  it('should show clear all conversations button', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('Clear All Conversations')).toBeTruthy();
  });

  it('explains the separate local-data controls and opens memory management', () => {
    const { getByLabelText, getByText } = renderSettingsScreen();

    expect(
      getByText(
        'Clear conversation history here. Use Memory to clear durable memories. Delete providers and integrations, or clear service-key fields, to remove saved credentials.',
      ),
    ).toBeTruthy();
    fireEvent.press(getByLabelText('Manage Memory'));

    expect(settingsMocks.navigate).toHaveBeenCalledWith('Memory');
  });

  it('opens approval and reusable permission management', () => {
    const { getByLabelText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Approvals & permissions'));

    expect(settingsMocks.navigate).toHaveBeenCalledWith('ApprovalHistory');
  });

  it('should show confirmation dialog when clearing conversations', () => {
    jest.spyOn(Alert, 'alert');
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Clear All Conversations'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Clear All Conversations',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('should navigate back on arrow press', () => {
    const { getByTestId } = renderSettingsScreen();
    const arrowIcon = getByTestId('icon-ArrowLeft');
    fireEvent.press(arrowIcon.parent || arrowIcon);
    expect(settingsMocks.navigate).toHaveBeenCalledWith('Chat');
  });

  it('should render known provider presets', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('Anthropic')).toBeTruthy();
  });

  it('should render data section title', () => {
    const { getAllByText } = renderSettingsScreen();
    expect(getAllByText('Data').length).toBeGreaterThan(0);
  });

  it('should render web search provider controls', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('Web Search Provider')).toBeTruthy();
    expect(getByText('Brave')).toBeTruthy();
  });

  it('should render the new setup and configuration sections', () => {
    const { getByText } = renderSettingsScreen();
    expect(getByText('Thinking Level')).toBeTruthy();
    expect(getByText('Tool Permissions')).toBeTruthy();
    expect(getByText('Configure Personas')).toBeTruthy();
    expect(getByText('OpenWeather API Key')).toBeTruthy();
  });

  it('should update the preferred web search provider', () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Brave'));
    expect(settingsMocks.setWebSearchProvider).toHaveBeenCalledWith('brave');
  });

  it('should update the thinking level', () => {
    const { getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Use High thinking level'));
    expect(settingsMocks.setThinkingLevel).toHaveBeenCalledWith('high');
  });

  it('should support selecting every thinking level option', () => {
    const { getByLabelText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Use Off thinking level'));
    fireEvent.press(getByLabelText('Use Minimal thinking level'));
    fireEvent.press(getByLabelText('Use Low thinking level'));
    fireEvent.press(getByLabelText('Use Medium thinking level'));
    fireEvent.press(getByLabelText('Use High thinking level'));
    fireEvent.press(getByLabelText('Use Max thinking level'));

    expect(settingsMocks.setThinkingLevel).toHaveBeenNthCalledWith(1, 'off');
    expect(settingsMocks.setThinkingLevel).toHaveBeenNthCalledWith(2, 'minimal');
    expect(settingsMocks.setThinkingLevel).toHaveBeenNthCalledWith(3, 'low');
    expect(settingsMocks.setThinkingLevel).toHaveBeenNthCalledWith(4, 'medium');
    expect(settingsMocks.setThinkingLevel).toHaveBeenNthCalledWith(5, 'high');
    expect(settingsMocks.setThinkingLevel).toHaveBeenNthCalledWith(6, 'xhigh');
  });

  it('should update the locale from the language picker', async () => {
    const { getByLabelText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Language'));
    fireEvent.press(getByLabelText(LOCALE_DISPLAY_NAMES.de));

    await waitFor(() => {
      expect(settingsMocks.setLocale).toHaveBeenCalledWith('de');
      expect(settingsMocks.i18nSetLocale).toHaveBeenCalledWith('de');
    });
  });

  it('should save persona configuration for a built-in persona', () => {
    const { getByDisplayValue, getByText } = renderSettingsScreen();
    fireEvent.changeText(getByDisplayValue('Assistant'), 'Assistant Pro');
    fireEvent.press(getByText('Save Persona Configuration'));
    expect(settingsMocks.setPersonaOverride).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'Assistant Pro' }),
    );
  });

  it('should toggle a tool permission', () => {
    const { getAllByRole } = renderSettingsScreen();
    const switches = getAllByRole('switch');
    fireEvent(switches[2], 'valueChange', false);
    expect(settingsMocks.setPermission).toHaveBeenCalled();
  });

  it('should render theme icons', () => {
    const { getByTestId } = renderSettingsScreen();
    expect(getByTestId('icon-Sun')).toBeTruthy();
    expect(getByTestId('icon-Moon')).toBeTruthy();
    expect(getByTestId('icon-Monitor')).toBeTruthy();
  });

  it('should execute clear all conversations confirmation', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Clear All Conversations'));
    expect(settingsMocks.clearAllConversations).toHaveBeenCalled();
  });
});
