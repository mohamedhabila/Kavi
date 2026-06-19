import { fireEvent, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { rememberObservedLocalLlmBackend } from '../../src/services/localLlm/backendStatus';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';
import { createDefaultLocalLlmProvider } from '../../src/services/localLlm/provider';
import {
  renderSettingsScreen,
  settingsMocks,
  settingsTestState,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

const originalPlatformOs = Platform.OS;

function buildInstalledProvider(options?: { revision?: string }) {
  (Platform as { OS: 'android' | 'ios' }).OS = 'android';

  const provider = createDefaultLocalLlmProvider('local-provider');
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
      backend: 'gpu',
      installedModels: [
        {
          modelId: provider.model,
          fileName: catalogEntry?.fileName || provider.model,
          localPath,
          installedAt: 1,
          sizeBytes: catalogEntry?.sizeBytes || 1,
          sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
          repositoryId: catalogEntry?.repositoryId,
          downloadRevision: options?.revision || catalogEntry?.downloadRevision || 'main',
        },
      ],
    },
  };
}

describe('SettingsScreen local model recovery', () => {
  setupSettingsScreenTestSuite();

  beforeEach(() => {
    (Platform as { OS: 'android' | 'ios' }).OS = 'android';
    (jest.requireMock('expo-file-system') as any).__resetStore?.();
  });

  afterAll(() => {
    (Platform as { OS: 'android' | 'ios' }).OS = originalPlatformOs as 'android' | 'ios';
  });

  it('surfaces invalid installed model recovery and clears artifacts explicitly', async () => {
    const provider = buildInstalledProvider({ revision: 'obsolete-revision' });
    const installedPath = provider.local?.installedModels?.[0]?.localPath || '';
    settingsTestState.providers = [provider];

    const { getByLabelText, getByText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Edit On-device models provider'));

    await waitFor(() => {
      expect(getByText('Model needs attention')).toBeTruthy();
      expect(getByText('Clear local file')).toBeTruthy();
    });

    fireEvent.press(getByText('Clear local file'));

    await waitFor(() => {
      expect(getByText('Download the selected model')).toBeTruthy();
    });
    expect(new File(installedPath).exists).toBe(false);
  });

  it('shows observed backend fallback and saves an explicit CPU switch', async () => {
    const provider = buildInstalledProvider();
    const installedPath = provider.local?.installedModels?.[0]?.localPath || '';
    rememberObservedLocalLlmBackend(installedPath, 'cpu');
    settingsTestState.providers = [provider];

    const { getByLabelText, getByTestId, getByText, queryByText } = renderSettingsScreen();

    fireEvent.press(getByLabelText('Edit On-device models provider'));

    await waitFor(() => {
      expect(
        getByText('Runtime: Running on CPU. GPU was requested and the runtime fell back.'),
      ).toBeTruthy();
      expect(getByText('Use CPU')).toBeTruthy();
    });

    fireEvent.press(getByTestId('local-model-switch-cpu'));

    await waitFor(() => {
      expect(queryByText('Use CPU')).toBeNull();
    });

    fireEvent.press(getByLabelText('Save'));

    await waitFor(() => {
      expect(settingsMocks.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          local: expect.objectContaining({ backend: 'cpu' }),
        }),
      );
    });
  });
});
