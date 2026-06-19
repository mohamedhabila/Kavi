import * as ExpoFileSystem from 'expo-file-system';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { clearObservedLocalLlmBackends } from '../../../src/services/localLlm/backendStatus';
import { getLocalLlmCatalogEntry } from '../../../src/services/localLlm/catalog';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';
import type { ToolDefinition } from '../../../src/types/tool';

export const mockGenerateWithNativeLocalLlm = jest.fn().mockResolvedValue({ text: 'Local reply' });
export const mockCancelNativeLocalLlmRequest = jest.fn().mockResolvedValue(undefined);
export const mockStreamWithNativeLocalLlm = jest.fn();
export const mockGetNativeLocalLlmAvailability = jest.fn();
export const mockWarmupNativeLocalLlmEngine = jest.fn().mockResolvedValue(undefined);

export const legacyFileSystemMock = jest.requireMock('expo-file-system/legacy') as {
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

export function setPlatform(
  os: 'android' | 'ios',
  version: number | string = originalPlatformVersion as number | string,
) {
  (Platform as { OS: 'android' | 'ios' }).OS = os;
  (Platform as { Version: number | string }).Version = version;
}

export function setPlatformOs(os: 'android' | 'ios') {
  setPlatform(os);
}

export function getExpectedAndroidLiteRtSafeContextCap(params: {
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

export function getTempModelPath(modelId: string): string {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  return `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || modelId}.download`;
}

export function getTempModelStatePath(modelId: string): string {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  return `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || modelId}.download.json`;
}

export function createExplicitAndroidLocalProvider(
  modelId: string = 'gemma-4-E2B-it',
  id: string = 'local-provider',
) {
  const provider = createDefaultLocalLlmProvider(id);
  const catalogEntry = getLocalLlmCatalogEntry(modelId);

  return {
    ...provider,
    model: modelId,
    local: {
      ...provider.local,
      runtime: catalogEntry?.runtime || provider.local?.runtime,
    },
  };
}

export const sampleToolDefinition: ToolDefinition = {
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

export async function advanceDownloadRetryTimers(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

export function overrideMathRandom(value: number): () => void {
  const originalRandom = Math.random;
  (Math as { random: () => number }).random = () => value;
  return () => {
    (Math as { random: () => number }).random = originalRandom;
  };
}

export async function flushLocalLlmWarmupWork() {
  await Promise.resolve();
  await Promise.resolve();
}

export function installLocalLlmRuntimeTestHarness() {
  beforeEach(() => {
    jest.clearAllMocks();
    clearObservedLocalLlmBackends();
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
      runtime: 'litert-lm',
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
