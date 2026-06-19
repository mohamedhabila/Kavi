import type { File } from 'expo-file-system';
import {
  LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RESUME_NO_PROGRESS_FAILURES,
  LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RETRYABLE_FAILURES,
  LOCAL_LLM_DOWNLOAD_MAX_TOTAL_RETRYABLE_FAILURES,
} from './constants';
import { createLocalLlmDownloadAttempt } from './downloadAttempt';
import {
  getFreshLocalLlmPartialDownloadState,
  prepareLocalLlmModelArtifactDestination,
} from './downloadPreparation';
import {
  createLocalLlmDownloadRetryLimitError,
  getLocalLlmDownloadRetryDelayMs,
  isRetryableLocalLlmDownloadError,
  isRetryableLocalLlmDownloadStatus,
  waitForLocalLlmDownloadRetry,
} from './downloadRetry';
import {
  clearLocalLlmPartialDownloadArtifacts,
  clearLocalLlmPartialDownloadState,
} from './downloadState';
import {
  getLocalLlmModelObservedSize,
  isValidLocalLlmModelFile,
} from './modelArtifacts';
import type { InstallLocalLlmModelOptions } from './types';

export async function ensureLocalLlmModelArtifactReady(params: {
  modelId: string;
  sourceUrl: string;
  destination: File;
  tempDestination: File;
  expectedSizeBytes?: number | null;
  onProgress?: InstallLocalLlmModelOptions['onProgress'];
}): Promise<void> {
  const { modelId, sourceUrl, destination, tempDestination, expectedSizeBytes, onProgress } =
    params;
  const prepared = await prepareLocalLlmModelArtifactDestination({
    modelId,
    sourceUrl,
    destination,
    tempDestination,
    expectedSizeBytes,
  });

  if (prepared.ready) {
    return;
  }

  let usedFreshFallback = false;
  let totalRetryableFailures = 0;
  let consecutiveRetryableFailures = 0;
  let consecutiveResumeNoProgressFailures = 0;

  while (!isValidLocalLlmModelFile(modelId, destination, expectedSizeBytes)) {
    const partialState = await getFreshLocalLlmPartialDownloadState({
      modelId,
      tempDestination,
      sourceUrl,
      expectedSizeBytes,
    });
    const attempt = createLocalLlmDownloadAttempt({
      modelId,
      sourceUrl,
      tempDestination,
      expectedSizeBytes,
      partialState,
      onProgress,
    });

    let downloadResult;
    try {
      downloadResult = await attempt.start();
    } catch (error) {
      const observedBytesAfterFailure = getLocalLlmModelObservedSize(tempDestination);
      const madeProgress = observedBytesAfterFailure > attempt.attemptStartBytes;

      if (!isRetryableLocalLlmDownloadError(error)) {
        throw error;
      }

      totalRetryableFailures += 1;
      consecutiveRetryableFailures = madeProgress ? 1 : consecutiveRetryableFailures + 1;
      consecutiveResumeNoProgressFailures =
        attempt.resumeData && !madeProgress ? consecutiveResumeNoProgressFailures + 1 : 0;

      if (
        attempt.resumeData &&
        !madeProgress &&
        consecutiveResumeNoProgressFailures >=
          LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RESUME_NO_PROGRESS_FAILURES &&
        !usedFreshFallback
      ) {
        clearLocalLlmPartialDownloadArtifacts(modelId);
        usedFreshFallback = true;
        consecutiveRetryableFailures = 0;
        consecutiveResumeNoProgressFailures = 0;
        continue;
      }

      if (
        totalRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_TOTAL_RETRYABLE_FAILURES ||
        consecutiveRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RETRYABLE_FAILURES
      ) {
        throw createLocalLlmDownloadRetryLimitError(modelId, error);
      }

      await waitForLocalLlmDownloadRetry(
        getLocalLlmDownloadRetryDelayMs(consecutiveRetryableFailures),
      );
      continue;
    }

    if (!downloadResult) {
      throw new Error(`Download cancelled for ${modelId}`);
    }

    const downloadStatus = typeof downloadResult.status === 'number' ? downloadResult.status : 200;
    if (
      attempt.resumeData &&
      (downloadStatus === 200 || downloadStatus === 416) &&
      !usedFreshFallback
    ) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
      usedFreshFallback = true;
      consecutiveRetryableFailures = 0;
      consecutiveResumeNoProgressFailures = 0;
      continue;
    }

    if (downloadStatus < 200 || downloadStatus >= 300) {
      const retryableStatus = isRetryableLocalLlmDownloadStatus(downloadStatus);

      // Android's resumable downloader may append the error response body to the
      // destination file before surfacing a non-2xx status, so the partial is no
      // longer trustworthy once the server responds with an error.
      clearLocalLlmPartialDownloadArtifacts(modelId);

      if (retryableStatus) {
        totalRetryableFailures += 1;
        consecutiveRetryableFailures += 1;
        consecutiveResumeNoProgressFailures = 0;

        if (
          totalRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_TOTAL_RETRYABLE_FAILURES ||
          consecutiveRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RETRYABLE_FAILURES
        ) {
          throw createLocalLlmDownloadRetryLimitError(
            modelId,
            new Error(`Download failed for ${modelId} with status ${downloadStatus}`),
          );
        }

        await waitForLocalLlmDownloadRetry(
          getLocalLlmDownloadRetryDelayMs(consecutiveRetryableFailures),
        );
        continue;
      }

      throw new Error(`Download failed for ${modelId} with status ${downloadStatus}`);
    }

    consecutiveRetryableFailures = 0;
    consecutiveResumeNoProgressFailures = 0;

    if (!isValidLocalLlmModelFile(modelId, tempDestination, expectedSizeBytes)) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
      if (attempt.resumeData && !usedFreshFallback) {
        usedFreshFallback = true;
        consecutiveRetryableFailures = 0;
        consecutiveResumeNoProgressFailures = 0;
        continue;
      }
      throw new Error(`Downloaded file for ${modelId} is incomplete or invalid.`);
    }

    if (destination.exists) {
      destination.delete();
    }
    tempDestination.move(destination);
    clearLocalLlmPartialDownloadState(modelId);
    return;
  }
}
