import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { createBrowserDraft, prepareBrowserDraft } from '../../../screens/configDrafts';
import { isValidBrowserProviderBaseUrl } from '../../../services/browser/providers/registry';
import { deleteSecure, saveSecure } from '../../../services/storage/SecureStorage';
import type { BrowserProviderConfig } from '../../../types/remote';
import { SharedControllerOptions, confirmDeletion } from './useRemoteConfigControllerShared';

export function useBrowserConfigController(
  options: SharedControllerOptions & {
    onSaved?: (provider: BrowserProviderConfig) => void;
    onDeleted?: (id: string) => void;
  },
) {
  const { settings, t, onSaved, onDeleted } = options;
  const [draft, setDraft] = useState<BrowserProviderConfig | null>(null);
  const [browserApiKey, setBrowserApiKey] = useState('');

  const close = useCallback(() => {
    setDraft(null);
    setBrowserApiKey('');
  }, []);

  const openNew = useCallback((overrides: Partial<BrowserProviderConfig> = {}) => {
    setDraft(createBrowserDraft(overrides));
    setBrowserApiKey('');
  }, []);

  const openEdit = useCallback((provider: BrowserProviderConfig) => {
    setDraft(prepareBrowserDraft(provider));
    setBrowserApiKey('');
  }, []);

  const save = useCallback(async () => {
    if (!draft) return null;
    const baseUrl = (draft.baseUrl || '').trim();
    const authMode = draft.authMode || 'api-key-header';
    const provider = draft.provider || 'browserbase';
    const projectId = (draft.projectId || '').trim();
    const queryTokenParam = (draft.queryTokenParam || '').trim();
    const apiKey = browserApiKey.trim();

    if (baseUrl && !isValidBrowserProviderBaseUrl(baseUrl)) {
      Alert.alert(t('common.error'), t('settings.browserBaseUrlInvalid'));
      return null;
    }
    if (provider === 'browserbase' && !projectId) {
      Alert.alert(t('common.error'), t('settings.browserProjectRequired'));
      return null;
    }
    if (authMode === 'query-token' && !queryTokenParam) {
      Alert.alert(t('common.error'), t('settings.browserQueryTokenParamRequired'));
      return null;
    }
    if (authMode !== 'none' && !apiKey && !draft.apiKeyRef) {
      Alert.alert(t('common.error'), t('settings.browserApiKeyRequired'));
      return null;
    }

    const apiKeyRef = `browser_provider_api_key_${draft.id}`;
    try {
      if (authMode !== 'none' && apiKey) {
        await saveSecure(apiKeyRef, apiKey);
      } else if (authMode === 'none') {
        await deleteSecure(apiKeyRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return null;
    }

    const normalizedProvider: BrowserProviderConfig = {
      ...draft,
      provider,
      baseUrl,
      authMode,
      apiKeyRef: authMode !== 'none' ? draft.apiKeyRef || apiKeyRef : undefined,
      queryTokenParam: authMode === 'query-token' ? queryTokenParam : undefined,
      projectId: provider === 'browserbase' ? projectId : undefined,
    };

    if ((settings.browserProviders || []).some((entry) => entry.id === normalizedProvider.id)) {
      settings.updateBrowserProvider(normalizedProvider);
    } else {
      settings.addBrowserProvider(normalizedProvider);
    }
    onSaved?.(normalizedProvider);
    close();
    return normalizedProvider;
  }, [browserApiKey, close, draft, onSaved, settings, t]);

  const remove = useCallback(
    (id: string) => {
      confirmDeletion(t, 'settings.deleteBrowserProviderConfirm', () => {
        settings.removeBrowserProvider(id);
        void deleteSecure(`browser_provider_api_key_${id}`);
        onDeleted?.(id);
        close();
      });
    },
    [close, onDeleted, settings, t],
  );

  const isExisting = Boolean(
    draft && (settings.browserProviders || []).some((provider) => provider.id === draft.id),
  );

  return {
    draft,
    setDraft,
    browserApiKey,
    setBrowserApiKey,
    isEditorVisible: Boolean(draft),
    isExisting,
    openNew,
    openEdit,
    close,
    save,
    remove,
  };
}
