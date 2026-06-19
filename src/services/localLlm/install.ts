import type { LlmProviderConfig } from '../../types/provider';
import { getLocalLlmCatalogEntry } from './catalog';
import { ensureLocalLlmModelCanRun } from './availability';
import { resolveLocalLlmAccelerator } from './backendPolicy';
import { emitLocalLlmInstallProgress } from './downloadProgress';
import { ensureLocalLlmModelArtifactReady } from './downloads';
import {
  getInstalledLocalLlmModelValidationIssue,
  getLocalLlmModelFile,
  getLocalLlmModelObservedSize,
  getLocalLlmModelTempFile,
  normalizeInstalledModels,
} from './modelArtifacts';
import { getLocalLlmProviderModelIds, normalizeLocalLlmProvider } from './provider';
import type { InstallLocalLlmModelOptions } from './types';

export async function installLocalLlmModel(
  provider: LlmProviderConfig,
  modelId: string,
  options: InstallLocalLlmModelOptions = {},
): Promise<LlmProviderConfig> {
  const normalizedProvider = normalizeLocalLlmProvider(provider);
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  const availability = await ensureLocalLlmModelCanRun(modelId);

  const destination = getLocalLlmModelFile(modelId);
  const tempDestination = getLocalLlmModelTempFile(modelId);
  const existingInstallEntry = normalizeInstalledModels(normalizedProvider).find(
    (entry) => entry.modelId === modelId,
  );
  const existingInstallIssue = existingInstallEntry
    ? getInstalledLocalLlmModelValidationIssue(existingInstallEntry)
    : null;

  if ((!existingInstallEntry || existingInstallIssue) && destination.exists) {
    destination.delete();
  }

  await ensureLocalLlmModelArtifactReady({
    modelId,
    sourceUrl: catalogEntry.downloadUrl,
    destination,
    tempDestination,
    expectedSizeBytes: catalogEntry.sizeBytes,
    onProgress: options.onProgress,
  });

  const installedSizeBytes = getLocalLlmModelObservedSize(destination) || catalogEntry.sizeBytes;

  emitLocalLlmInstallProgress(modelId, installedSizeBytes, installedSizeBytes, options.onProgress);

  const installedModels = normalizeInstalledModels(normalizedProvider).filter(
    (entry) => entry.modelId !== modelId,
  );
  installedModels.push({
    modelId,
    fileName: catalogEntry.fileName,
    localPath: destination.uri,
    installedAt: Date.now(),
    sizeBytes: installedSizeBytes,
    sourceUrl: catalogEntry.downloadUrl,
    repositoryId: catalogEntry.repositoryId,
    downloadRevision: catalogEntry.downloadRevision,
  });

  const updatedProvider = {
    ...normalizedProvider,
    model: modelId,
    local: {
      runtime: catalogEntry.runtime,
      backend: resolveLocalLlmAccelerator(
        normalizedProvider,
        modelId,
        availability.deviceMemoryGb ?? null,
      ),
      catalogModelIds:
        normalizedProvider.local?.catalogModelIds ||
        getLocalLlmProviderModelIds(normalizedProvider),
      installedModels,
    },
  };

  return updatedProvider;
}
