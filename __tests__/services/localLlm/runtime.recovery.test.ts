import * as ExpoFileSystem from 'expo-file-system';

import {
  installLocalLlmRuntimeTestHarness,
  setPlatformOs,
} from '../../fixtures/localLlm/runtimeTestHarness';
import {
  clearLocalLlmRuntimeActivity,
  rememberLocalLlmRuntimeActivity,
} from '../../../src/services/localLlm/backendStatus';
import { getLocalLlmCatalogEntry } from '../../../src/services/localLlm/catalog';
import {
  clearLocalLlmInstalledModel,
  getInvalidInstalledLocalLlmModels,
  getLocalLlmModelFile,
  getLocalLlmModelPartialDownloadStateFile,
  getLocalLlmModelTempFile,
} from '../../../src/services/localLlm/modelArtifacts';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';
import { getLocalLlmRuntimeStatus } from '../../../src/services/localLlm/status';

installLocalLlmRuntimeTestHarness();

describe('localLlm recovery', () => {
  it('clears invalid installed artifacts and partial download files explicitly', () => {
    setPlatformOs('android');

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const modelFile = getLocalLlmModelFile(provider.model);
    const tempFile = getLocalLlmModelTempFile(provider.model);
    const tempStateFile = getLocalLlmModelPartialDownloadStateFile(provider.model);

    modelFile.write('stale');
    tempFile.write('partial');
    tempStateFile.write('{}');
    (ExpoFileSystem as any).__setFileSize?.(modelFile.uri, catalogEntry?.sizeBytes || 1);

    const providerWithStaleInstall = {
      ...provider,
      local: {
        ...provider.local,
        installedModels: [
          {
            modelId: provider.model,
            fileName: catalogEntry?.fileName || provider.model,
            localPath: modelFile.uri,
            installedAt: 1,
            sizeBytes: catalogEntry?.sizeBytes || 1,
            sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
            repositoryId: catalogEntry?.repositoryId,
            downloadRevision: 'obsolete-revision',
          },
        ],
      },
    };

    expect(getInvalidInstalledLocalLlmModels(providerWithStaleInstall)).toEqual([
      expect.objectContaining({ issue: 'revision_mismatch' }),
    ]);

    const cleanedProvider = clearLocalLlmInstalledModel(providerWithStaleInstall, provider.model);

    expect(cleanedProvider.local?.installedModels).toEqual([]);
    expect(new (ExpoFileSystem as any).File(modelFile.uri).exists).toBe(false);
    expect(new (ExpoFileSystem as any).File(tempFile.uri).exists).toBe(false);
    expect(new (ExpoFileSystem as any).File(tempStateFile.uri).exists).toBe(false);
  });

  it('surfaces runtime activity through provider runtime status', async () => {
    setPlatformOs('android');

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const modelFile = getLocalLlmModelFile(provider.model);
    modelFile.write('downloaded');
    (ExpoFileSystem as any).__setFileSize?.(modelFile.uri, catalogEntry?.sizeBytes || 1);

    const installedProvider = {
      ...provider,
      local: {
        ...provider.local,
        installedModels: [
          {
            modelId: provider.model,
            fileName: catalogEntry?.fileName || provider.model,
            localPath: modelFile.uri,
            installedAt: 1,
            sizeBytes: catalogEntry?.sizeBytes || 1,
            sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
            repositoryId: catalogEntry?.repositoryId,
            downloadRevision: catalogEntry?.downloadRevision,
          },
        ],
      },
    };

    rememberLocalLlmRuntimeActivity(modelFile.uri, 'warming');

    await expect(getLocalLlmRuntimeStatus(installedProvider)).resolves.toEqual(
      expect.objectContaining({ activity: 'warming' }),
    );

    clearLocalLlmRuntimeActivity(modelFile.uri, 'warming');

    await expect(getLocalLlmRuntimeStatus(installedProvider)).resolves.not.toHaveProperty(
      'activity',
    );
  });
});
