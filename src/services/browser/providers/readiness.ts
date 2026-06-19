import type { BrowserProviderConfig } from '../../../types/remote';
import {
  isValidBrowserProviderBaseUrl,
  normalizeBrowserProvider,
  normalizeBrowserProviderAuthMode,
  normalizeBrowserProviderBaseUrl,
} from './registry';

export interface BrowserProviderReadiness {
  launchable: boolean;
  reason:
    | 'ready'
    | 'disabled'
    | 'missing-base-url'
    | 'invalid-base-url'
    | 'missing-api-key'
    | 'missing-project-id';
}

export function getBrowserProviderReadiness(
  config: BrowserProviderConfig,
  apiKey?: string | null,
): BrowserProviderReadiness {
  if (!config.enabled) {
    return { launchable: false, reason: 'disabled' };
  }

  const baseUrl = normalizeBrowserProviderBaseUrl(config);
  if (!baseUrl) {
    return { launchable: false, reason: 'missing-base-url' };
  }

  if (!isValidBrowserProviderBaseUrl(baseUrl)) {
    return { launchable: false, reason: 'invalid-base-url' };
  }

  const provider = normalizeBrowserProvider(config.provider);
  const authMode = normalizeBrowserProviderAuthMode(config);
  const hasToken = Boolean((apiKey || '').trim() || (config.apiKeyRef || '').trim());

  if (provider === 'browserbase' && !(config.projectId || '').trim()) {
    return { launchable: false, reason: 'missing-project-id' };
  }

  if (authMode !== 'none' && !hasToken) {
    return { launchable: false, reason: 'missing-api-key' };
  }

  return { launchable: true, reason: 'ready' };
}
