import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import {
  confirmSettingsDestructiveAlert,
  renderSettingsScreen,
  settingsMocks,
  settingsTestState,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

describe('SettingsScreen browser and expo remote config', () => {
  setupSettingsScreenTestSuite();

  it('should save a new browser provider with a stored API key', async () => {
    const { getByLabelText, getByPlaceholderText, getByText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.changeText(getByPlaceholderText('bb_project_123'), 'bb_project_42');
    fireEvent.changeText(getByPlaceholderText('browser provider key'), 'browser-secret');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('browser_provider_api_key_'),
        'browser-secret',
      );
      expect(settingsMocks.addBrowserProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'browserbase',
          baseUrl: 'https://api.browserbase.com',
          projectId: 'bb_project_42',
          authMode: 'api-key-header',
          apiKeyRef: expect.stringContaining('browser_provider_api_key_'),
        }),
      );
    });
  });

  it('should reject an invalid browser provider URL', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByDisplayValue, getByText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.changeText(getByDisplayValue('https://api.browserbase.com'), 'ftp://browser.invalid');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Browser provider URL must use http or https.',
      );
    });
    expect(settingsMocks.addBrowserProvider).not.toHaveBeenCalled();
  });

  it('should require a query token parameter for browserless providers', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByDisplayValue, getByPlaceholderText, getByText } =
      renderSettingsScreen();

    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.press(getByText('Browserless'));
    fireEvent.changeText(getByDisplayValue('token'), '');
    fireEvent.changeText(getByPlaceholderText('browser provider key'), 'browserless-secret');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'A query token parameter is required for query-token browser authentication.',
      );
    });
    expect(settingsMocks.addBrowserProvider).not.toHaveBeenCalled();
  });

  it('should update an existing browser provider and clear a stored secret when auth is disabled', async () => {
    settingsTestState.browserProviders = [
      {
        id: 'browser-1',
        name: 'Browser Ops',
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        authMode: 'api-key-header',
        apiKeyRef: 'browser_provider_api_key_browser-1',
        projectId: 'bb_project_live',
        enabled: true,
      },
    ];
    settingsMocks.getSecure.mockImplementation(async (key: string) =>
      key === 'browser_provider_api_key_browser-1' ? 'saved-browser-key' : '',
    );

    const { getByDisplayValue, getByText } = renderSettingsScreen();

    fireEvent.press(getByText('Browser Ops'));

    await waitFor(() => {
      expect(getByDisplayValue('saved-browser-key')).toBeTruthy();
    });

    fireEvent.press(getByText('None'));
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.deleteSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
      expect(settingsMocks.updateBrowserProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'browser-1',
          authMode: 'none',
          apiKeyRef: undefined,
          queryTokenParam: undefined,
        }),
      );
    });
  });

  it('should execute delete browser provider confirmation', async () => {
    settingsTestState.browserProviders = [
      {
        id: 'browser-1',
        name: 'Browser Ops',
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        authMode: 'api-key-header',
        projectId: 'bb_project_live',
        enabled: true,
      },
    ];
    confirmSettingsDestructiveAlert();

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Browser Ops'));

    await waitFor(() => {
      expect(getByText('Delete Browser Provider')).toBeTruthy();
    });

    fireEvent.press(getByText('Delete Browser Provider'));

    await waitFor(() => {
      expect(settingsMocks.removeBrowserProvider).toHaveBeenCalledWith('browser-1');
      expect(settingsMocks.deleteSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
    });
  });
});
