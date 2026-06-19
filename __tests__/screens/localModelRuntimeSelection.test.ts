import { File } from 'expo-file-system';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';
import {
  getActiveInstalledLocalModel,
  getActiveLocalModelKey,
} from '../../src/screens/localModelRuntimeSelection';
import type { LlmProviderConfig } from '../../src/types/provider';

function createProviderWithInstalledModel(downloadRevision: string): LlmProviderConfig {
  const modelId = 'gemma-4-E2B-it';
  const catalogEntry = getLocalLlmCatalogEntry(modelId)!;
  const localPath = `file:///mock/documents/local-llm/models/${catalogEntry.fileName}`;
  new File(localPath).write('downloaded');
  (jest.requireMock('expo-file-system') as any).__setFileSize?.(
    localPath,
    catalogEntry.sizeBytes,
  );

  return {
    id: 'local',
    kind: 'on-device',
    name: 'On-device',
    baseUrl: '',
    apiKey: '',
    model: modelId,
    enabled: true,
    local: {
      runtime: catalogEntry.runtime,
      backend: 'gpu',
      installedModels: [
        {
          modelId,
          fileName: catalogEntry.fileName,
          localPath,
          installedAt: 1,
          sizeBytes: catalogEntry.sizeBytes,
          sourceUrl: catalogEntry.downloadUrl,
          repositoryId: catalogEntry.repositoryId,
          downloadRevision,
        },
      ],
    },
  };
}

describe('localModelRuntimeSelection', () => {
  beforeEach(() => {
    (jest.requireMock('expo-file-system') as any).__resetStore?.();
  });

  it('uses only catalog-validated installed local models for runtime keys', () => {
    const catalogEntry = getLocalLlmCatalogEntry('gemma-4-E2B-it')!;
    const provider = createProviderWithInstalledModel(catalogEntry.downloadRevision);

    const installed = getActiveInstalledLocalModel(provider, provider.model);

    expect(installed?.downloadRevision).toBe(catalogEntry.downloadRevision);
    expect(
      getActiveLocalModelKey({
        activeInstalledLocalModel: installed,
        activeProvider: provider,
        currentModel: provider.model,
      }),
    ).toContain(`${provider.model}::gpu`);
  });

  it('ignores stale installed local model metadata', () => {
    const provider = createProviderWithInstalledModel('obsolete-revision');

    expect(getActiveInstalledLocalModel(provider, provider.model)).toBeNull();
  });
});
