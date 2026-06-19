import * as Device from 'expo-device';
import {
  createExplicitAndroidLocalProvider,
  getExpectedAndroidLiteRtSafeContextCap,
  installLocalLlmRuntimeTestHarness,
  legacyFileSystemMock,
  mockGenerateWithNativeLocalLlm,
  mockGetNativeLocalLlmAvailability,
  setPlatform,
} from '../../fixtures/localLlm/runtimeTestHarness';
import { getLocalLlmAvailability } from '../../../src/services/localLlm/availability';
import { getLocalLlmCatalogEntry } from '../../../src/services/localLlm/catalog';
import { sendLocalLlmMessage } from '../../../src/services/localLlm/generateSession';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';
import { isLocalLlmModelInstalled } from '../../../src/services/localLlm/modelArtifacts';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';
import type { ToolDefinition } from '../../../src/types/tool';

installLocalLlmRuntimeTestHarness();

describe('localLlm runtime policy', () => {
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

  it('preserves an explicit CPU backend while constraining output tokens', async () => {
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

    const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
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
        backend: 'cpu',
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

  it('keeps the GPU backend on Android emulators and lets native fallback handle failures', async () => {
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

    expect(installedProvider.local?.backend).toBe('gpu');
    expect(mockGenerateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'gpu',
      }),
    );
  });

  it('surfaces oversized local prompts as context pressure before native generation', async () => {
    setPlatform('android', 34);
    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);
    const oversizedPrompt = `${'OLD_CONTEXT '.repeat(20_000)}KEEP_THIS_TAIL`;

    await expect(
      sendLocalLlmMessage(installedProvider, [{ role: 'user', content: oversizedPrompt }] as any),
    ).rejects.toMatchObject({
      code: 'LOCAL_LLM_CONTEXT_PRESSURE',
      reason: 'current_message_exceeds_budget',
    });
    expect(mockGenerateWithNativeLocalLlm).not.toHaveBeenCalled();
  });

  it('surfaces oversized tool payloads as context pressure before native generation', async () => {
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
          { role: 'system', content: 'Use structured tools when they are available.' },
          { role: 'user', content: 'Summarize the latest request and continue.' },
        ] as any,
        oversizedTools,
        { conversationId: 'conv-agentic-budget' },
      ),
    ).rejects.toMatchObject({
      code: 'LOCAL_LLM_CONTEXT_PRESSURE',
      reason: 'tool_payload_exceeds_budget',
    });
    expect(mockGenerateWithNativeLocalLlm).not.toHaveBeenCalled();
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
