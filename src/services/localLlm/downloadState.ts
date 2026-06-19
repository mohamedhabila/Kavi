import type { File } from 'expo-file-system';
import { getCurrentLocalLlmPlatform } from './catalog';
import { LOCAL_LLM_PARTIAL_DOWNLOAD_MAX_AGE_MS } from './constants';
import {
  getLocalLlmModelObservedSize,
  getLocalLlmModelPartialDownloadStateFile,
  getLocalLlmModelRecordedSize,
  getLocalLlmModelTempFile,
  getMinimumExpectedLocalLlmModelSize,
} from './modelArtifacts';
import type { LocalLlmPartialDownloadState } from './types';

export async function readLocalLlmPartialDownloadState(
  modelId: string,
): Promise<LocalLlmPartialDownloadState | null> {
  const stateFile = getLocalLlmModelPartialDownloadStateFile(modelId);
  if (!stateFile.exists) {
    return null;
  }

  try {
    const raw = await stateFile.text();
    const parsed = JSON.parse(raw) as Partial<LocalLlmPartialDownloadState> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sourceUrl !== 'string') {
      stateFile.delete();
      return null;
    }

    return {
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : modelId,
      sourceUrl: parsed.sourceUrl,
      expectedSizeBytes: getLocalLlmModelRecordedSize(parsed.expectedSizeBytes),
      updatedAt:
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
    };
  } catch {
    stateFile.delete();
    return null;
  }
}

export function writeLocalLlmPartialDownloadState(
  modelId: string,
  state: LocalLlmPartialDownloadState,
): void {
  getLocalLlmModelPartialDownloadStateFile(modelId).write(JSON.stringify(state));
}

export function clearLocalLlmPartialDownloadState(modelId: string): void {
  const stateFile = getLocalLlmModelPartialDownloadStateFile(modelId);
  if (stateFile.exists) {
    stateFile.delete();
  }
}

export function clearLocalLlmPartialDownloadArtifacts(modelId: string): void {
  const tempFile = getLocalLlmModelTempFile(modelId);
  if (tempFile.exists) {
    tempFile.delete();
  }
  clearLocalLlmPartialDownloadState(modelId);
}

export function isLocalLlmPartialDownloadStale(params: {
  modelId: string;
  tempFile: File;
  sourceUrl: string;
  partialState: LocalLlmPartialDownloadState | null;
  expectedSizeBytes?: number | null;
}): boolean {
  const observedSize = getLocalLlmModelObservedSize(params.tempFile);
  if (observedSize <= 0) {
    return true;
  }

  if (!params.partialState) {
    return true;
  }

  if (params.partialState.modelId !== params.modelId) {
    return true;
  }

  if (
    params.partialState.updatedAt <= 0 ||
    Date.now() - params.partialState.updatedAt > LOCAL_LLM_PARTIAL_DOWNLOAD_MAX_AGE_MS
  ) {
    return true;
  }

  if (params.partialState?.sourceUrl && params.partialState.sourceUrl !== params.sourceUrl) {
    return true;
  }

  const recordedExpectedSize = getLocalLlmModelRecordedSize(params.partialState?.expectedSizeBytes);
  const minimumExpectedSize = getMinimumExpectedLocalLlmModelSize(
    params.modelId,
    recordedExpectedSize ?? params.expectedSizeBytes,
  );

  if (
    recordedExpectedSize != null &&
    minimumExpectedSize != null &&
    recordedExpectedSize !== minimumExpectedSize
  ) {
    return true;
  }

  return minimumExpectedSize != null && observedSize > minimumExpectedSize;
}

export function getLocalLlmResumeOffsetBytes(params: {
  modelId: string;
  tempFile: File;
  expectedSizeBytes?: number | null;
  partialState: LocalLlmPartialDownloadState | null;
}): number | null {
  if (getCurrentLocalLlmPlatform() !== 'android' || !params.tempFile.exists) {
    return null;
  }

  const observedSize = getLocalLlmModelObservedSize(params.tempFile);
  if (observedSize <= 0) {
    return null;
  }

  const minimumExpectedSize = getMinimumExpectedLocalLlmModelSize(
    params.modelId,
    params.partialState?.expectedSizeBytes ?? params.expectedSizeBytes,
  );

  if (minimumExpectedSize != null && observedSize >= minimumExpectedSize) {
    return null;
  }

  return observedSize;
}
