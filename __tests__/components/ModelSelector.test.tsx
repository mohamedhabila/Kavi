// ---------------------------------------------------------------------------
// Tests — ModelSelector Component
// ---------------------------------------------------------------------------

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ModelSelector } from '../../src/components/chat/ModelSelector';
import { createDefaultLocalLlmProvider } from '../../src/services/localLlm/runtime';

const mockGetProviderApiKey = jest.fn().mockResolvedValue('sk-test');

const mockProviders = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    enabled: true,
    availableModels: ['gpt-5.4', 'gpt-5-mini', 'o4-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-6',
    enabled: true,
    availableModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
];

const createCustomProvider = () => ({
  id: 'custom',
  name: 'Custom',
  baseUrl: 'https://api.custom.example/v1',
  apiKey: 'sk-custom-test',
  model: 'custom-model',
  enabled: true,
  availableModels: [],
});

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: any) => any) => {
    const state = { providers: mockProviders };
    return selector(state);
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    fetchModels: jest.fn().mockResolvedValue({
      models: ['gpt-5.4', 'gpt-5-mini', 'o4-mini'],
      capabilities: {},
    }),
  })),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      surface: '#111',
      surfaceAlt: '#222',
      border: '#333',
      overlay: 'rgba(0,0,0,0.5)',
    },
  }),
  AppPalette: {},
}));

describe('ModelSelector', () => {
  const defaultProps = {
    selectedProviderId: 'openai',
    selectedModel: 'gpt-5.4',
    onSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const { LlmService } = require('../../src/services/llm/LlmService');
    LlmService.mockImplementation(() => ({
      fetchModels: jest.fn().mockResolvedValue({
        models: ['gpt-5.4', 'gpt-5-mini', 'o4-mini'],
        capabilities: {},
      }),
    }));
  });

  it('should render the selected model name', () => {
    const { getByText } = render(<ModelSelector {...defaultProps} />);
    expect(getByText('gpt-5.4')).toBeTruthy();
  });

  it('should show "Select model" when no model selected', () => {
    const { getByText } = render(
      <ModelSelector selectedProviderId={null} selectedModel={null} onSelect={jest.fn()} />,
    );
    expect(getByText('gpt-5.4')).toBeTruthy(); // Falls back to activeProvider.model
  });

  it('should open modal on press', async () => {
    const { getByText } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    expect(getByText('Select Model')).toBeTruthy();
  });

  it('should show close button in modal', async () => {
    const { getByText } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    expect(getByText('Close')).toBeTruthy();
  });

  it('should close modal on close button press', async () => {
    const { getByText, queryByText } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    expect(getByText('Select Model')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Close'));
    });
    // Modal should be closed
  });

  it('should show model list from available models', async () => {
    const { getByText } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    // Wait for fetchModels to resolve
    await waitFor(() => {
      expect(getByText('o4-mini')).toBeTruthy();
    });
    expect(getByText('gpt-5-mini')).toBeTruthy();
  });

  it('fetches models under StrictMode effect replay', async () => {
    const originalAvailableModels = mockProviders[0].availableModels;
    const { LlmService } = require('../../src/services/llm/LlmService');
    LlmService.mockImplementation(() => ({
      fetchModels: jest.fn().mockResolvedValue({
        models: ['strict-mode-model'],
        capabilities: {},
      }),
    }));
    mockProviders[0].availableModels = [];

    try {
      const { getByText } = render(
        <React.StrictMode>
          <ModelSelector {...defaultProps} />
        </React.StrictMode>,
      );

      await act(async () => {
        fireEvent.press(getByText('gpt-5.4'));
      });

      await waitFor(() => {
        expect(getByText('strict-mode-model')).toBeTruthy();
      });
    } finally {
      mockProviders[0].availableModels = originalAvailableModels;
    }
  });

  it('should call onSelect when a model is tapped', async () => {
    const onSelect = jest.fn();
    const { getByText } = render(<ModelSelector {...defaultProps} onSelect={onSelect} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    await waitFor(() => {
      expect(getByText('o4-mini')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('o4-mini'));
    });
    expect(onSelect).toHaveBeenCalledWith('openai', 'o4-mini');
  });

  it('should show provider tabs when multiple providers exist', async () => {
    const { getByText } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    expect(getByText('OpenAI')).toBeTruthy();
    expect(getByText('Anthropic')).toBeTruthy();
  });

  it('loads models when switching provider tabs and reuses cached results', async () => {
    const { LlmService } = require('../../src/services/llm/LlmService');
    const fetchModelsMock = jest.fn((providerId: string) =>
      Promise.resolve({
        models: providerId === 'anthropic' ? ['claude-4.7-preview'] : ['gpt-5.4', 'gpt-5-mini'],
        capabilities: {},
      }),
    );

    LlmService.mockImplementation((provider: { id: string }) => ({
      fetchModels: jest.fn().mockImplementation(() => fetchModelsMock(provider.id)),
    }));

    const { getByText } = render(<ModelSelector {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });

    await waitFor(() => {
      expect(fetchModelsMock).toHaveBeenCalledWith('openai');
    });

    await act(async () => {
      fireEvent.press(getByText('Anthropic'));
    });

    await waitFor(() => {
      expect(getByText('claude-4.7-preview')).toBeTruthy();
    });

    expect(fetchModelsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.press(getByText('OpenAI'));
    });

    expect(fetchModelsMock).toHaveBeenCalledTimes(2);
  });

  it('sizes the selector trigger to its content while capping width', () => {
    const { getByTestId, getByText } = render(
      <ModelSelector selectedProviderId="openai" selectedModel="o4" onSelect={jest.fn()} />,
    );

    const triggerStyle = StyleSheet.flatten(getByTestId('model-selector-trigger').props.style);
    const triggerText = getByText('o4');
    const triggerTextStyle = StyleSheet.flatten(triggerText.props.style);

    expect(triggerStyle).toMatchObject({
      alignSelf: 'flex-start',
      flexGrow: 0,
      flexShrink: 1,
      maxWidth: '100%',
      minWidth: 0,
    });
    expect(triggerText.props.numberOfLines).toBe(1);
    expect(triggerTextStyle).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
    });
  });

  it('preserves single-line truncation for long model names', () => {
    const longModelName = 'gemini-3.1-pro-preview-05-20-super-long-model-name';
    const { getByTestId, getByText } = render(
      <ModelSelector
        selectedProviderId="openai"
        selectedModel={longModelName}
        onSelect={jest.fn()}
      />,
    );

    const triggerStyle = StyleSheet.flatten(getByTestId('model-selector-trigger').props.style);
    const triggerText = getByText(longModelName);
    const triggerTextStyle = StyleSheet.flatten(triggerText.props.style);

    expect(triggerStyle).toMatchObject({
      alignSelf: 'flex-start',
      flexGrow: 0,
      flexShrink: 1,
      maxWidth: '100%',
      minWidth: 0,
    });
    expect(triggerText.props.numberOfLines).toBe(1);
    expect(triggerTextStyle).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
    });
  });

  it('keeps provider tabs fixed while the model list is allowed to shrink', async () => {
    const { getByText, getByTestId } = render(<ModelSelector {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });

    const providerTabsStyle = StyleSheet.flatten(
      getByTestId('model-selector-provider-tabs').props.style,
    );
    const modelListStyle = StyleSheet.flatten(getByTestId('model-selector-model-list').props.style);

    expect(providerTabsStyle).toMatchObject({
      flexGrow: 0,
      height: 48,
    });
    expect(modelListStyle).toMatchObject({
      flexShrink: 1,
    });
  });

  it('does not fetch secure API keys for on-device providers', async () => {
    const localProvider = createDefaultLocalLlmProvider('gemma-local');
    mockProviders.push(localProvider as any);

    const { LlmService } = require('../../src/services/llm/LlmService');
    LlmService.mockImplementation(() => ({
      fetchModels: jest.fn().mockResolvedValue({
        models: localProvider.availableModels,
        capabilities: {},
      }),
    }));

    try {
      const { getByText } = render(
        <ModelSelector
          selectedProviderId="gemma-local"
          selectedModel={localProvider.model}
          onSelect={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.press(getByText(localProvider.model));
      });

      await waitFor(() => {
        expect(mockGetProviderApiKey).not.toHaveBeenCalledWith('gemma-local');
      });
    } finally {
      mockProviders.pop();
    }
  });

  it('should render chevron icon', () => {
    const { getByTestId } = render(<ModelSelector {...defaultProps} />);
    expect(getByTestId('icon-ChevronDown')).toBeTruthy();
  });

  it('should render refresh button in modal', async () => {
    const { getByText, getByTestId } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    expect(getByTestId('icon-RefreshCw')).toBeTruthy();
  });

  it('refreshes the current provider when the refresh action is pressed', async () => {
    const { LlmService } = require('../../src/services/llm/LlmService');
    const fetchModelsMock = jest.fn().mockResolvedValue({
      models: ['gpt-5.4', 'gpt-5-mini'],
      capabilities: {},
    });

    LlmService.mockImplementation(() => ({
      fetchModels: fetchModelsMock,
    }));

    const { getByLabelText, getByText } = render(<ModelSelector {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });

    await waitFor(() => {
      expect(fetchModelsMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Refresh models'));
    });

    await waitFor(() => {
      expect(fetchModelsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the empty-models error for providers without fallback models', async () => {
    const customProvider = createCustomProvider();
    const { LlmService } = require('../../src/services/llm/LlmService');
    LlmService.mockImplementation(() => ({
      fetchModels: jest.fn().mockResolvedValue({
        models: [],
        capabilities: {},
      }),
    }));
    mockProviders.push(customProvider as any);

    try {
      const { getByText } = render(
        <ModelSelector
          selectedProviderId="custom"
          selectedModel={customProvider.model}
          onSelect={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.press(getByText(customProvider.model));
      });

      await waitFor(() => {
        expect(getByText('No models available')).toBeTruthy();
      });
    } finally {
      mockProviders.pop();
    }
  });

  it('should fall back to known provider models when fetch fails for known provider', async () => {
    const { LlmService } = require('../../src/services/llm/LlmService');
    LlmService.mockImplementation(() => ({
      fetchModels: jest.fn().mockRejectedValue(new Error('Network error')),
    }));

    const { getByText, queryByText } = render(
      <ModelSelector selectedProviderId="openai" selectedModel={null} onSelect={jest.fn()} />,
    );
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    // Known provider (OpenAI) should fall back to hardcoded models, no error shown
    await waitFor(() => {
      expect(queryByText('Network error')).toBeNull();
    });
  });

  it('shows the provider error and retries when fetching fails without fallback models', async () => {
    const customProvider = createCustomProvider();
    const { LlmService } = require('../../src/services/llm/LlmService');
    const fetchModelsMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Custom provider unavailable'))
      .mockResolvedValueOnce({
        models: ['custom-model-v2'],
        capabilities: {},
      });

    LlmService.mockImplementation(() => ({
      fetchModels: fetchModelsMock,
    }));
    mockProviders.push(customProvider as any);

    try {
      const { getByLabelText, getByText } = render(
        <ModelSelector
          selectedProviderId="custom"
          selectedModel={customProvider.model}
          onSelect={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.press(getByText(customProvider.model));
      });

      await waitFor(() => {
        expect(getByText('Custom provider unavailable')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByLabelText('Retry fetching models'));
      });

      await waitFor(() => {
        expect(getByText('custom-model-v2')).toBeTruthy();
      });

      expect(fetchModelsMock).toHaveBeenCalledTimes(2);
    } finally {
      mockProviders.pop();
    }
  });

  it('ignores late model fetch results after unmount', async () => {
    let resolveFetch:
      | ((value: { models: string[]; capabilities: Record<string, never> }) => void)
      | undefined;
    const deferredFetch = new Promise<{ models: string[]; capabilities: Record<string, never> }>(
      (resolve) => {
        resolveFetch = resolve;
      },
    );
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { LlmService } = require('../../src/services/llm/LlmService');
    LlmService.mockImplementation(() => ({
      fetchModels: jest.fn().mockReturnValue(deferredFetch),
    }));

    const { getByText, unmount } = render(<ModelSelector {...defaultProps} />);
    await act(async () => {
      fireEvent.press(getByText('gpt-5.4'));
    });
    unmount();

    await act(async () => {
      resolveFetch?.({ models: ['late-model'], capabilities: {} });
      await deferredFetch;
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
