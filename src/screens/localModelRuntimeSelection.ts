import { LlmProviderConfig } from '../types/provider';
import { isOnDeviceLlmProvider } from '../services/localLlm/provider';
import { getInstalledLocalLlmModels } from '../services/localLlm/modelArtifacts';

type InstalledLocalModel = NonNullable<
  NonNullable<LlmProviderConfig['local']>['installedModels']
>[number];

export type LocalModelInitializationState = {
  modelKey: string | null;
  status: 'idle' | 'initializing' | 'initialized' | 'error';
  errorMessage: string | null;
};

export const LOCAL_MODEL_INITIALIZATION_IDLE_STATE: LocalModelInitializationState = {
  modelKey: null,
  status: 'idle',
  errorMessage: null,
};

export function getActiveInstalledLocalModel(
  activeProvider?: LlmProviderConfig,
  currentModel?: string,
): InstalledLocalModel | null {
  if (!activeProvider || !currentModel || !isOnDeviceLlmProvider(activeProvider)) {
    return null;
  }

  return (
    getInstalledLocalLlmModels(activeProvider).find((entry) => entry.modelId === currentModel) ||
    null
  );
}

export function getActiveLocalModelKey(params: {
  activeInstalledLocalModel: InstalledLocalModel | null;
  activeProvider?: LlmProviderConfig;
  currentModel?: string;
}): string | null {
  const { activeInstalledLocalModel, activeProvider, currentModel } = params;
  if (
    !activeProvider ||
    !currentModel ||
    !isOnDeviceLlmProvider(activeProvider) ||
    !activeInstalledLocalModel
  ) {
    return null;
  }

  return `${activeInstalledLocalModel.localPath || currentModel}::${currentModel}::${
    activeProvider.local?.backend || 'default'
  }`;
}
