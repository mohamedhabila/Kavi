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
