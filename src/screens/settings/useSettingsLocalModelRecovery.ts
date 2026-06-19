import { useCallback, useMemo } from 'react';

import { getFallbackLocalLlmRecommendation } from '../../services/localLlm/memoryPolicy';
import {
  clearLocalLlmInstalledModel,
  getInvalidInstalledLocalLlmModels,
} from '../../services/localLlm/modelArtifacts';
import type { LocalLlmAvailability } from '../../services/localLlm/types';
import type { LocalLlmModelCatalogEntry, LlmProviderConfig } from '../../types/provider';

type DownloadStateWithAvailability = {
  availability: LocalLlmAvailability | null;
};

type UseSettingsLocalModelRecoveryParams = {
  editingProvider: LlmProviderConfig | null;
  editingProviderIsOnDevice: boolean;
  downloadState: DownloadStateWithAvailability;
  selectedLocalCatalogEntry: LocalLlmModelCatalogEntry | null;
  setEditingProvider: (provider: LlmProviderConfig) => void;
};

export function useSettingsLocalModelRecovery({
  editingProvider,
  editingProviderIsOnDevice,
  downloadState,
  selectedLocalCatalogEntry,
  setEditingProvider,
}: UseSettingsLocalModelRecoveryParams) {
  const invalidInstallIssue = useMemo(() => {
    if (!editingProviderIsOnDevice || !editingProvider) {
      return null;
    }

    return (
      getInvalidInstalledLocalLlmModels(editingProvider).find(
        ({ entry }) => entry.modelId === editingProvider.model,
      )?.issue || null
    );
  }, [editingProvider, editingProviderIsOnDevice]);

  const fallbackEntry = useMemo(() => {
    if (!editingProviderIsOnDevice || !editingProvider) {
      return null;
    }

    return getFallbackLocalLlmRecommendation(
      editingProvider.model,
      downloadState.availability?.deviceMemoryGb ?? null,
    );
  }, [downloadState.availability?.deviceMemoryGb, editingProvider, editingProviderIsOnDevice]);

  const handleClearInstall = useCallback(() => {
    if (!editingProvider || !editingProviderIsOnDevice) {
      return;
    }

    setEditingProvider(clearLocalLlmInstalledModel(editingProvider, editingProvider.model));
  }, [editingProvider, editingProviderIsOnDevice, setEditingProvider]);

  const handleChooseFallback = useCallback(() => {
    if (!editingProvider || !fallbackEntry) {
      return;
    }

    setEditingProvider({
      ...editingProvider,
      model: fallbackEntry.id,
    });
  }, [editingProvider, fallbackEntry, setEditingProvider]);

  const handleSwitchToCpu = useCallback(() => {
    if (!editingProvider || !editingProviderIsOnDevice) {
      return;
    }

    setEditingProvider({
      ...editingProvider,
      local: {
        ...editingProvider.local,
        runtime:
          editingProvider.local?.runtime || selectedLocalCatalogEntry?.runtime || 'litert-lm',
        backend: 'cpu',
      },
    });
  }, [
    editingProvider,
    editingProviderIsOnDevice,
    selectedLocalCatalogEntry?.runtime,
    setEditingProvider,
  ]);

  return {
    invalidInstallIssue,
    fallbackModelName: fallbackEntry?.name || null,
    canSwitchToCpu: Boolean(
      selectedLocalCatalogEntry?.supportedBackends.includes('cpu') &&
      editingProvider?.local?.backend !== 'cpu',
    ),
    handleClearInstall,
    handleChooseFallback,
    handleSwitchToCpu,
  };
}
