import * as ExpoFileSystem from 'expo-file-system';
import {
  advanceDownloadRetryTimers,
  createExplicitAndroidLocalProvider,
  getTempModelPath,
  getTempModelStatePath,
  installLocalLlmRuntimeTestHarness,
  legacyFileSystemMock,
  overrideMathRandom,
  setPlatformOs,
} from '../../fixtures/localLlm/runtimeTestHarness';
import { getLocalLlmCatalogEntry } from '../../../src/services/localLlm/catalog';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';
import { isLocalLlmModelInstalled } from '../../../src/services/localLlm/modelArtifacts';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';

installLocalLlmRuntimeTestHarness();

describe('localLlm runtime download resume', () => {
  it('reports install progress while downloading a model', async () => {
    const provider = createDefaultLocalLlmProvider('local-provider');
    const onProgress = jest.fn();

    await installLocalLlmModel(provider, provider.model, { onProgress });

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        modelId: provider.model,
        bytesWritten: expect.any(Number),
        totalBytes: expect.any(Number),
      }),
    );
    expect(onProgress.mock.calls[onProgress.mock.calls.length - 1][0]).toEqual(
      expect.objectContaining({
        modelId: provider.model,
        fraction: 1,
      }),
    );
  });

  it('re-downloads an undersized existing model file before marking it installed', async () => {
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;

    new (ExpoFileSystem as any).File(localPath).write('stale');
    (ExpoFileSystem as any).__setFileSize?.(localPath, 128);

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
    expect(new (ExpoFileSystem as any).File(localPath).size).toBe(catalogEntry?.sizeBytes || 0);
  });

  it('automatically retries transient Android download interruptions and resumes from retained partial data', async () => {
    setPlatformOs('android');
    jest.useFakeTimers();
    const restoreMathRandom = overrideMathRandom(0);

    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const onProgress = jest.fn();

    try {
      legacyFileSystemMock.__queueDownloadBehavior?.({
        error: new Error('network lost'),
        partialBytesBeforeError: 64_000_000,
        totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
        progressEvents: [64_000_000],
      });
      legacyFileSystemMock.__queueDownloadBehavior?.({
        error: new Error('network lost again'),
        partialBytesBeforeError: 128_000_000,
        totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
        progressEvents: [128_000_000],
      });

      const installPromise = installLocalLlmModel(provider, provider.model, { onProgress });
      await advanceDownloadRetryTimers(2_000);
      const installedProvider = await installPromise;

      expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(3);
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[0][4]).toBeUndefined();
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[1][4]).toBe('64000000');
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[2][4]).toBe('128000000');
      expect(onProgress.mock.calls.map((call) => call[0].bytesWritten)).toEqual(
        expect.arrayContaining([64_000_000, 128_000_000]),
      );
      expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
      expect(new (ExpoFileSystem as any).File(getTempModelPath(provider.model)).exists).toBe(false);
      expect(new (ExpoFileSystem as any).File(getTempModelStatePath(provider.model)).exists).toBe(
        false,
      );
    } finally {
      restoreMathRandom();
      jest.useRealTimers();
    }
  });

  it('preserves partial progress after repeated transient failures and resumes on a later retry', async () => {
    setPlatformOs('android');
    jest.useFakeTimers();
    const restoreMathRandom = overrideMathRandom(0);

    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const tempPath = getTempModelPath(provider.model);
    const tempStatePath = getTempModelStatePath(provider.model);
    const retainedBytes = 640_000_000;
    const originalStackTraceLimit = Error.stackTraceLimit;

    try {
      Error.stackTraceLimit = 0;

      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const partialBytes = 64_000_000 * attempt;
        legacyFileSystemMock.__queueDownloadBehavior?.({
          error: `network lost ${attempt}`,
          partialBytesBeforeError: partialBytes,
          totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
          progressEvents: [partialBytes],
        });
      }

      const installPromise = installLocalLlmModel(provider, provider.model);
      installPromise.catch(() => undefined);
      for (let retry = 0; retry < 9; retry += 1) {
        await advanceDownloadRetryTimers(1_000);
      }
      await expect(installPromise).rejects.toThrow(/repeated transient network interruptions/i);

      expect(new (ExpoFileSystem as any).File(tempPath).size).toBe(retainedBytes);
      expect(new (ExpoFileSystem as any).File(tempStatePath).exists).toBe(true);

      const installedProvider = await installLocalLlmModel(provider, provider.model);

      expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(11);
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[10][4]).toBe(
        String(retainedBytes),
      );
      expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
      expect(new (ExpoFileSystem as any).File(tempPath).exists).toBe(false);
      expect(new (ExpoFileSystem as any).File(tempStatePath).exists).toBe(false);
    } finally {
      Error.stackTraceLimit = originalStackTraceLimit;
      restoreMathRandom();
      jest.useRealTimers();
    }
  });

  it('falls back to a clean download when a resume response ignores the range request', async () => {
    setPlatformOs('android');

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const partialBytes = 32_000_000;
    const tempPath = getTempModelPath(provider.model);
    const tempStatePath = getTempModelStatePath(provider.model);

    new (ExpoFileSystem as any).File(tempPath).write('partial');
    (ExpoFileSystem as any).__setFileSize?.(tempPath, partialBytes);
    new (ExpoFileSystem as any).File(tempStatePath).write(
      JSON.stringify({
        modelId: provider.model,
        sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
        expectedSizeBytes: catalogEntry?.sizeBytes || null,
        updatedAt: Date.now(),
      }),
    );

    legacyFileSystemMock.__queueDownloadBehavior?.({
      status: 200,
      totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
      writeSize: catalogEntry?.sizeBytes,
    });
    legacyFileSystemMock.__queueDownloadBehavior?.({
      status: 200,
      totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
      writeSize: catalogEntry?.sizeBytes,
    });

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(2);
    expect(legacyFileSystemMock.createDownloadResumable.mock.calls[0][4]).toBe(
      String(partialBytes),
    );
    expect(legacyFileSystemMock.createDownloadResumable.mock.calls[1][4]).toBeUndefined();
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
    expect(new (ExpoFileSystem as any).File(tempPath).exists).toBe(false);
    expect(new (ExpoFileSystem as any).File(tempStatePath).exists).toBe(false);
  });

  it('falls back to a clean download after repeated resume retries make no progress', async () => {
    setPlatformOs('android');
    jest.useFakeTimers();
    const restoreMathRandom = overrideMathRandom(0);

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const partialBytes = 32_000_000;
    const tempPath = getTempModelPath(provider.model);
    const tempStatePath = getTempModelStatePath(provider.model);

    try {
      new (ExpoFileSystem as any).File(tempPath).write('partial');
      (ExpoFileSystem as any).__setFileSize?.(tempPath, partialBytes);
      new (ExpoFileSystem as any).File(tempStatePath).write(
        JSON.stringify({
          modelId: provider.model,
          sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
          expectedSizeBytes: catalogEntry?.sizeBytes || null,
          updatedAt: Date.now(),
        }),
      );

      legacyFileSystemMock.__queueDownloadBehavior?.({
        error: new Error('socket timeout'),
        partialBytesBeforeError: partialBytes,
        totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
        progressEvents: [partialBytes],
      });
      legacyFileSystemMock.__queueDownloadBehavior?.({
        error: new Error('socket timeout'),
        partialBytesBeforeError: partialBytes,
        totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
        progressEvents: [partialBytes],
      });

      const installPromise = installLocalLlmModel(provider, provider.model);
      await advanceDownloadRetryTimers(1_000);
      const installedProvider = await installPromise;

      expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(3);
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[0][4]).toBe(
        String(partialBytes),
      );
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[1][4]).toBe(
        String(partialBytes),
      );
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[2][4]).toBeUndefined();
      expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
      expect(new (ExpoFileSystem as any).File(tempPath).exists).toBe(false);
      expect(new (ExpoFileSystem as any).File(tempStatePath).exists).toBe(false);
    } finally {
      restoreMathRandom();
      jest.useRealTimers();
    }
  });
});
