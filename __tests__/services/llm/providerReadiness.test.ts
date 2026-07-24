import { getProviderConfigurationReadiness } from '../../../src/services/llm/support/providerReadiness';
import type { LlmProviderConfig } from '../../../src/types/provider';

const createRemoteProvider = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'provider-1',
  kind: 'remote',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-5.4',
  enabled: true,
  ...overrides,
});

describe('getProviderConfigurationReadiness', () => {
  it('reports loading while a required saved credential is being checked', () => {
    expect(
      getProviderConfigurationReadiness(createRemoteProvider(), {
        credentialStatus: 'checking',
      }),
    ).toMatchObject({
      state: 'checking',
      canEnable: false,
      canSave: false,
      issues: [],
    });
  });

  it('identifies each incomplete hosted-provider field', () => {
    expect(
      getProviderConfigurationReadiness(
        createRemoteProvider({ name: '', baseUrl: 'ftp://example.com', model: '' }),
        { credentialStatus: 'missing' },
      ),
    ).toMatchObject({
      state: 'setup-needed',
      canEnable: false,
      canSave: false,
      issues: ['name-required', 'base-url-protocol', 'model-required', 'api-key-required'],
    });
  });

  it('marks a complete current provider active without claiming a live connection', () => {
    expect(
      getProviderConfigurationReadiness(createRemoteProvider(), {
        active: true,
        credentialStatus: 'configured',
      }),
    ).toMatchObject({
      state: 'active',
      canEnable: true,
      canSave: true,
      issues: [],
    });
  });

  it('allows a structurally complete disabled provider to be saved before adding its key', () => {
    expect(
      getProviderConfigurationReadiness(createRemoteProvider({ enabled: false }), {
        credentialStatus: 'missing',
      }),
    ).toMatchObject({
      state: 'off',
      canEnable: false,
      canSave: true,
      issues: ['api-key-required'],
    });
  });

  it('reports credential read failures separately from missing setup', () => {
    expect(
      getProviderConfigurationReadiness(createRemoteProvider(), {
        credentialStatus: 'error',
      }),
    ).toMatchObject({
      state: 'error',
      canEnable: false,
      canSave: false,
    });
  });

  it('requires an on-device model installation before enabling or saving', () => {
    const provider = createRemoteProvider({
      kind: 'on-device',
      name: 'On-device models',
      baseUrl: '',
      model: 'gemma-3n-e2b-it-litertlm',
      local: { runtime: 'litert-lm', installedModels: [] },
    });

    expect(
      getProviderConfigurationReadiness(provider, { localModelInstalled: false }),
    ).toMatchObject({
      state: 'setup-needed',
      canEnable: false,
      canSave: false,
      issues: ['local-model-required'],
      apiKeyRequired: false,
    });
  });

  it('allows keyless loopback providers', () => {
    expect(
      getProviderConfigurationReadiness(
        createRemoteProvider({
          name: 'Local compatible server',
          baseUrl: 'http://127.0.0.1:1234/v1',
        }),
        { credentialStatus: 'missing' },
      ),
    ).toMatchObject({
      state: 'configured',
      canEnable: true,
      canSave: true,
      apiKeyRequired: false,
      issues: [],
    });
  });

  it('requires a key after a keyless draft changes to a hosted endpoint', () => {
    expect(
      getProviderConfigurationReadiness(createRemoteProvider(), {
        credentialStatus: 'not-required',
      }),
    ).toMatchObject({
      state: 'setup-needed',
      canEnable: false,
      canSave: false,
      issues: ['api-key-required'],
    });
  });
});
