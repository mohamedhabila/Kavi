import * as ExpoFileSystem from 'expo-file-system';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { clearObservedLocalLlmBackends } from '../../../src/services/localLlm/backendStatus';
import {
  getLocalLlmCatalogEntry,
} from '../../../src/services/localLlm/catalog';
import { sendLocalLlmMessage } from '../../../src/services/localLlm/generateSession';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';
import { streamLocalLlmMessage } from '../../../src/services/localLlm/streamSession';
import type { ToolDefinition } from '../../../src/types/tool';

const mockGenerateWithNativeLocalLlm = jest.fn().mockResolvedValue({ text: 'Local reply' });
const mockCancelNativeLocalLlmRequest = jest.fn().mockResolvedValue(undefined);
const mockStreamWithNativeLocalLlm = jest.fn();
const mockGetNativeLocalLlmAvailability = jest.fn();
const mockWarmupNativeLocalLlmEngine = jest.fn().mockResolvedValue(undefined);
const legacyFileSystemMock = jest.requireMock('expo-file-system/legacy') as {
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

function createExplicitAndroidLocalProvider(
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

describe('localLlm tool calls', () => {
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

  it('enables constrained decoding for tool-bearing native generation', async () => {
    setPlatform('android', 34);
    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
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

  it('surfaces native structured tool calls for non-streaming local generation', async () => {
    setPlatform('android', 34);
    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    mockGenerateWithNativeLocalLlm.mockResolvedValueOnce({
      text: '',
      toolCalls: [
        {
          id: 'native-tool-1',
          name: 'lookup_weather',
          arguments: { city: 'Paris' },
        },
      ],
    });

    const result = await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'What is the weather in Paris?' }] as any,
      [sampleToolDefinition],
      { conversationId: 'conv-tools-native-generate' },
    );

    expect(result.choices[0].message.content).toBe('');
    expect((result.choices[0].message as any).tool_calls).toEqual([
      {
        id: 'native-tool-1',
        type: 'function',
        function: {
          name: 'lookup_weather',
          arguments: '{"city":"Paris"}',
        },
      },
    ]);
  });

  it('does not synthesize local tool calls from raw model fence text', async () => {
    setPlatform('android', 34);
    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const rawFence = '<|tool_call>call:lookup_weather{city:<|"|>Paris<|"|>}<tool_call|>';

    mockGenerateWithNativeLocalLlm.mockResolvedValueOnce({ text: rawFence });

    const result = await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'What is the weather in Paris?' }] as any,
      [sampleToolDefinition],
      { conversationId: 'conv-tools-no-fallback-generate' },
    );

    expect(result.choices[0].message.content).toBe(rawFence);
    expect((result.choices[0].message as any).tool_calls).toBeUndefined();
  });

  it('enables constrained decoding for tool-bearing native streaming', async () => {
    setPlatform('android', 34);
    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    mockStreamWithNativeLocalLlm.mockImplementationOnce(async function* () {
      yield { requestId: 'stream-tools', type: 'token', content: 'Tool reply' };
      yield {
        requestId: 'stream-tools',
        type: 'tool_call',
        toolCall: {
          id: 'native-stream-tool-1',
          name: 'lookup_weather',
          arguments: { city: 'Paris' },
        },
      };
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
    expect(events).toEqual([
      { type: 'token', content: 'Tool reply' },
      {
        type: 'tool_call',
        toolCall: {
          id: 'native-stream-tool-1',
          name: 'lookup_weather',
          arguments: '{"city":"Paris"}',
        },
      },
      { type: 'done' },
    ]);
  });

  it('streams raw model fence text without converting it into synthetic tool calls', async () => {
    setPlatform('android', 34);
    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
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
      { conversationId: 'conv-tools-no-fallback-stream' },
    )) {
      events.push(event);
    }

    expect(events.filter((event: any) => event.type === 'token')).toEqual([
      { type: 'token', content: 'Working ' },
      { type: 'token', content: '<|to' },
      { type: 'token', content: 'ol_call>call:lookup_weather{city:<|"|>Paris' },
      { type: 'token', content: '<|"|>}<tool_call|><|tool_re' },
      { type: 'token', content: 'sponse>' },
    ]);
    expect(events.find((event: any) => event.type === 'tool_call')).toBeUndefined();
    expect(events[events.length - 1]).toEqual({ type: 'done' });
    const streamedText = events
      .filter((event: any) => event.type === 'token')
      .map((event: any) => event.content)
      .join('');
    expect(streamedText).toContain('<|tool_call>');
    expect(streamedText).toContain('<|tool_response>');
  });
});
