import { fireEvent, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { Alert } from 'react-native';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';

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
  setupSettingsScreenTestSuite();

  it('should navigate to provider edit when provider is tapped', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Edit Provider')).toBeTruthy();
    });
  });

  it('should navigate to new provider edit when Plus button is tapped', () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add provider'));
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
    const { getByText, getByTestId } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('API Key')).toBeTruthy();
    });
    const eyeIcon = getByTestId('icon-Eye');
    fireEvent.press(eyeIcon.parent || eyeIcon);
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
      expect(getByText('Settings')).toBeTruthy();
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
    expect(getByText('Settings')).toBeTruthy();
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

  it('should toggle provider enabled switch', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Enabled')).toBeTruthy();
    });
  });

  it('should save new provider with addProvider', async () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add provider'));
    expect(getByText('Add Provider')).toBeTruthy();
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(settingsMocks.addProvider).toHaveBeenCalled();
    });
  });

  it('should prefill and save the Gemini preset with the Vertex base URL', async () => {
    const { getByLabelText, getByDisplayValue, getByText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Add Gemini provider'));

    await waitFor(() => {
      expect(getByDisplayValue('Gemini')).toBeTruthy();
      expect(getByDisplayValue('https://aiplatform.googleapis.com/v1')).toBeTruthy();
      expect(getByDisplayValue('gemini-3.1-pro-preview')).toBeTruthy();
    });

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

  it('should reject invalid provider URL on save', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'not-a-valid-url');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Invalid URL', expect.any(String));
    });
    expect(settingsMocks.updateProvider).not.toHaveBeenCalled();
  });

  it('should reject ftp:// provider URL on save', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'ftp://evil.com');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invalid URL',
        'Provider URL must use http or https.',
      );
    });
    expect(settingsMocks.updateProvider).not.toHaveBeenCalled();
  });
});
