import { useCallback, useMemo, useState } from 'react';
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
import type { LlmProviderConfig } from '../../types/provider';
import { generateId } from '../../utils/id';
import { useSettingsLocalModelRecovery } from './useSettingsLocalModelRecovery';
import type { SettingsSection } from './useSettingsRemoteConfigFlow';

type TranslationFn = (key: string, params?: any) => string;

type UseSettingsProviderFlowParams = {
  t: TranslationFn;
  providers: LlmProviderConfig[];
  setSection: React.Dispatch<React.SetStateAction<SettingsSection>>;
  addProvider: (provider: LlmProviderConfig) => void;
  updateProvider: (provider: LlmProviderConfig) => void;
  removeProvider: (id: string) => void;
};

export function useSettingsProviderFlow({
  t,
  providers,
  setSection,
  addProvider,
  updateProvider,
  removeProvider,
}: UseSettingsProviderFlowParams) {
  const [editingProvider, setEditingProvider] = useState<LlmProviderConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

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
      const newProvider: LlmProviderConfig = preset
        ? buildProviderFromPreset(preset, { id: generateId(), enabled: true })
        : finalizeProviderConfig({
            id: generateId(),
            name: t('settings.newProvider'),
            baseUrl: '',
            apiKey: '',
            model: '',
            enabled: true,
          });
      setEditingProvider(newProvider);
      setTempApiKey('');
      setShowApiKey(false);
      setSection('provider-edit');
    },
    [setSection, t],
  );

  const handleEditProvider = useCallback(
    async (provider: LlmProviderConfig) => {
      const key = (await getProviderApiKey(provider.id)) || '';
      setEditingProvider({ ...provider });
      setTempApiKey(key);
      setShowApiKey(false);
      setSection('provider-edit');
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

    if (
      localProvider &&
      (editingLocalModelDownloadInProgress ||
        !isLocalLlmModelInstalled(editingProvider, editingProvider.model))
    ) {
      return;
    }

    if (!localProvider) {
      const url = editingProvider.baseUrl?.trim();
      if (url) {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            Alert.alert(t('settings.invalidUrl'), t('settings.invalidUrlHttp'));
            return;
          }
        } catch {
          Alert.alert(t('settings.invalidUrl'), t('settings.invalidUrlFormat'));
          return;
        }
      }
    }

    try {
      if (!localProvider && tempApiKey) {
        await saveProviderApiKey(editingProvider.id, tempApiKey);
      }
      const finalizedProvider = finalizeProviderConfig(editingProvider);
      const existing = providers.find((provider) => provider.id === editingProvider.id);
      if (existing) {
        updateProvider(finalizedProvider);
      } else {
        addProvider(finalizedProvider);
      }
      setSection('main');
      setEditingProvider(null);
      setTempApiKey('');
      setShowApiKey(false);
    } catch {
      Alert.alert(t('common.error'), t('onboarding.saveFailed'));
    }
  }, [
    addProvider,
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
            removeProvider(id);
            await deleteProviderApiKey(id);
            setSection('main');
            setEditingProvider(null);
          },
        },
      ]);
    },
    [removeProvider, setSection, t],
  );

  const closeProviderEditor = useCallback(() => {
    setSection('main');
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
  const canSaveProvider = useMemo(() => {
    if (!editingProviderIsOnDevice) {
      return true;
    }
    if (!editingProvider || editingLocalModelDownloadInProgress) {
      return false;
    }
    return isLocalLlmModelInstalled(editingProvider, editingProvider.model);
  }, [editingLocalModelDownloadInProgress, editingProvider, editingProviderIsOnDevice]);
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
    setTempApiKey,
    isLocalLlmModelInstalled,
  };
}
