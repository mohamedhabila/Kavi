import type { File } from 'expo-file-system';
import {
  clearLocalLlmPartialDownloadArtifacts,
  clearLocalLlmPartialDownloadState,
  isLocalLlmPartialDownloadStale,
  readLocalLlmPartialDownloadState,
} from './downloadState';
import { isValidLocalLlmModelFile } from './modelArtifacts';
import type { LocalLlmPartialDownloadState } from './types';

export async function getFreshLocalLlmPartialDownloadState(params: {
  modelId: string;
  tempDestination: File;
  sourceUrl: string;
  expectedSizeBytes?: number | null;
}): Promise<LocalLlmPartialDownloadState | null> {
  const partialState = await readLocalLlmPartialDownloadState(params.modelId);
  if (
    params.tempDestination.exists &&
    isLocalLlmPartialDownloadStale({
      modelId: params.modelId,
      tempFile: params.tempDestination,
      sourceUrl: params.sourceUrl,
      partialState,
      expectedSizeBytes: params.expectedSizeBytes,
    })
  ) {
    clearLocalLlmPartialDownloadArtifacts(params.modelId);
    return null;
  }

  return partialState;
}

export async function prepareLocalLlmModelArtifactDestination(params: {
  modelId: string;
  sourceUrl: string;
  destination: File;
  tempDestination: File;
  expectedSizeBytes?: number | null;
}): Promise<{
  ready: boolean;
  partialState: LocalLlmPartialDownloadState | null;
}> {
  const { modelId, destination, tempDestination, expectedSizeBytes } = params;

  if (destination.exists && !isValidLocalLlmModelFile(modelId, destination, expectedSizeBytes)) {
    destination.delete();
  }

  const partialState = await getFreshLocalLlmPartialDownloadState(params);

  if (!destination.exists && isValidLocalLlmModelFile(modelId, tempDestination, expectedSizeBytes)) {
    tempDestination.move(destination);
    clearLocalLlmPartialDownloadState(modelId);
  }

  if (isValidLocalLlmModelFile(modelId, destination, expectedSizeBytes)) {
    if (tempDestination.exists) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
    } else {
      clearLocalLlmPartialDownloadState(modelId);
    }
    return {
      ready: true,
      partialState: null,
    };
  }

  return {
    ready: false,
    partialState,
  };
}
