import { createDownloadResumable } from 'expo-file-system/legacy';
import type { File } from 'expo-file-system';
import { emitLocalLlmInstallProgress } from './downloadProgress';
import {
  getLocalLlmResumeOffsetBytes,
  writeLocalLlmPartialDownloadState,
} from './downloadState';
import {
  getLocalLlmModelObservedSize,
  getMinimumExpectedLocalLlmModelSize,
} from './modelArtifacts';
import type { InstallLocalLlmModelOptions, LocalLlmPartialDownloadState } from './types';

type LocalLlmDownloadResult = { status?: number } | null | undefined;

export type LocalLlmDownloadAttempt = {
  attemptStartBytes: number;
  resumeData?: string;
  start: () => Promise<LocalLlmDownloadResult>;
};

export function createLocalLlmDownloadAttempt(params: {
  modelId: string;
  sourceUrl: string;
  tempDestination: File;
  expectedSizeBytes?: number | null;
  partialState: LocalLlmPartialDownloadState | null;
  onProgress?: InstallLocalLlmModelOptions['onProgress'];
}): LocalLlmDownloadAttempt {
  const {
    modelId,
    sourceUrl,
    tempDestination,
    expectedSizeBytes,
    partialState,
    onProgress,
  } = params;
  const resumeOffsetBytes = getLocalLlmResumeOffsetBytes({
    modelId,
    tempFile: tempDestination,
    expectedSizeBytes,
    partialState,
  });
  const resumeData = resumeOffsetBytes != null ? String(resumeOffsetBytes) : undefined;
  const initialBytesWritten = resumeOffsetBytes || 0;
  const attemptStartBytes = getLocalLlmModelObservedSize(tempDestination);
  const totalBytes = getMinimumExpectedLocalLlmModelSize(
    modelId,
    partialState?.expectedSizeBytes ?? expectedSizeBytes,
  );

  emitLocalLlmInstallProgress(modelId, initialBytesWritten, totalBytes, onProgress);

  writeLocalLlmPartialDownloadState(modelId, {
    modelId,
    sourceUrl,
    expectedSizeBytes: totalBytes,
    updatedAt: Date.now(),
  });

  const downloadTask = createDownloadResumable(
    sourceUrl,
    tempDestination.uri,
    {},
    (downloadProgress) => {
      const reportedTotalBytes =
        typeof downloadProgress.totalBytesExpectedToWrite === 'number' &&
        Number.isFinite(downloadProgress.totalBytesExpectedToWrite) &&
        downloadProgress.totalBytesExpectedToWrite > 0
          ? downloadProgress.totalBytesExpectedToWrite
          : totalBytes;
      emitLocalLlmInstallProgress(
        modelId,
        downloadProgress.totalBytesWritten,
        reportedTotalBytes,
        onProgress,
      );
    },
    resumeData,
  );

  return {
    attemptStartBytes,
    resumeData,
    start: () => (resumeData ? downloadTask.resumeAsync() : downloadTask.downloadAsync()),
  };
}
