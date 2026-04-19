import * as ExpoFileSystem from 'expo-file-system';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  createDefaultLocalLlmProvider,
  formatLocalLlmRuntimeStatusLabel,
  getLocalLlmAvailability,
  getLocalLlmRuntimeStatus,
  getSelectableLocalLlmModels,
  installLocalLlmModel,
  isLocalLlmModelInstalled,
  sendLocalLlmMessage,
  streamLocalLlmMessage,
  warmupLocalLlmSession,
} from '../../../src/services/localLlm/runtime';
import {
  GEMMA_LOCAL_PROVIDER_NAME,
  getLocalLlmCatalogEntry,
} from '../../../src/services/localLlm/catalog';
import type { ToolDefinition } from '../../../src/types';

const mockGenerateWithNativeLocalLlm = jest.fn().mockResolvedValue({ text: 'Local reply' });
const mockCancelNativeLocalLlmRequest = jest.fn().mockResolvedValue(undefined);
const mockStreamWithNativeLocalLlm = jest.fn();
const mockGetNativeLocalLlmAvailability = jest.fn();
const mockWarmupNativeLocalLlmEngine = jest.fn().mockResolvedValue(undefined);
const legacyFileSystemMock = jest.requireMock('expo-file-system/legacy') as {
  createDownloadResumable: jest.Mock;
  __queueDownloadBehavior?: (behavior: {
    error?: Error | string;
    status?: number;
    totalBytesExpectedToWrite?: number;
    progressEvents?: number[];
    partialBytesBeforeError?: number;
    writeSize?: number;
  }) => void;
  __resetDownloadBehaviors?: () => void;
};
const originalPlatformOs = Platform.OS;
const originalPlatformVersion = Platform.Version;

function setPlatform(
  os: 'android' | 'ios',
  version: number | string = originalPlatformVersion as number | string,
) {
  (Platform as { OS: 'android' | 'ios' }).OS = os;
  (Platform as { Version: number | string }).Version = version;
}

function setPlatformOs(os: 'android' | 'ios') {
  setPlatform(os);
}

function getExpectedAndroidLiteRtSafeContextCap(params: {
  deviceMemoryGb: number | null;
  maxTokens: number;
  maxContextLength?: number | null;
}) {
  let tierCap = 6144;
  if (params.deviceMemoryGb != null) {
    if (params.deviceMemoryGb >= 14) {
      tierCap = 8192;
    } else if (params.deviceMemoryGb < 10) {
      tierCap = 4096;
    }
  }

  const minimumSafeCap = Math.ceil((params.maxTokens + 1024) / 1024) * 1024;
  const safeCap = Math.max(params.maxTokens, tierCap, minimumSafeCap);
  if (params.maxContextLength == null) {
    return safeCap;
  }

  return Math.max(params.maxTokens, Math.min(params.maxContextLength, safeCap));
}

function getTempModelPath(modelId: string): string {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  return `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || modelId}.download`;
}

function getTempModelStatePath(modelId: string): string {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  return `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || modelId}.download.json`;
}

const sampleToolDefinition: ToolDefinition = {
  name: 'lookup_weather',
  description: 'Look up the weather for a city.',
  input_schema: {
    type: 'object',
    properties: {
      city: { type: 'string' },
    },
    required: ['city'],
  },
};

async function advanceDownloadRetryTimers(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

function overrideMathRandom(value: number): () => void {
  const originalRandom = Math.random;
  (Math as { random: () => number }).random = () => value;
  return () => {
    (Math as { random: () => number }).random = originalRandom;
  };
}

async function flushLocalLlmWarmupWork() {
  await Promise.resolve();
  await Promise.resolve();
}

jest.mock('../../../src/services/localLlm/native', () => ({
  LOCAL_LLM_STREAM_EVENT: 'KaviLocalLlmStream',
  getNativeLocalLlmAvailability: (...args: any[]) => mockGetNativeLocalLlmAvailability(...args),
  warmupNativeLocalLlmEngine: (...args: any[]) => mockWarmupNativeLocalLlmEngine(...args),
  generateWithNativeLocalLlm: (...args: any[]) => mockGenerateWithNativeLocalLlm(...args),
  cancelNativeLocalLlmRequest: (...args: any[]) => mockCancelNativeLocalLlmRequest(...args),
  streamWithNativeLocalLlm: (...args: any[]) => mockStreamWithNativeLocalLlm(...args),
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

describe('localLlm runtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Device as { isDevice: boolean }).isDevice = true;
    mockGenerateWithNativeLocalLlm.mockReset();
    mockGenerateWithNativeLocalLlm.mockResolvedValue({ text: 'Local reply' });
    mockCancelNativeLocalLlmRequest.mockReset();
    mockCancelNativeLocalLlmRequest.mockResolvedValue(undefined);
    mockStreamWithNativeLocalLlm.mockReset();
    mockStreamWithNativeLocalLlm.mockImplementation(async function* () {
      return;
    });
    mockGetNativeLocalLlmAvailability.mockReset();
    mockGetNativeLocalLlmAvailability.mockImplementation(async () => ({
      available: true,
      linked: true,
      platform: Platform.OS,
      runtime: Platform.OS === 'android' ? 'litert-lm' : 'mediapipe-genai',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: Platform.OS === 'android' ? 16 : null,
      lowMemoryDevice: false,
    }));
    mockWarmupNativeLocalLlmEngine.mockReset();
    mockWarmupNativeLocalLlmEngine.mockResolvedValue(undefined);
    (ExpoFileSystem as any).__resetStore?.();
    legacyFileSystemMock.__resetDownloadBehaviors?.();
    setPlatform(originalPlatformOs as 'android' | 'ios');
  });

  afterEach(async () => {
    await flushLocalLlmWarmupWork();
  });

  afterAll(() => {
    setPlatform(originalPlatformOs as 'android' | 'ios');
  });

  it('creates a default on-device provider with platform metadata', () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);

    expect(provider.kind).toBe('on-device');
    expect(provider.name).toBe(GEMMA_LOCAL_PROVIDER_NAME);
    expect(provider.baseUrl).toBe('');
    expect(provider.apiKey).toBe('');
    expect(provider.local?.runtime).toBe(catalogEntry?.runtime);
    expect(provider.local?.backend).toBe('gpu');
    expect(provider.availableModels).toContain(provider.model);
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

    const provider = createDefaultLocalLlmProvider('local-provider');
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
        topK: 64,
        topP: 0.95,
        temperature: 1,
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
    const provider = createDefaultLocalLlmProvider('local-provider');
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

    const provider = createDefaultLocalLlmProvider('local-provider');
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    const onProgress = jest.fn();

    expect(provider.model).toMatch(/^gemma-4-/);

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

    const provider = createDefaultLocalLlmProvider('local-provider');
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

  it('routes installed-model prompts through the native generator', async () => {
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);

    const result = await sendLocalLlmMessage(installedProvider, [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Say hello' },
    ] as any);

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
        backend: installedProvider.local?.backend,
        prompt: expect.any(String),
        history: expect.any(Array),
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
    expect(result).toEqual({
      choices: [
        {
          message: {
            content: 'Local reply',
          },
        },
      ],
    });
  });

  it('applies request-level max token and temperature overrides to native generation', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);

    await sendLocalLlmMessage(
      installedProvider,
      [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Say hello' },
      ] as any,
      undefined,
      {
        conversationId: 'conv-budgeted-generate',
        maxTokens: 512,
        temperature: 0.2,
      },
    );

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-budgeted-generate',
        maxTokens: 512,
        topK: catalogEntry?.defaultTopK || 64,
        topP: catalogEntry?.defaultTopP || 0.95,
        temperature: 0.2,
      }),
    );
    expect(mockGenerateWithNativeLocalLlm.mock.calls[0][0].contextWindowTokens).toBeLessThan(
      (catalogEntry?.defaultMaxTokens || 1024) + 1024,
    );
  });

  it('enables constrained decoding for tool-bearing native generation', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'What is the weather in Paris?' }] as any,
      [sampleToolDefinition],
      { conversationId: 'conv-tools' },
    );

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-tools',
        tools: [expect.objectContaining({ name: 'lookup_weather' })],
        enableConstrainedDecoding: true,
      }),
    );
  });

  it('converts raw Gemma tool fences into structured tool calls when native generation misses them', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    mockGenerateWithNativeLocalLlm.mockResolvedValueOnce({
      text: '<|tool_call>call:lookup_weather{city:<|"|>Paris<|"|>}<tool_call|><|tool_response>',
    });

    const result = await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'What is the weather in Paris?' }] as any,
      [sampleToolDefinition],
      { conversationId: 'conv-tools-fallback-generate' },
    );

    expect(result.choices[0].message.content).toBe('');
    expect((result.choices[0].message as any).tool_calls).toEqual([
      {
        id: expect.stringMatching(/^local_.+_tool_0$/),
        type: 'function',
        function: {
          name: 'lookup_weather',
          arguments: '{"city":"Paris"}',
        },
      },
    ]);
  });

  it('enables constrained decoding for tool-bearing native streaming', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    mockStreamWithNativeLocalLlm.mockImplementationOnce(async function* () {
      yield { requestId: 'stream-tools', type: 'token', content: 'Tool reply' };
    });

    const events = [];
    for await (const event of streamLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'What is the weather in Paris?' }] as any,
      [sampleToolDefinition],
      { conversationId: 'conv-tools' },
    )) {
      events.push(event);
    }

    expect(mockStreamWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-tools',
        tools: [expect.objectContaining({ name: 'lookup_weather' })],
        enableConstrainedDecoding: true,
      }),
    );
    expect(events).toEqual([{ type: 'token', content: 'Tool reply' }, { type: 'done' }]);
  });

  it('suppresses raw Gemma tool fences during streaming and emits a fallback tool call at completion', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    mockStreamWithNativeLocalLlm.mockImplementationOnce(async function* () {
      yield { requestId: 'stream-tools-fallback', type: 'token', content: 'Working ' };
      yield { requestId: 'stream-tools-fallback', type: 'token', content: '<|to' };
      yield {
        requestId: 'stream-tools-fallback',
        type: 'token',
        content: 'ol_call>call:lookup_weather{city:<|"|>Paris',
      };
      yield {
        requestId: 'stream-tools-fallback',
        type: 'token',
        content: '<|"|>}<tool_call|><|tool_re',
      };
      yield { requestId: 'stream-tools-fallback', type: 'token', content: 'sponse>' };
    });

    const events = [];
    for await (const event of streamLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'What is the weather in Paris?' }] as any,
      [sampleToolDefinition],
      { conversationId: 'conv-tools-fallback-stream' },
    )) {
      events.push(event);
    }

    expect(events.filter((event: any) => event.type === 'token')).toEqual([
      { type: 'token', content: 'Working ' },
    ]);
    expect(events.find((event: any) => event.type === 'tool_call')).toEqual({
      type: 'tool_call',
      toolCall: expect.objectContaining({
        id: expect.stringMatching(/^local_.+_tool_0$/),
        name: 'lookup_weather',
        arguments: '{"city":"Paris"}',
      }),
    });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
    expect(JSON.stringify(events)).not.toContain('<|tool_call>');
    expect(JSON.stringify(events)).not.toContain('<|tool_response>');
  });

  it('applies request-level max token and temperature overrides to native streaming', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);

    mockStreamWithNativeLocalLlm.mockImplementationOnce(async function* () {
      yield { requestId: 'stream-budgeted', type: 'token', content: 'Hello' };
    });

    const events = [];
    for await (const event of streamLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'Say hello' }] as any,
      undefined,
      {
        conversationId: 'conv-budgeted-stream',
        maxTokens: 384,
        temperature: 0.3,
      },
    )) {
      events.push(event);
    }

    expect(mockStreamWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-budgeted-stream',
        maxTokens: 384,
        topK: catalogEntry?.defaultTopK || 64,
        topP: catalogEntry?.defaultTopP || 0.95,
        temperature: 0.3,
      }),
    );
    expect(events).toEqual([{ type: 'token', content: 'Hello' }, { type: 'done' }]);
  });

  it('updates runtime status from likely to observed after a native request completes', async () => {
    setPlatform('android', 34);
    mockGenerateWithNativeLocalLlm.mockResolvedValueOnce({
      text: 'Local reply',
      backend: 'gpu',
    });

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    const initialStatus = await getLocalLlmRuntimeStatus(installedProvider);
    expect(initialStatus).not.toBeNull();
    expect(formatLocalLlmRuntimeStatusLabel(initialStatus!)).toBe('Likely GPU');

    await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'Say hello' }] as any,
      undefined,
      { conversationId: 'conv-runtime-status' },
    );

    const updatedStatus = await getLocalLlmRuntimeStatus(installedProvider);
    expect(updatedStatus).not.toBeNull();
    expect(formatLocalLlmRuntimeStatusLabel(updatedStatus!)).toBe('Running on GPU');
    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-runtime-status',
      }),
    );
  });

  it('treats slightly under-reported 8 GB devices as warning-only for Gemma 4 E2B', async () => {
    setPlatform('android', 31);
    mockGetNativeLocalLlmAvailability.mockResolvedValueOnce({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 7.2,
      lowMemoryDevice: false,
    });

    await expect(getLocalLlmAvailability('gemma-4-E2B-it')).resolves.toEqual(
      expect.objectContaining({
        available: true,
        minDeviceMemoryGb: 8,
        recommendedMaxTokens: 2048,
        deviceMemoryGb: 7.2,
        warningReason: expect.stringContaining('output is capped to about 2048 tokens'),
      }),
    );
  });

  it('allows downloading Gemma 4 E2B on borderline 8 GB-class devices', async () => {
    setPlatform('android', 31);
    mockGetNativeLocalLlmAvailability.mockResolvedValueOnce({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 7.2,
      lowMemoryDevice: false,
    });

    const provider = {
      ...createDefaultLocalLlmProvider('local-provider'),
      model: 'gemma-4-E2B-it',
    };

    const installedProvider = await installLocalLlmModel(provider, provider.model);

    expect(legacyFileSystemMock.createDownloadResumable).toHaveBeenCalled();
    expect(isLocalLlmModelInstalled(installedProvider, provider.model)).toBe(true);
  });

  it('keeps the GPU backend on borderline Android 12 devices while constraining output tokens', async () => {
    setPlatform('android', 31);
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

    const provider = createDefaultLocalLlmProvider('local-provider');
    const legacyProvider = {
      ...provider,
      local: {
        ...provider.local,
        backend: 'cpu' as const,
      },
    };
    const installedProvider = await installLocalLlmModel(legacyProvider, legacyProvider.model);

    await sendLocalLlmMessage(installedProvider, [{ role: 'user', content: 'Say hello' }] as any);

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'gpu',
        maxTokens: 2048,
      }),
    );
    expect(mockGenerateWithNativeLocalLlm.mock.calls[0][0].contextWindowTokens).toBeLessThanOrEqual(
      getExpectedAndroidLiteRtSafeContextCap({
        deviceMemoryGb: 8,
        maxTokens: 2048,
        maxContextLength:
          getLocalLlmCatalogEntry(installedProvider.model)?.maxContextLength ?? null,
      }),
    );
  });

  it('keeps the GPU backend on roomier modern Android devices', async () => {
    setPlatform('android', 34);
    mockGetNativeLocalLlmAvailability.mockResolvedValue({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 12,
      lowMemoryDevice: false,
    });

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    await sendLocalLlmMessage(installedProvider, [{ role: 'user', content: 'Say hello' }] as any);

    expect(installedProvider.local?.backend).toBe('gpu');
    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'gpu',
      }),
    );
  });

  it('forces the CPU backend on Android emulators even when Gemma prefers GPU', async () => {
    setPlatform('android', 34);
    (Device as { isDevice: boolean }).isDevice = false;
    mockGetNativeLocalLlmAvailability.mockResolvedValue({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 12,
      lowMemoryDevice: false,
    });

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    await sendLocalLlmMessage(installedProvider, [{ role: 'user', content: 'Say hello' }] as any);

    expect(installedProvider.local?.backend).toBe('cpu');
    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'cpu',
      }),
    );
  });

  it('trims oversized local prompts from the start before they reach the native bridge', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const oversizedPrompt = `${'OLD_CONTEXT '.repeat(20_000)}KEEP_THIS_TAIL`;

    await expect(
      sendLocalLlmMessage(installedProvider, [{ role: 'user', content: oversizedPrompt }] as any),
    ).resolves.toEqual({
      choices: [
        {
          message: {
            content: 'Local reply',
          },
        },
      ],
    });

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalled();
    const request = mockGenerateWithNativeLocalLlm.mock.calls[0][0];
    expect(request.currentMessage.content).toContain('KEEP_THIS_TAIL');
    expect(request.currentMessage.content.startsWith('OLD_CONTEXT')).toBe(false);
  });

  it('drops oversized tool payloads and falls back to text-only local mode for first-turn agentic requests', async () => {
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

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const oversizedSystemPrompt = `${'AGENT_POLICY_BLOCK '.repeat(8_000)}LATEST_AGENT_RULES`;
    const oversizedTools: ToolDefinition[] = Array.from({ length: 8 }, (_, index) => ({
      name: `oversized_tool_${index}`,
      description: `Tool ${index} description. ${'Use this tool for highly specific workflow routing. '.repeat(80)}`,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 12 }, (__, propertyIndex) => [
            `field_${propertyIndex}`,
            {
              type: 'string',
              description: `Schema detail ${propertyIndex}. ${'Long parameter guidance. '.repeat(40)}`,
            },
          ]),
        ),
        required: Array.from({ length: 12 }, (__, propertyIndex) => `field_${propertyIndex}`),
      },
    }));

    await expect(
      sendLocalLlmMessage(
        installedProvider,
        [
          { role: 'system', content: oversizedSystemPrompt },
          { role: 'user', content: 'Summarize the latest request and continue.' },
        ] as any,
        oversizedTools,
        { conversationId: 'conv-agentic-budget' },
      ),
    ).resolves.toEqual({
      choices: [
        {
          message: {
            content: 'Local reply',
          },
        },
      ],
    });

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'conv-agentic-budget',
        currentMessage: expect.objectContaining({
          role: 'user',
        }),
      }),
    );
    const request = mockGenerateWithNativeLocalLlm.mock.calls[0][0];
    expect(request.tools).toBeUndefined();
    expect(request.enableConstrainedDecoding).toBeUndefined();
    expect(request.systemPrompt).toContain('Do not emit tool calls or tool fences');
    expect(request.systemPrompt).toContain('LATEST_AGENT_RULES');
  });

  it('exposes official Gemma 4 memory policy through model availability', async () => {
    setPlatform('android', 34);
    mockGetNativeLocalLlmAvailability.mockResolvedValueOnce({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 8,
      lowMemoryDevice: false,
    });

    await expect(getLocalLlmAvailability('gemma-4-E4B-it')).resolves.toEqual(
      expect.objectContaining({
        available: false,
        minDeviceMemoryGb: 12,
        recommendedMaxTokens: 2048,
        deviceMemoryGb: 8,
        reason: expect.stringContaining('Try Gemma 4 E2B instead'),
      }),
    );
  });

  it('refuses to download models on devices that do not meet the model memory requirement', async () => {
    setPlatform('android', 34);
    mockGetNativeLocalLlmAvailability.mockResolvedValueOnce({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      reason: null,
      supportsStreaming: true,
      deviceMemoryGb: 8,
      lowMemoryDevice: false,
    });

    const provider = {
      ...createDefaultLocalLlmProvider('local-provider'),
      model: 'gemma-4-E4B-it',
    };

    await expect(installLocalLlmModel(provider, provider.model)).rejects.toThrow(
      /Try Gemma 4 E2B instead/i,
    );
    expect(legacyFileSystemMock.createDownloadResumable).not.toHaveBeenCalled();
  });
});
