// ---------------------------------------------------------------------------
// Tests — OnboardingWizard
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { OnboardingWizard } from '../../src/components/onboarding/OnboardingWizard';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000', surface: '#111', surfaceAlt: '#222', header: '#111',
      border: '#333', subtleBorder: '#444', text: '#fff', textSecondary: '#aaa',
      textTertiary: '#777', placeholder: '#555', primary: '#0f0', onPrimary: '#fff',
      primarySoft: '#030', danger: '#f00', dangerSoft: '#300', success: '#0f0',
      warning: '#ff0', inputBackground: '#222', inputBorder: '#444',
    },
  }),
  AppPalette: {},
}));

// Mock secure storage
const mockSaveProviderApiKey = jest.fn().mockResolvedValue(undefined);
const mockSaveSecure = jest.fn().mockResolvedValue(undefined);
const mockInstallLocalLlmModel = jest.fn();
const mockGetLocalLlmAvailability = jest.fn();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  saveProviderApiKey: (...args: any[]) => mockSaveProviderApiKey(...args),
  saveSecure: (...args: any[]) => mockSaveSecure(...args),
}));

jest.mock('../../src/services/localLlm/runtime', () => {
  const actual = jest.requireActual('../../src/services/localLlm/runtime');
  return {
    ...actual,
    getLocalLlmAvailability: (...args: any[]) => mockGetLocalLlmAvailability(...args),
    installLocalLlmModel: (...args: any[]) => mockInstallLocalLlmModel(...args),
  };
});

// Mock settings store
const mockAddProvider = jest.fn();
const mockSetWebSearchProvider = jest.fn();
jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: any) =>
    selector({
      addProvider: mockAddProvider,
      webSearchProvider: 'auto',
      setWebSearchProvider: mockSetWebSearchProvider,
    }),
}));

// Mock provider presets while keeping the real helper implementations.
jest.mock('../../src/constants/api', () => {
  const actual = jest.requireActual('../../src/constants/api');
  return {
    ...actual,
    KNOWN_PROVIDERS: actual.KNOWN_PROVIDERS.filter((provider: { name: string }) =>
      ['OpenAI', 'Anthropic', 'Gemini', 'Gemma (on-device)'].includes(provider.name),
    ),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLocalLlmAvailability.mockReset();
  mockGetLocalLlmAvailability.mockResolvedValue({
    available: true,
    linked: true,
    platform: 'android',
    runtime: 'litert-lm',
    supportsStreaming: true,
    deviceMemoryGb: 8,
    lowMemoryDevice: false,
    reason: null,
    warningReason: null,
  });
  mockInstallLocalLlmModel.mockReset();
  mockInstallLocalLlmModel.mockImplementation(async (provider: any, _modelId?: string, options?: any) => {
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;
    new File(localPath).write('downloaded');
    (jest.requireMock('expo-file-system') as any).__setFileSize?.(localPath, catalogEntry?.sizeBytes || 1);
    options?.onProgress?.({
      modelId: provider.model,
      bytesWritten: catalogEntry?.sizeBytes || 1,
      totalBytes: catalogEntry?.sizeBytes || 1,
      fraction: 1,
    });
    return {
      ...provider,
      local: {
        ...provider.local,
        installedModels: [{
          modelId: provider.model,
          fileName: catalogEntry?.fileName || provider.model,
          localPath,
          installedAt: 1,
          sizeBytes: catalogEntry?.sizeBytes || 1,
          sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
        }],
      },
    };
  });
});

describe('OnboardingWizard', () => {
  it('renders welcome step initially', () => {
    const onComplete = jest.fn();
    const { getByText } = render(<OnboardingWizard onComplete={onComplete} />);

    expect(getByText('Welcome to Kavi')).toBeTruthy();
    expect(getByText('Setup in three passes')).toBeTruthy();
    expect(getByText('Get Started')).toBeTruthy();
    expect(getByText('Skip for now')).toBeTruthy();
  });

  it('shows features list on welcome step', () => {
    const { getByText } = render(<OnboardingWizard onComplete={jest.fn()} />);
    expect(getByText(/Web search/)).toBeTruthy();
    expect(getByText(/Persistent memory/)).toBeTruthy();
    expect(getByText(/MCP server/)).toBeTruthy();
  });

  it('calls onComplete when skip pressed', () => {
    const onComplete = jest.fn();
    const { getByText } = render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.press(getByText('Skip for now'));
    expect(onComplete).toHaveBeenCalled();
  });

  it('navigates to provider step on Get Started', () => {
    const { getByText } = render(<OnboardingWizard onComplete={jest.fn()} />);
    fireEvent.press(getByText('Get Started'));
    expect(getByText('Choose your main model provider')).toBeTruthy();
    expect(getByText('OpenAI')).toBeTruthy();
    expect(getByText('Anthropic')).toBeTruthy();
    expect(getByText('Gemini')).toBeTruthy();
  });

  it('shows provider setup guidance on provider selection', () => {
    const { getByText } = render(<OnboardingWizard onComplete={jest.fn()} />);
    fireEvent.press(getByText('Get Started'));
    fireEvent.press(getByText('OpenAI'));
    expect(getByText('How to get access')).toBeTruthy();
    expect(getByText(/OpenAI dashboard/)).toBeTruthy();
    expect(getByText('Save provider')).toBeTruthy();
  });

  it('requires an explicit download before saving the on-device Gemma provider', async () => {
    const { getByLabelText, getByText, queryByPlaceholderText } = render(
      <OnboardingWizard onComplete={jest.fn()} />,
    );

    fireEvent.press(getByText('Get Started'));
    fireEvent.press(getByText('Gemma on-device'));

    expect(getByText('On-device note')).toBeTruthy();
    expect(queryByPlaceholderText('sk-...')).toBeNull();
    expect(getByText('Download the selected model')).toBeTruthy();

    fireEvent.press(getByText('Save provider'));

    expect(mockInstallLocalLlmModel).not.toHaveBeenCalled();
    expect(mockAddProvider).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText(/^Download model /));

    await waitFor(() => {
      expect(getByText('Download complete. You can save this provider now.')).toBeTruthy();
    });

    fireEvent.press(getByText('Save provider').parent as any);

    await waitFor(() => {
      expect(mockInstallLocalLlmModel).toHaveBeenCalledTimes(1);
      expect(mockAddProvider).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'on-device',
        name: 'Gemma (on-device)',
      }));
    });

    expect(mockSaveProviderApiKey).not.toHaveBeenCalled();
  });

  it('completes provider and tool setup, then finishes', async () => {
    const onComplete = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <OnboardingWizard onComplete={onComplete} />,
    );

    fireEvent.press(getByText('Get Started'));
    fireEvent.press(getByText('OpenAI'));
    fireEvent.changeText(getByPlaceholderText('sk-...'), 'sk-test123');
    fireEvent.press(getByText('Save provider'));

    await waitFor(() => {
      expect(getByText('Unlock tools you actually plan to use')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('github_pat_...'), 'github_pat_test123');
    fireEvent.press(getByText('Finish setup'));

    await waitFor(() => {
      expect(getByText("Explore What's Possible")).toBeTruthy();
    });

    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText("You're all set!")).toBeTruthy();
    });

    expect(mockSetWebSearchProvider).toHaveBeenCalledWith('auto');
    expect(mockSaveSecure).toHaveBeenCalledWith('GITHUB_TOKEN', 'github_pat_test123');

    fireEvent.press(getByText('Start Chatting'));
    expect(onComplete).toHaveBeenCalled();
  });

  it('shows error when secure storage fails', async () => {
    mockSaveProviderApiKey.mockRejectedValueOnce(new Error('Keychain unavailable'));

    const { getByText, getByPlaceholderText } = render(
      <OnboardingWizard onComplete={jest.fn()} />,
    );

    fireEvent.press(getByText('Get Started'));
    fireEvent.press(getByText('OpenAI'));
    fireEvent.changeText(getByPlaceholderText('sk-...'), 'sk-test123');
    fireEvent.press(getByText('Save provider'));

    await waitFor(() => {
      expect(getByText(/Failed to save securely/)).toBeTruthy();
    });
  });

  it('saves Gemini with the default Vertex base URL', async () => {
    const { getByText, getByPlaceholderText } = render(
      <OnboardingWizard onComplete={jest.fn()} />,
    );

    fireEvent.press(getByText('Get Started'));
    fireEvent.press(getByText('Gemini'));
    fireEvent.changeText(getByPlaceholderText('sk-...'), 'AIza-test123');
    fireEvent.press(getByText('Save provider'));

    await waitFor(() => {
      expect(mockAddProvider).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        model: 'gemini-3.1-pro-preview',
      }));
    });
  });
});
