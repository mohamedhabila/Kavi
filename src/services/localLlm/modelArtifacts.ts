import { Directory, File, Paths } from 'expo-file-system';
import type { InstalledLocalLlmModel, LlmProviderConfig } from '../../types/provider';
import {
  DEFAULT_LOCAL_LLM_MODEL_ID,
  getLocalLlmCatalogEntriesForProvider,
  getLocalLlmCatalogEntry,
} from './catalog';

export type InstalledLocalLlmModelValidationIssue =
  | 'unknown_model'
  | 'file_name_mismatch'
  | 'source_url_mismatch'
  | 'repository_mismatch'
  | 'revision_mismatch'
  | 'missing_or_invalid_file';

export function normalizeInstalledModels(provider: LlmProviderConfig): InstalledLocalLlmModel[] {
  const seen = new Set<string>();
  const models: InstalledLocalLlmModel[] = [];

  for (const entry of provider.local?.installedModels || []) {
    if (!entry || typeof entry.modelId !== 'string' || seen.has(entry.modelId)) {
      continue;
    }
    seen.add(entry.modelId);
    models.push(entry);
  }

  return models;
}

export function ensureLocalLlmModelsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'local-llm', 'models');
  if (!dir.exists) {
    dir.create({ idempotent: true, intermediates: true });
  }
  return dir;
}

export function getLocalLlmModelFile(modelId: string): File {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return new File(ensureLocalLlmModelsDirectory(), catalogEntry.fileName);
}

export function getLocalLlmModelTempFile(modelId: string): File {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return new File(ensureLocalLlmModelsDirectory(), `${catalogEntry.fileName}.download`);
}

export function getLocalLlmModelPartialDownloadStateFile(modelId: string): File {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return new File(ensureLocalLlmModelsDirectory(), `${catalogEntry.fileName}.download.json`);
}

export function getLocalLlmModelRecordedSize(sizeBytes: number | null | undefined): number | null {
  return typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0
    ? Math.max(0, sizeBytes)
    : null;
}

export function getLocalLlmModelObservedSize(file: File): number {
  return getLocalLlmModelRecordedSize(file.size) || 0;
}

export function getMinimumExpectedLocalLlmModelSize(
  modelId: string,
  installedSizeBytes?: number | null,
): number | null {
  const catalogSizeBytes = getLocalLlmModelRecordedSize(
    getLocalLlmCatalogEntry(modelId)?.sizeBytes,
  );
  const recordedInstalledSizeBytes = getLocalLlmModelRecordedSize(installedSizeBytes);

  if (catalogSizeBytes == null && recordedInstalledSizeBytes == null) {
    return null;
  }

  return Math.max(catalogSizeBytes || 0, recordedInstalledSizeBytes || 0);
}

export function isValidLocalLlmModelFile(
  modelId: string,
  file: File,
  installedSizeBytes?: number | null,
): boolean {
  if (!file.exists) {
    return false;
  }

  const minimumExpectedSize = getMinimumExpectedLocalLlmModelSize(modelId, installedSizeBytes);
  if (minimumExpectedSize == null) {
    return true;
  }

  return getLocalLlmModelObservedSize(file) >= minimumExpectedSize;
}

export function getInstalledLocalLlmModelValidationIssue(
  entry: InstalledLocalLlmModel,
): InstalledLocalLlmModelValidationIssue | null {
  const catalogEntry = getLocalLlmCatalogEntry(entry.modelId);
  if (!catalogEntry) {
    return 'unknown_model';
  }

  if (entry.fileName !== catalogEntry.fileName) {
    return 'file_name_mismatch';
  }

  if (entry.sourceUrl !== catalogEntry.downloadUrl) {
    return 'source_url_mismatch';
  }

  if (entry.repositoryId != null && entry.repositoryId !== catalogEntry.repositoryId) {
    return 'repository_mismatch';
  }

  if (entry.downloadRevision != null && entry.downloadRevision !== catalogEntry.downloadRevision) {
    return 'revision_mismatch';
  }

  if (!isValidLocalLlmModelFile(entry.modelId, new File(entry.localPath), catalogEntry.sizeBytes)) {
    return 'missing_or_invalid_file';
  }

  return null;
}

export function getInvalidInstalledLocalLlmModels(
  provider: LlmProviderConfig,
): Array<{ entry: InstalledLocalLlmModel; issue: InstalledLocalLlmModelValidationIssue }> {
  return normalizeInstalledModels(provider)
    .map((entry) => ({
      entry,
      issue: getInstalledLocalLlmModelValidationIssue(entry),
    }))
    .filter(
      (
        result,
      ): result is {
        entry: InstalledLocalLlmModel;
        issue: InstalledLocalLlmModelValidationIssue;
      } => result.issue != null,
    );
}

function deleteLocalLlmFileIfPresent(file: File): void {
  if (file.exists) {
    file.delete();
  }
}

export function clearLocalLlmInstalledModel(
  provider: LlmProviderConfig,
  modelId: string,
): LlmProviderConfig {
  if (!provider.local) {
    return provider;
  }

  const installedModels = normalizeInstalledModels(provider);
  const entriesToRemove = installedModels.filter((entry) => entry.modelId === modelId);

  entriesToRemove.forEach((entry) => {
    deleteLocalLlmFileIfPresent(new File(entry.localPath));
  });

  if (getLocalLlmCatalogEntry(modelId)) {
    deleteLocalLlmFileIfPresent(getLocalLlmModelFile(modelId));
    deleteLocalLlmFileIfPresent(getLocalLlmModelTempFile(modelId));
    deleteLocalLlmFileIfPresent(getLocalLlmModelPartialDownloadStateFile(modelId));
  }

  return {
    ...provider,
    local: {
      ...provider.local,
      installedModels: installedModels.filter((entry) => entry.modelId !== modelId),
    },
  };
}

export function getNativeLocalLlmModelPath(modelPath: string): string {
  const trimmedPath = modelPath.trim();
  if (!/^file:/i.test(trimmedPath)) {
    return trimmedPath;
  }

  const withoutScheme = trimmedPath.replace(/^file:\/\//i, '');
  const normalizedPath = withoutScheme.startsWith('/') ? withoutScheme : `/${withoutScheme}`;
  try {
    return decodeURIComponent(normalizedPath);
  } catch {
    return normalizedPath;
  }
}

export function getInstalledLocalLlmModels(provider: LlmProviderConfig): InstalledLocalLlmModel[] {
  return normalizeInstalledModels(provider).filter(
    (entry) => getInstalledLocalLlmModelValidationIssue(entry) == null,
  );
}

export function isLocalLlmModelInstalled(provider: LlmProviderConfig, modelId: string): boolean {
  return getInstalledLocalLlmModels(provider).some((entry) => entry.modelId === modelId);
}

export function getSelectableLocalLlmModels(provider: LlmProviderConfig): string[] {
  const installedIds = new Set(getInstalledLocalLlmModels(provider).map((entry) => entry.modelId));
  if (installedIds.size > 0) {
    const orderedInstalledModels = getLocalLlmCatalogEntriesForProvider(provider)
      .map((entry) => entry.id)
      .filter((modelId) => installedIds.has(modelId));
    if (orderedInstalledModels.length > 0) {
      return orderedInstalledModels;
    }
  }

  return provider.model ? [provider.model] : [DEFAULT_LOCAL_LLM_MODEL_ID];
}

export function resolveInstalledLocalLlmModelPath(
  provider: LlmProviderConfig,
  modelId = provider.model,
): string | null {
  const installed = getInstalledLocalLlmModels(provider).find((entry) => entry.modelId === modelId);
  if (installed?.localPath) {
    return installed.localPath;
  }

  return null;
}
