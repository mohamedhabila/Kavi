import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  buildProviderFromPreset,
  finalizeProviderConfig,
  LlmProviderPreset,
} from '../../constants/api';
import { useLocalLlmModelDownload } from '../../hooks/useLocalLlmModelDownload';
import {
  getLocalLlmCatalogEntriesForProvider,
  getLocalLlmCatalogEntry,
} from '../../services/localLlm/catalog';
import { isLocalLlmModelInstalled } from '../../services/localLlm/modelArtifacts';
import { isOnDeviceLlmProvider } from '../../services/localLlm/provider';
import {
  deleteProviderApiKey,
  getProviderApiKey,
  saveProviderApiKey,
} from '../../services/storage/SecureStorage';
import {
  getProviderConfigurationReadiness,
  type ProviderCredentialStatus,
} from '../../services/llm/support/providerReadiness';
import { providerRequiresApiKey } from '../../services/llm/support/providerSupport';
import { removeCredentialBackedConfiguration } from '../../services/storage/credentialBackedConfigRemoval';
import type { LlmProviderConfig } from '../../types/provider';
import { generateId } from '../../utils/id';
import { useSettingsLocalModelRecovery } from './useSettingsLocalModelRecovery';
import type { SettingsSection } from './useSettingsRemoteConfigFlow';

type TranslationFn = (key: string, params?: any) => string;

function getInitialCredentialStatus(provider: LlmProviderConfig): ProviderCredentialStatus {
  if (!providerRequiresApiKey(provider)) {
    return 'not-required';
  }
  return (provider.apiKey || '').trim() ? 'configured' : 'checking';
}

function getInitialCredentialStatuses(
  providers: LlmProviderConfig[],
): Record<string, ProviderCredentialStatus> {
  return Object.fromEntries(
    providers.map((provider) => [provider.id, getInitialCredentialStatus(provider)]),
  );
}

type UseSettingsProviderFlowParams = {
  t: TranslationFn;
  providers: LlmProviderConfig[];
  activeProviderId?: string | null;
  setSection: React.Dispatch<React.SetStateAction<SettingsSection>>;
  addProvider: (provider: LlmProviderConfig) => void;
  updateProvider: (provider: LlmProviderConfig) => void;
  removeProvider: (id: string) => void;
};

export function useSettingsProviderFlow({
  t,
  providers,
  activeProviderId,
  setSection,
  addProvider,
  updateProvider,
  removeProvider,
}: UseSettingsProviderFlowParams) {
  const [editingProvider, setEditingProvider] = useState<LlmProviderConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [editingCredentialStatus, setEditingCredentialStatus] =
    useState<ProviderCredentialStatus>('missing');
  const [providerCredentialStatuses, setProviderCredentialStatuses] = useState<
    Record<string, ProviderCredentialStatus>
  >(() => getInitialCredentialStatuses(providers));
  const providerEditRequestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    const initialStatuses = getInitialCredentialStatuses(providers);
    setProviderCredentialStatuses(initialStatuses);

    const providersToCheck = providers.filter(
      (provider) => initialStatuses[provider.id] === 'checking',
    );
    if (providersToCheck.length === 0) {
      return () => {
        active = false;
      };
    }

    void Promise.all(
      providersToCheck.map(async (provider) => {
        try {
          const key = await getProviderApiKey(provider.id);
          return [provider.id, key?.trim() ? 'configured' : 'missing'] as const;
        } catch {
          return [provider.id, 'error'] as const;
        }
      }),
    ).then((resolvedStatuses) => {
      if (!active) return;
      setProviderCredentialStatuses((current) => ({
        ...current,
        ...Object.fromEntries(resolvedStatuses),
      }));
    });

    return () => {
      active = false;
    };
  }, [providers]);

  const editingProviderIsOnDevice = Boolean(
    editingProvider && isOnDeviceLlmProvider(editingProvider),
  );
  const editingProviderSelectedModelId =
    editingProviderIsOnDevice && editingProvider ? editingProvider.model : undefined;
  const editingProviderSelectedModelInstalled = Boolean(
    editingProviderIsOnDevice &&
    editingProvider &&
    isLocalLlmModelInstalled(editingProvider, editingProvider.model),
  );

  const {
    downloadModel: downloadEditingLocalModel,
    downloadState: editingLocalModelDownloadState,
    isDownloading: editingLocalModelDownloadInProgress,
    wasJustDownloaded: editingLocalModelWasJustDownloaded,
  } = useLocalLlmModelDownload(
    editingProviderSelectedModelId,
    editingProviderSelectedModelInstalled,
  );

  const handleNewProvider = useCallback(
    (preset?: LlmProviderPreset) => {
      providerEditRequestIdRef.current += 1;
      const newProvider: LlmProviderConfig = preset
        ? buildProviderFromPreset(preset, { id: generateId(), enabled: true })
        : finalizeProviderConfig({
            id: generateId(),
            name: '',
            baseUrl: '',
            apiKey: '',
            model: '',
            enabled: true,
          });
      setEditingProvider(newProvider);
      setTempApiKey('');
      setEditingCredentialStatus(
        providerRequiresApiKey(newProvider) ? 'missing' : 'not-required',
      );
      setShowApiKey(false);
      setSection('provider-edit');
    },
    [setSection],
  );

  const handleEditProvider = useCallback(
    (provider: LlmProviderConfig) => {
      const requestId = providerEditRequestIdRef.current + 1;
      providerEditRequestIdRef.current = requestId;
      const localProvider = isOnDeviceLlmProvider(provider);
      const initialKey = provider.apiKey || '';

      setEditingProvider({ ...provider });
      setTempApiKey(initialKey);
      setEditingCredentialStatus(localProvider ? 'not-required' : 'checking');
      setShowApiKey(false);
      setSection('provider-edit');

      if (localProvider) {
        return;
      }

      void getProviderApiKey(provider.id)
        .then((storedKey) => {
          if (providerEditRequestIdRef.current !== requestId) return;
          const key = storedKey || initialKey;
          setTempApiKey(key);
          setEditingCredentialStatus(key.trim() ? 'configured' : 'missing');
        })
        .catch(() => {
          if (providerEditRequestIdRef.current !== requestId) return;
          setEditingCredentialStatus('error');
        });
    },
    [setSection],
  );

  const handleDownloadSelectedLocalModel = useCallback(async () => {
    if (!editingProvider || !editingProviderIsOnDevice) {
      return;
    }

    const catalogEntry = getLocalLlmCatalogEntry(editingProvider.model);
    if (!catalogEntry) {
      return;
    }

    const updatedProvider = await downloadEditingLocalModel(
      editingProvider,
      catalogEntry.id,
      catalogEntry.sizeBytes,
    );

    if (updatedProvider) {
      setEditingProvider(updatedProvider);
    }
  }, [downloadEditingLocalModel, editingProvider, editingProviderIsOnDevice]);

  const handleSaveProvider = useCallback(async () => {
    if (!editingProvider) return;

    const localProvider = isOnDeviceLlmProvider(editingProvider);
    const readiness = getProviderConfigurationReadiness(editingProvider, {
      credentialStatus: providerRequiresApiKey(editingProvider)
        ? editingCredentialStatus
        : 'not-required',
      localModelInstalled: localProvider
        ? isLocalLlmModelInstalled(editingProvider, editingProvider.model)
        : undefined,
    });

    if (!readiness.canSave || (localProvider && editingLocalModelDownloadInProgress)) {
      return;
    }

    try {
      const normalizedApiKey = tempApiKey.trim();
      if (!localProvider) {
        if (normalizedApiKey) {
          await saveProviderApiKey(editingProvider.id, normalizedApiKey);
        } else {
          await deleteProviderApiKey(editingProvider.id);
        }
      }
      const finalizedProvider = finalizeProviderConfig({ ...editingProvider, apiKey: '' });
      const existing = providers.find((provider) => provider.id === editingProvider.id);
      if (existing) {
        updateProvider(finalizedProvider);
      } else {
        addProvider(finalizedProvider);
      }
      setProviderCredentialStatuses((current) => ({
        ...current,
        [editingProvider.id]: providerRequiresApiKey(finalizedProvider)
          ? tempApiKey.trim()
            ? 'configured'
            : 'missing'
          : 'not-required',
      }));
      providerEditRequestIdRef.current += 1;
      setSection('main');
      setEditingProvider(null);
      setTempApiKey('');
      setEditingCredentialStatus('missing');
      setShowApiKey(false);
    } catch {
      Alert.alert(t('common.error'), t('onboarding.saveFailed'));
    }
  }, [
    addProvider,
    editingCredentialStatus,
    editingLocalModelDownloadInProgress,
    editingProvider,
    providers,
    setSection,
    t,
    tempApiKey,
    updateProvider,
  ]);

  const handleDeleteProvider = useCallback(
    (id: string) => {
      Alert.alert(t('settings.deleteProvider'), t('settings.deleteProviderConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const removed = await removeCredentialBackedConfiguration({
              deleteCredentials: () => deleteProviderApiKey(id),
              removeConfiguration: () => removeProvider(id),
              onCredentialDeleteFailure: () =>
                Alert.alert(t('common.error'), t('settings.secureKeyDeleteFailed')),
            });
            if (!removed) return;
            providerEditRequestIdRef.current += 1;
            setSection('main');
            setEditingProvider(null);
            setTempApiKey('');
            setEditingCredentialStatus('missing');
            setShowApiKey(false);
          },
        },
      ]);
    },
    [removeProvider, setSection, t],
  );

  const closeProviderEditor = useCallback(() => {
    providerEditRequestIdRef.current += 1;
    setSection('main');
    setEditingProvider(null);
    setTempApiKey('');
    setEditingCredentialStatus('missing');
    setShowApiKey(false);
  }, [setSection]);

  const localCatalog = useMemo(
    () =>
      editingProviderIsOnDevice && editingProvider
        ? getLocalLlmCatalogEntriesForProvider(editingProvider)
        : [],
    [editingProvider, editingProviderIsOnDevice],
  );
  const selectedLocalCatalogEntry = useMemo(
    () =>
      editingProviderIsOnDevice && editingProvider
        ? getLocalLlmCatalogEntry(editingProvider.model) || localCatalog[0] || null
        : null,
    [editingProvider, editingProviderIsOnDevice, localCatalog],
  );
  const localModelRecovery = useSettingsLocalModelRecovery({
    editingProvider,
    editingProviderIsOnDevice,
    downloadState: editingLocalModelDownloadState,
    selectedLocalCatalogEntry,
    setEditingProvider,
  });
  const editingProviderReadiness = useMemo(() => {
    if (!editingProvider) return null;

    return getProviderConfigurationReadiness(editingProvider, {
      active: editingProvider.id === activeProviderId,
      credentialStatus: providerRequiresApiKey(editingProvider)
        ? editingCredentialStatus
        : 'not-required',
      localModelInstalled: editingProviderIsOnDevice
        ? isLocalLlmModelInstalled(editingProvider, editingProvider.model)
        : undefined,
    });
  }, [
    activeProviderId,
    editingCredentialStatus,
    editingProvider,
    editingProviderIsOnDevice,
  ]);
  const canSaveProvider = Boolean(
    editingProviderReadiness?.canSave && !editingLocalModelDownloadInProgress,
  );
  const editingProviderIsExisting = useMemo(
    () =>
      Boolean(editingProvider && providers.some((provider) => provider.id === editingProvider.id)),
    [editingProvider, providers],
  );

  return {
    editingProvider,
    editingProviderIsOnDevice,
    editingProviderIsExisting,
    localCatalog,
    selectedLocalCatalogEntry,
    canSaveProvider,
    editingProviderReadiness,
    providerCredentialStatuses,
    showApiKey,
    tempApiKey,
    editingLocalModelDownloadState,
    editingLocalModelWasJustDownloaded,
    editingLocalModelInvalidInstallIssue: localModelRecovery.invalidInstallIssue,
    editingLocalModelFallbackName: localModelRecovery.fallbackModelName,
    canSwitchEditingLocalModelToCpu: localModelRecovery.canSwitchToCpu,
    handleNewProvider,
    handleEditProvider,
    handleDownloadSelectedLocalModel,
    handleClearSelectedLocalModelInstall: localModelRecovery.handleClearInstall,
    handleSwitchSelectedLocalModelToCpu: localModelRecovery.handleSwitchToCpu,
    handleChooseFallbackLocalModel: localModelRecovery.handleChooseFallback,
    handleSaveProvider,
    handleDeleteProvider,
    closeProviderEditor,
    onToggleShowApiKey: () => setShowApiKey((current) => !current),
    setEditingProvider,
    setTempApiKey: (value: string) => {
      providerEditRequestIdRef.current += 1;
      setTempApiKey(value);
      setEditingCredentialStatus(
        editingProvider && providerRequiresApiKey(editingProvider)
          ? value.trim()
            ? 'configured'
            : 'missing'
          : 'not-required',
      );
    },
    isLocalLlmModelInstalled,
  };
}
