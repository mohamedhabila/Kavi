import type { LlmProviderConfig } from '../../../types/provider';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { providerRequiresApiKey } from './providerSupport';

export type ProviderCredentialStatus =
  | 'checking'
  | 'configured'
  | 'missing'
  | 'not-required'
  | 'error';

export type ProviderConfigurationIssue =
  | 'name-required'
  | 'base-url-required'
  | 'base-url-invalid'
  | 'base-url-protocol'
  | 'api-key-required'
  | 'model-required'
  | 'local-model-required';

export type ProviderConfigurationState =
  | 'checking'
  | 'setup-needed'
  | 'configured'
  | 'active'
  | 'off'
  | 'error';

export type ProviderConfigurationReadiness = {
  state: ProviderConfigurationState;
  issues: ProviderConfigurationIssue[];
  apiKeyRequired: boolean;
  canEnable: boolean;
  canSave: boolean;
};

type ProviderConfigurationReadinessOptions = {
  active?: boolean;
  credentialStatus?: ProviderCredentialStatus;
  localModelInstalled?: boolean;
};

function getRemoteUrlIssue(baseUrl: string): ProviderConfigurationIssue | null {
  const normalizedUrl = baseUrl.trim();
  if (!normalizedUrl) {
    return 'base-url-required';
  }

  try {
    const parsed = new URL(normalizedUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? null : 'base-url-protocol';
  } catch {
    return 'base-url-invalid';
  }
}

export function getProviderConfigurationReadiness(
  provider: LlmProviderConfig,
  options: ProviderConfigurationReadinessOptions = {},
): ProviderConfigurationReadiness {
  const localProvider = isOnDeviceLlmProvider(provider);
  const apiKeyRequired = providerRequiresApiKey(provider);
  const configuredCredentialStatus =
    options.credentialStatus || ((provider.apiKey || '').trim() ? 'configured' : 'missing');
  const credentialStatus = apiKeyRequired
    ? configuredCredentialStatus === 'not-required'
      ? 'missing'
      : configuredCredentialStatus
    : 'not-required';
  const issues: ProviderConfigurationIssue[] = [];

  if (!provider.name.trim()) {
    issues.push('name-required');
  }

  if (!localProvider) {
    const urlIssue = getRemoteUrlIssue(provider.baseUrl || '');
    if (urlIssue) {
      issues.push(urlIssue);
    }
  }

  if (!provider.model.trim()) {
    issues.push('model-required');
  }

  if (localProvider && options.localModelInstalled === false) {
    issues.push('local-model-required');
  }

  if (apiKeyRequired && credentialStatus === 'missing') {
    issues.push('api-key-required');
  }

  const structuralIssues = issues.filter((issue) => issue !== 'api-key-required');
  const canEnable =
    structuralIssues.length === 0 &&
    credentialStatus !== 'checking' &&
    credentialStatus !== 'error' &&
    (!apiKeyRequired || credentialStatus === 'configured');
  const canSave = structuralIssues.length === 0 && (!provider.enabled || canEnable);

  let state: ProviderConfigurationState;
  if (!provider.enabled) {
    state = 'off';
  } else if (credentialStatus === 'error') {
    state = 'error';
  } else if (credentialStatus === 'checking' && structuralIssues.length === 0) {
    state = 'checking';
  } else if (!canEnable) {
    state = 'setup-needed';
  } else {
    state = options.active ? 'active' : 'configured';
  }

  return {
    state,
    issues,
    apiKeyRequired,
    canEnable,
    canSave,
  };
}
