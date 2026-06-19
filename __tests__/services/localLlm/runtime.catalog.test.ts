import * as ExpoFileSystem from 'expo-file-system';
import {
  createExplicitAndroidLocalProvider,
  flushLocalLlmWarmupWork,
  getExpectedAndroidLiteRtSafeContextCap,
  installLocalLlmRuntimeTestHarness,
  mockGetNativeLocalLlmAvailability,
  mockWarmupNativeLocalLlmEngine,
  sampleToolDefinition,
  setPlatform,
} from '../../fixtures/localLlm/runtimeTestHarness';
import {
  ON_DEVICE_PROVIDER_NAME,
  getLocalLlmCatalogEntriesForProvider,
  getLocalLlmCatalogEntry,
} from '../../../src/services/localLlm/catalog';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';
import {
  getSelectableLocalLlmModels,
  isLocalLlmModelInstalled,
} from '../../../src/services/localLlm/modelArtifacts';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';
import { warmupLocalLlmSession } from '../../../src/services/localLlm/warmupSession';

installLocalLlmRuntimeTestHarness();

describe('localLlm runtime catalog and warmup', () => {
  it('creates a default on-device provider with platform metadata', () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);

    expect(provider.kind).toBe('on-device');
    expect(provider.name).toBe(ON_DEVICE_PROVIDER_NAME);
    expect(provider.baseUrl).toBe('');
    expect(provider.apiKey).toBe('');
    expect(provider.local?.runtime).toBe(catalogEntry?.runtime);
    expect(provider.local?.backend).toBe('gpu');
    expect(provider.availableModels).toContain(provider.model);
  });

  it('exposes only unauthenticated Android model downloads in the on-device catalog', () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntries = getLocalLlmCatalogEntriesForProvider(provider);

    expect(catalogEntries.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'gemma-4-E2B-it',
        'gemma-4-E4B-it',
        'qwen-2.5-1.5b-instruct',
        'deepseek-r1-distill-qwen-1.5b',
      ]),
    );
    expect(catalogEntries.map((entry) => entry.id)).not.toEqual(
      expect.arrayContaining([
        'gemma-3n-E2B-it',
        'gemma-3n-E4B-it',
        'gemma-3-1b-it-litert',
      ]),
    );
    expect(catalogEntries).toHaveLength(4);
    expect(catalogEntries.every((entry) => entry.downloadUrl.startsWith('https://'))).toBe(true);
  });

  it('exposes public iOS LiteRT-LM models and defaults to the smallest general assistant model', () => {
    setPlatform('ios');
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntries = getLocalLlmCatalogEntriesForProvider(provider);

    expect(catalogEntries.map((entry) => entry.id)).toEqual([
      'qwen-2.5-1.5b-instruct',
      'deepseek-r1-distill-qwen-1.5b',
    ]);
    expect(provider.model).toBe('qwen-2.5-1.5b-instruct');
    expect(provider.local?.runtime).toBe('litert-lm');
    expect(provider.local?.backend).toBe('gpu');
    expect(catalogEntries.every((entry) => entry.runtime === 'litert-lm')).toBe(true);
    expect(catalogEntries.every((entry) => entry.fileName.endsWith('.litertlm'))).toBe(true);
  });

  it('carries Gallery-aligned runtime capability and update metadata', () => {
    const catalogEntry = getLocalLlmCatalogEntry('gemma-4-E2B-it');

    expect(catalogEntry).toEqual(
      expect.objectContaining({
        downloadRevision: '6e5c4f1e395deb959c494953478fa5cec4b8008f',
        maxContextLength: 32_000,
        defaultMaxTokens: 4_000,
        supportsAudioInput: true,
        supportsThinking: true,
        supportsSpeculativeDecoding: true,
      }),
    );
    expect(catalogEntry?.capabilities).toEqual(
      expect.objectContaining({
        vision: true,
        tools: true,
        fileInput: true,
      }),
    );
    expect(catalogEntry?.availableUpdates).toEqual([
      {
        fileName: 'gemma-4-E2B-it.litertlm',
        downloadRevision: '7fa1d78473894f7e736a21d920c3aa80f950c0db',
      },
    ]);
  });

  it('installs a model and marks it as selectable', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(installedProvider.local?.installedModels).toHaveLength(1);
    expect(installedProvider.local?.installedModels?.[0]).toEqual(
      expect.objectContaining({
        modelId: provider.model,
        localPath: expect.stringContaining(catalogEntry?.fileName || provider.model),
        repositoryId: catalogEntry?.repositoryId,
        downloadRevision: catalogEntry?.downloadRevision,
        sourceUrl: catalogEntry?.downloadUrl,
      }),
    );
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
    expect(getSelectableLocalLlmModels(installedProvider)).toEqual([provider.model]);
    expect(
      Object.keys((ExpoFileSystem as any).__getStore?.() || {}).some((entry) =>
        entry.endsWith('.download'),
      ),
    ).toBe(false);
  });

  it('does not warm the native engine during Android install', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');

    await installLocalLlmModel(provider, provider.model);
    await flushLocalLlmWarmupWork();

    expect(mockWarmupNativeLocalLlmEngine).not.toHaveBeenCalled();
  });

  it('keeps the GPU backend on borderline Android 12 devices without warming during install', async () => {
    setPlatform('android', 31);
    mockGetNativeLocalLlmAvailability.mockResolvedValue({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 7.2,
      lowMemoryDevice: false,
    });

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    await flushLocalLlmWarmupWork();

    expect(installedProvider.local?.backend).toBe('gpu');
    expect(mockWarmupNativeLocalLlmEngine).not.toHaveBeenCalled();
  });

  it('skips engine-only warmup on near-minimum Android LiteRT-LM devices', async () => {
    setPlatform('android', 34);
    mockGetNativeLocalLlmAvailability.mockResolvedValue({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 8,
      lowMemoryDevice: false,
    });

    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    mockWarmupNativeLocalLlmEngine.mockClear();

    await warmupLocalLlmSession(installedProvider, installedProvider.model);

    expect(mockWarmupNativeLocalLlmEngine).not.toHaveBeenCalled();
  });

  it('dedupes engine-only warmups even when callers pass different system prompts', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const catalogEntry = getLocalLlmCatalogEntry(installedProvider.model);
    mockWarmupNativeLocalLlmEngine.mockClear();

    await Promise.all([
      warmupLocalLlmSession(installedProvider, installedProvider.model, {
        systemPrompt: 'prime from settings',
      }),
      warmupLocalLlmSession(installedProvider, installedProvider.model, {
        systemPrompt: 'prime from chat',
      }),
    ]);

    expect(mockWarmupNativeLocalLlmEngine).toHaveBeenCalledTimes(1);
    const request = mockWarmupNativeLocalLlmEngine.mock.calls[0]?.[0];
    expect(request).toBeTruthy();
    expect(request).not.toHaveProperty('systemPrompt');
    expect(request).not.toHaveProperty('tools');
    expect(request).toEqual(
      expect.objectContaining({
        topK: catalogEntry?.defaultTopK,
        topP: catalogEntry?.defaultTopP,
        temperature: catalogEntry?.defaultTemperature,
      }),
    );
    expect(request.contextWindowTokens).toBeGreaterThan(catalogEntry?.defaultMaxTokens || 0);
    expect(request.contextWindowTokens).toBeLessThanOrEqual(
      getExpectedAndroidLiteRtSafeContextCap({
        deviceMemoryGb: 16,
        maxTokens: catalogEntry?.defaultMaxTokens || 1024,
        maxContextLength: catalogEntry?.maxContextLength ?? null,
      }),
    );
  });

  it('enables constrained decoding for conversation-scoped tool warmups', async () => {
    setPlatform('android', 34);
    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    mockWarmupNativeLocalLlmEngine.mockClear();

    await warmupLocalLlmSession(installedProvider, installedProvider.model, {
      conversationId: 'conv-tools',
      systemPrompt: 'Use tools when needed.',
      tools: [sampleToolDefinition],
    });

    expect(mockWarmupNativeLocalLlmEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-tools',
        tools: [expect.objectContaining({ name: 'lookup_weather' })],
        enableConstrainedDecoding: true,
      }),
    );
  });
});
