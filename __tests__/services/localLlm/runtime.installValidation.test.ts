import * as ExpoFileSystem from 'expo-file-system';
import {
  advanceDownloadRetryTimers,
  getExpectedAndroidLiteRtSafeContextCap,
  getTempModelPath,
  getTempModelStatePath,
  installLocalLlmRuntimeTestHarness,
  legacyFileSystemMock,
  mockGenerateWithNativeLocalLlm,
  overrideMathRandom,
  setPlatformOs,
} from '../../fixtures/localLlm/runtimeTestHarness';
import { getLocalLlmCatalogEntry } from '../../../src/services/localLlm/catalog';
import { sendLocalLlmMessage } from '../../../src/services/localLlm/generateSession';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';
import {
  getInvalidInstalledLocalLlmModels,
  isLocalLlmModelInstalled,
  resolveInstalledLocalLlmModelPath,
} from '../../../src/services/localLlm/modelArtifacts';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';

installLocalLlmRuntimeTestHarness();

describe('localLlm runtime install validation', () => {
  it('discards orphaned partial downloads without metadata before attempting resume', async () => {
    setPlatformOs('android');

    const provider = createDefaultLocalLlmProvider('local-provider');
    const tempPath = getTempModelPath(provider.model);

    new (ExpoFileSystem as any).File(tempPath).write('partial');
    (ExpoFileSystem as any).__setFileSize?.(tempPath, 16_000_000);

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(1);
    expect(legacyFileSystemMock.createDownloadResumable.mock.calls[0][4]).toBeUndefined();
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
  });

  it('discards stale partial download metadata before starting a fresh Android download', async () => {
    setPlatformOs('android');

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const partialBytes = 16_000_000;
    const tempPath = getTempModelPath(provider.model);
    const tempStatePath = getTempModelStatePath(provider.model);

    new (ExpoFileSystem as any).File(tempPath).write('partial');
    (ExpoFileSystem as any).__setFileSize?.(tempPath, partialBytes);
    new (ExpoFileSystem as any).File(tempStatePath).write(
      JSON.stringify({
        modelId: provider.model,
        sourceUrl: 'https://example.com/obsolete-model',
        expectedSizeBytes: catalogEntry?.sizeBytes || null,
        updatedAt: Date.now(),
      }),
    );

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(1);
    expect(legacyFileSystemMock.createDownloadResumable.mock.calls[0][4]).toBeUndefined();
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
    expect(new (ExpoFileSystem as any).File(tempPath).exists).toBe(false);
    expect(new (ExpoFileSystem as any).File(tempStatePath).exists).toBe(false);
  });

  it('clears a tainted partial after a transient HTTP error and retries from scratch', async () => {
    setPlatformOs('android');
    jest.useFakeTimers();
    const restoreMathRandom = overrideMathRandom(0);

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const partialBytes = 48_000_000;
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
        status: 503,
        totalBytesExpectedToWrite: catalogEntry?.sizeBytes,
        writeSize: partialBytes + 512,
      });

      const installPromise = installLocalLlmModel(provider, provider.model);
      await advanceDownloadRetryTimers(1_000);
      const installedProvider = await installPromise;

      expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(2);
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[0][4]).toBe(
        String(partialBytes),
      );
      expect(legacyFileSystemMock.createDownloadResumable.mock.calls[1][4]).toBeUndefined();
      expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
      expect(new (ExpoFileSystem as any).File(tempPath).exists).toBe(false);
      expect(new (ExpoFileSystem as any).File(tempStatePath).exists).toBe(false);
    } finally {
      restoreMathRandom();
      jest.useRealTimers();
    }
  });

  it('rejects undersized model files and passes native filesystem paths to the bridge', async () => {
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;

    new (ExpoFileSystem as any).File(localPath).write('downloaded');
    (ExpoFileSystem as any).__setFileSize?.(localPath, catalogEntry?.sizeBytes || 1);

    const installedProvider = {
      ...provider,
      local: {
        ...provider.local,
        installedModels: [
          {
            modelId: provider.model,
            fileName: catalogEntry?.fileName || provider.model,
            localPath,
            installedAt: 1,
            sizeBytes: catalogEntry?.sizeBytes || 1,
            sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
            repositoryId: catalogEntry?.repositoryId || 'example/model',
            downloadRevision: catalogEntry?.downloadRevision || 'main',
          },
        ],
      },
    };

    expect(
      await sendLocalLlmMessage(installedProvider, [{ role: 'user', content: 'Say hello' }] as any),
    ).toEqual({
      choices: [
        {
          message: {
            content: 'Local reply',
          },
        },
      ],
    });

    const expectedSampling =
      catalogEntry?.runtime === 'litert-lm'
        ? {
            topK: catalogEntry?.defaultTopK || 64,
            topP: catalogEntry?.defaultTopP || 0.95,
            temperature: catalogEntry?.defaultTemperature || 1,
          }
        : {};

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: expect.stringContaining(catalogEntry?.fileName || provider.model),
        maxTokens: catalogEntry?.defaultMaxTokens || 1024,
        contextWindowTokens: expect.any(Number),
        ...expectedSampling,
        minDeviceMemoryGb: catalogEntry?.minDeviceMemoryGb,
      }),
    );
    const request = mockGenerateWithNativeLocalLlm.mock.calls[0][0];
    expect(request.modelPath).not.toContain('file://');
    expect(request.modelPath).toMatch(/^\//);
    if (catalogEntry?.runtime === 'litert-lm') {
      expect(request.contextWindowTokens).toBeGreaterThan(catalogEntry.defaultMaxTokens || 0);
      expect(request.contextWindowTokens).toBeLessThanOrEqual(
        getExpectedAndroidLiteRtSafeContextCap({
          deviceMemoryGb: 16,
          maxTokens: catalogEntry.defaultMaxTokens || 1024,
          maxContextLength: catalogEntry.maxContextLength ?? null,
        }),
      );
    } else {
      expect(request.contextWindowTokens).toBeGreaterThanOrEqual(
        catalogEntry?.defaultMaxTokens || 1024,
      );
    }

    (ExpoFileSystem as any).__setFileSize?.(localPath, 64);
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(false);
    await expect(
      sendLocalLlmMessage(installedProvider, [{ role: 'user', content: 'Say hello again' }] as any),
    ).rejects.toThrow(/missing or invalid/);
  });

  it('rejects stale installed model revision metadata before native load', async () => {
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;

    new (ExpoFileSystem as any).File(localPath).write('downloaded');
    (ExpoFileSystem as any).__setFileSize?.(localPath, catalogEntry?.sizeBytes || 1);

    const staleProvider = {
      ...provider,
      local: {
        ...provider.local,
        installedModels: [
          {
            modelId: provider.model,
            fileName: catalogEntry?.fileName || provider.model,
            localPath,
            installedAt: 1,
            sizeBytes: catalogEntry?.sizeBytes || 1,
            sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
            repositoryId: catalogEntry?.repositoryId || 'example/model',
            downloadRevision: 'obsolete-revision',
          },
        ],
      },
    };

    expect(getInvalidInstalledLocalLlmModels(staleProvider)).toEqual([
      expect.objectContaining({ issue: 'revision_mismatch' }),
    ]);
    expect(isLocalLlmModelInstalled(staleProvider, provider.model)).toBe(false);
    expect(resolveInstalledLocalLlmModelPath(staleProvider, provider.model)).toBeNull();
    await expect(
      sendLocalLlmMessage(staleProvider, [{ role: 'user', content: 'Say hello' }] as any),
    ).rejects.toThrow(/missing or invalid/);
  });

  it('re-downloads before recording current metadata for stale or unmanaged artifacts', async () => {
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;

    new (ExpoFileSystem as any).File(localPath).write('stale-bytes');
    (ExpoFileSystem as any).__setFileSize?.(localPath, catalogEntry?.sizeBytes || 1);

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalledTimes(1);
    expect(installedProvider.local?.installedModels?.[0]).toEqual(
      expect.objectContaining({
        repositoryId: catalogEntry?.repositoryId,
        downloadRevision: catalogEntry?.downloadRevision,
        sourceUrl: catalogEntry?.downloadUrl,
      }),
    );
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
  });
});
