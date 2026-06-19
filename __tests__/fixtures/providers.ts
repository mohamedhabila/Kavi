import type { LlmProviderConfig } from '../../src/types/provider';

export const makeTestProviderConfig = (
  overrides: Partial<LlmProviderConfig> = {},
): LlmProviderConfig => ({
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  apiKey: 'sk-test-key',
  model: 'test-model',
  enabled: true,
  ...overrides,
});

export const makeOrchestratorProviderConfig = (
  overrides: Partial<LlmProviderConfig> = {},
): LlmProviderConfig => ({
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-5.4',
  enabled: true,
  ...overrides,
});

export const makeOnDeviceProviderConfig = (
  overrides: Partial<LlmProviderConfig> = {},
): LlmProviderConfig => ({
  id: 'local-test',
  kind: 'on-device',
  name: 'On-device models',
  baseUrl: '',
  apiKey: '',
  model: 'gemma-4-E2B-it',
  availableModels: ['gemma-4-E2B-it'],
  modelCapabilities: {
    'gemma-4-E2B-it': {
      vision: false,
      tools: false,
      fileInput: false,
    },
  },
  enabled: true,
  local: {
    runtime: 'litert-lm',
    backend: 'cpu',
    installedModels: [],
  },
  ...overrides,
});

export const makeBuiltinExecutorProvider = (overrides: Record<string, any> = {}) => ({
  id: 'test',
  name: 'Test',
  type: 'openai',
  apiKey: 'k',
  baseUrl: 'u',
  model: 'gpt-5.4',
  models: ['gpt-5.4'],
  enabled: true,
  ...overrides,
});
