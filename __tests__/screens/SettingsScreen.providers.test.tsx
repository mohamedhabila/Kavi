import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { Alert, StyleSheet } from 'react-native';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';
import type { ProviderConnectionTestResult } from '../../src/services/llm/support/providerConnection';

import {
  renderSettingsScreen,
  settingsMocks,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

const buildInstalledLocalProvider = (provider: any) => {
  const catalogEntry = getLocalLlmCatalogEntry(provider.model);
  const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;
  new File(localPath).write('downloaded');
  (jest.requireMock('expo-file-system') as any).__setFileSize?.(
    localPath,
    catalogEntry?.sizeBytes || 1,
  );
  return {
    ...provider,
    local: {
      ...provider.local,
      installedModels: [
        {
          modelId: provider.model,
          fileName: catalogEntry?.fileName || provider.model,
          localPath,
          installedAt: 1,
          sizeBytes: catalogEntry?.sizeBytes || 1,
          sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
        },
      ],
    },
  };
};

describe('SettingsScreen providers', () => {
  setupSettingsScreenTestSuite({ destination: 'advanced-ai' });

  it('should navigate to provider edit when provider is tapped', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Edit Provider')).toBeTruthy();
    });
  });

  it('should navigate to new provider edit when Plus button is tapped', () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    const addProvider = getByLabelText('Add provider');
    expect(StyleSheet.flatten(addProvider.props.style)).toMatchObject({
      minHeight: 48,
      width: 48,
    });
    fireEvent.press(addProvider);
    expect(getByText('Add Provider')).toBeTruthy();
  });

  it('should navigate to provider edit via preset chip', () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Anthropic'));
    expect(getByText('Add Provider')).toBeTruthy();
  });

  it('should show provider edit form fields', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Name')).toBeTruthy();
      expect(getByText('Base URL')).toBeTruthy();
      expect(getByText('API Key')).toBeTruthy();
      expect(getByText('Default Model')).toBeTruthy();
      expect(getByText('Enabled')).toBeTruthy();
      expect(getByText('Save')).toBeTruthy();
    });
  });

  it('should toggle API key visibility', async () => {
    const { getByLabelText, getByText, getByTestId } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('API Key')).toBeTruthy();
    });
    const eyeButton = getByLabelText('Show API key');
    expect(StyleSheet.flatten(eyeButton.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
    fireEvent.press(eyeButton);
    expect(getByTestId('icon-EyeOff')).toBeTruthy();
  });

  it('should show delete provider button for existing providers', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Delete Provider')).toBeTruthy();
    });
  });

  it('should save provider and return to main', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(getByText('Advanced AI')).toBeTruthy();
    });
  });

  it('should go back from provider edit to main', async () => {
    const { getByText, getAllByTestId } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Edit Provider')).toBeTruthy();
    });
    const arrowIcons = getAllByTestId('icon-ArrowLeft');
    fireEvent.press(arrowIcons[0].parent || arrowIcons[0]);
    expect(getByText('Advanced AI')).toBeTruthy();
  });

  it('should show delete confirmation for provider', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Delete Provider')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete Provider'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Provider',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('should edit provider name field', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('OpenAI')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('OpenAI'), 'My Provider');
    expect(getByDisplayValue('My Provider')).toBeTruthy();
  });

  it('should edit provider base URL field', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'https://custom.api.com');
    expect(getByDisplayValue('https://custom.api.com')).toBeTruthy();
  });

  it('should edit provider model field', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('gpt-5.4')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('gpt-5.4'), 'gpt-5-mini');
    expect(getByDisplayValue('gpt-5-mini')).toBeTruthy();
  });

  it('should edit provider API key field', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('sk-test')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('sk-test'), 'sk-new-key');
    expect(getByDisplayValue('sk-new-key')).toBeTruthy();
  });

  it('opens immediately while loading a saved key and preserves newer typing', async () => {
    const { getProviderApiKey } = require('../../src/services/storage/SecureStorage');
    let resolveEditorKey: ((value: string) => void) | undefined;
    getProviderApiKey.mockResolvedValueOnce('sk-test').mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveEditorKey = resolve;
        }),
    );
    const { getByDisplayValue, getByPlaceholderText, getByText } = renderSettingsScreen();

    await waitFor(() => expect(getProviderApiKey).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('gpt-5.4'));

    expect(getByText('Checking setup')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('sk-…'), 'newer-user-key');
    await act(async () => resolveEditorKey?.('stale-saved-key'));

    expect(getByDisplayValue('newer-user-key')).toBeTruthy();
  });

  it('should toggle provider enabled switch', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Enabled')).toBeTruthy();
    });
  });

  it('should explain why an incomplete new provider cannot be saved', () => {
    const { getByLabelText, getByTestId, getByText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add provider'));
    expect(getByText('Add Provider')).toBeTruthy();
    expect(getByText('Enter a provider name.')).toBeTruthy();
    expect(getByText('Enter the provider endpoint URL.')).toBeTruthy();
    expect(getByText('Enter an API key before enabling this provider.')).toBeTruthy();
    expect(getByText('Enter a default model.')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState).toEqual({ disabled: true });
    expect(getByTestId('provider-readiness-action').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(settingsMocks.addProvider).not.toHaveBeenCalled();
  });

  it('tests a complete provider without saving or generating a chat response', async () => {
    let resolveTest: ((result: { outcome: 'success' }) => void) | undefined;
    settingsMocks.testProviderConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTest = resolve;
        }),
    );
    const { getByDisplayValue, getByText } = renderSettingsScreen();

    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => expect(getByText('Test connection')).toBeTruthy());
    fireEvent.press(getByText('Test connection'));

    expect(getByText('Testing connection')).toBeTruthy();
    expect(settingsMocks.updateProvider).not.toHaveBeenCalled();
    expect(settingsMocks.testProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
      }),
    );

    await act(async () => resolveTest?.({ outcome: 'success' }));
    await waitFor(() => expect(getByText('Connection verified')).toBeTruthy());

    fireEvent.changeText(getByDisplayValue('gpt-5.4'), 'gpt-5-mini');
    expect(getByText('Active')).toBeTruthy();
    expect(getByText('Test connection')).toBeTruthy();
  });

  it('shows safe provider-specific recovery and supports retry', async () => {
    settingsMocks.testProviderConnection
      .mockResolvedValueOnce({ outcome: 'failure', reason: 'authentication', httpStatus: 401 })
      .mockResolvedValueOnce({ outcome: 'success' });
    const { getByText, queryByText } = renderSettingsScreen();

    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => expect(getByText('Test connection')).toBeTruthy());
    fireEvent.press(getByText('Test connection'));

    await waitFor(() => {
      expect(getByText('Connection not verified')).toBeTruthy();
      expect(
        getByText('The provider rejected the credential. Check the API key and its permissions.'),
      ).toBeTruthy();
    });
    expect(queryByText(/401|private provider detail/i)).toBeNull();

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByText('Connection verified')).toBeTruthy());
  });

  it('ignores an older connection result after the provider changes', async () => {
    let resolveFirst: ((result: ProviderConnectionTestResult) => void) | undefined;
    let resolveSecond: ((result: ProviderConnectionTestResult) => void) | undefined;
    settingsMocks.testProviderConnection
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { getByDisplayValue, getByText } = renderSettingsScreen();

    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => expect(getByText('Test connection')).toBeTruthy());
    fireEvent.press(getByText('Test connection'));
    fireEvent.changeText(getByDisplayValue('gpt-5.4'), 'gpt-5-mini');
    fireEvent.press(getByText('Test connection'));

    await act(async () => resolveSecond?.({ outcome: 'success' }));
    await waitFor(() => expect(getByText('Connection verified')).toBeTruthy());
    await act(async () =>
      resolveFirst?.({ outcome: 'failure', reason: 'authentication', httpStatus: 401 }),
    );

    expect(getByText('Connection verified')).toBeTruthy();
  });

  it('should save a complete new provider with addProvider', async () => {
    const { getByText, getByLabelText, getByPlaceholderText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add provider'));
    fireEvent.changeText(getByPlaceholderText('Provider name'), 'My provider');
    fireEvent.changeText(
      getByPlaceholderText('https://api.openai.com/v1'),
      'https://example.com/v1',
    );
    fireEvent.changeText(getByPlaceholderText('sk-…'), 'sk-new-provider');
    fireEvent.changeText(getByPlaceholderText('gpt-5.5'), 'example-model');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(settingsMocks.addProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My provider',
          baseUrl: 'https://example.com/v1',
          model: 'example-model',
        }),
      );
    });
  });

  it('should prefill and save the Gemini preset with the Vertex base URL', async () => {
    const { getByLabelText, getByDisplayValue, getByPlaceholderText, getByText } =
      renderSettingsScreen();

    fireEvent.press(getByLabelText('Add Gemini provider'));

    await waitFor(() => {
      expect(getByDisplayValue('Gemini')).toBeTruthy();
      expect(getByDisplayValue('https://aiplatform.googleapis.com/v1')).toBeTruthy();
      expect(getByDisplayValue('gemini-3.1-pro-preview')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('sk-…'), 'gemini-key');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.addProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          model: 'gemini-3.1-pro-preview',
        }),
      );
    });
  });

  it('should require an explicit download before saving the on-device Gemma preset', async () => {
    const { saveProviderApiKey } = require('../../src/services/storage/SecureStorage');
    settingsMocks.installLocalLlmModel.mockImplementation(async (provider: any) =>
      buildInstalledLocalProvider(provider),
    );
    const { getByLabelText, getByText, queryByPlaceholderText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Add On-device models provider'));

    await waitFor(() => {
      expect(getByText('On-device models')).toBeTruthy();
    });

    expect(queryByPlaceholderText('https://api.openai.com/v1')).toBeNull();
    expect(queryByPlaceholderText('sk-…')).toBeNull();
    expect(getByText('Download the selected model')).toBeTruthy();

    fireEvent.press(getByText('Save'));

    expect(settingsMocks.installLocalLlmModel).not.toHaveBeenCalled();
    expect(settingsMocks.addProvider).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText(/^Download model /));

    await waitFor(() => {
      expect(getByText('Download complete. You can save this provider now.')).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByText('Installed')).toBeTruthy();
    });

    fireEvent.press(getByText('Save').parent as any);

    await waitFor(() => {
      expect(settingsMocks.installLocalLlmModel).toHaveBeenCalledTimes(1);
      expect(settingsMocks.addProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'on-device',
          name: 'On-device models',
        }),
      );
    });

    expect(saveProviderApiKey).not.toHaveBeenCalled();
  });

  it('should show download progress while fetching an on-device model', async () => {
    let resolveDownload: ((value: any) => void) | null = null;
    let pendingProvider: any = null;
    settingsMocks.installLocalLlmModel.mockImplementationOnce(
      (provider: any, _modelId?: string, options?: any) =>
        new Promise((resolve) => {
          pendingProvider = provider;
          resolveDownload = resolve;
          options?.onProgress?.({
            modelId: provider.model,
            bytesWritten: 50,
            totalBytes: 100,
            fraction: 0.5,
          });
        }),
    );

    const { getByLabelText, getByText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Add On-device models provider'));

    await waitFor(() => {
      expect(getByText('Download the selected model')).toBeTruthy();
    });

    fireEvent.press(getByLabelText(/^Download model /));

    await waitFor(() => {
      expect(getByText('Downloading…')).toBeTruthy();
      expect(getByText('50% complete')).toBeTruthy();
    });

    resolveDownload?.(buildInstalledLocalProvider(pendingProvider));

    await waitFor(() => {
      expect(getByText('Download complete. You can save this provider now.')).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByText('Installed')).toBeTruthy();
    });
  });

  it('should save existing provider with updateProvider', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(settingsMocks.updateProvider).toHaveBeenCalled();
    });
  });

  it('should execute delete provider confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Delete Provider')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete Provider'));
    await waitFor(() => {
      expect(settingsMocks.removeProvider).toHaveBeenCalledWith('openai');
    });
  });

  it('keeps a provider when its saved API key cannot be removed', async () => {
    const { deleteProviderApiKey } = require('../../src/services/storage/SecureStorage');
    deleteProviderApiKey.mockRejectedValueOnce(new Error('private secure-store detail'));
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: any) => {
      const deleteBtn = buttons?.find((button: any) => button.style === 'destructive');
      deleteBtn?.onPress?.();
    });

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => expect(getByText('Delete Provider')).toBeTruthy());
    fireEvent.press(getByText('Delete Provider'));

    await waitFor(() => {
      expect(deleteProviderApiKey).toHaveBeenCalledWith('openai');
      expect(settingsMocks.removeProvider).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Error',
        'Could not remove the saved credential. The configuration was kept so you can retry.',
      );
    });
  });

  it('should save provider with API key', async () => {
    const { saveProviderApiKey } = require('../../src/services/storage/SecureStorage');
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('sk-test')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('sk-test'), 'sk-new-key');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(saveProviderApiKey).toHaveBeenCalledWith('openai', 'sk-new-key');
    });
  });

  it('should remove a cleared API key when saving the provider off', async () => {
    const { deleteProviderApiKey } = require('../../src/services/storage/SecureStorage');
    const { getByDisplayValue, getByLabelText, getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('sk-test')).toBeTruthy();
    });

    fireEvent(getByLabelText('Enabled'), 'valueChange', false);
    fireEvent.changeText(getByDisplayValue('sk-test'), '');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(deleteProviderApiKey).toHaveBeenCalledWith('openai');
      expect(settingsMocks.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: '', enabled: false }),
      );
    });
  });

  it('should show an inline error for an invalid provider URL', async () => {
    const { getByLabelText, getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'not-a-valid-url');
    expect(getByText('Enter a valid provider endpoint URL.')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState).toEqual({ disabled: true });
    expect(settingsMocks.updateProvider).not.toHaveBeenCalled();
  });

  it('should show an inline protocol error for an ftp provider URL', async () => {
    const { getByLabelText, getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'ftp://evil.com');
    expect(getByText('The endpoint must use http or https.')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState).toEqual({ disabled: true });
    expect(settingsMocks.updateProvider).not.toHaveBeenCalled();
  });
});
