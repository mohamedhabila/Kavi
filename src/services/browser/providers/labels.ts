import { i18n } from '../../../i18n/manager';
import type { BrowserProviderConfig } from '../../../types/remote';
import { normalizeBrowserProvider, normalizeBrowserProviderAuthMode } from './registry';

export function getBrowserProviderAuthLabel(authMode?: BrowserProviderConfig['authMode']): string {
  switch (authMode || 'api-key-header') {
    case 'none':
      return i18n.t('settings.browserAuthNone');
    case 'bearer':
      return i18n.t('settings.workspaceAuthBearer');
    case 'query-token':
      return i18n.t('settings.workspaceAuthQueryToken');
    case 'api-key-header':
    default:
      return i18n.t('settings.browserAuthApiKeyHeader');
  }
}

export function getBrowserProviderAuthHint(config: BrowserProviderConfig): string {
  const provider = normalizeBrowserProvider(config.provider);
  const authMode = normalizeBrowserProviderAuthMode(config);

  if (provider === 'browserbase') {
    return i18n.t('settings.browserAuthHintBrowserbase');
  }
  if (provider === 'browserless' && authMode === 'query-token') {
    return i18n.t('settings.browserAuthHintBrowserlessQueryToken');
  }
  if (authMode === 'bearer') {
    return i18n.t('settings.browserAuthHintBearer');
  }
  if (authMode === 'api-key-header') {
    return i18n.t('settings.browserAuthHintApiKeyHeader');
  }
  if (authMode === 'query-token') {
    return i18n.t('settings.browserAuthHintQueryToken');
  }
  return i18n.t('settings.browserAuthHintNone');
}

export function getBrowserProviderLabel(provider?: BrowserProviderConfig['provider']): string {
  switch (normalizeBrowserProvider(provider)) {
    case 'browserless':
      return i18n.t('remoteWork.providerBrowserless');
    case 'custom':
      return i18n.t('remoteWork.providerCustomBrowserWorker');
    case 'browserbase':
    default:
      return i18n.t('remoteWork.providerBrowserbase');
  }
}
