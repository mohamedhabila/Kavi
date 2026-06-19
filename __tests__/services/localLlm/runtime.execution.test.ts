import {
  getExpectedAndroidLiteRtSafeContextCap,
  installLocalLlmRuntimeTestHarness,
  mockGenerateWithNativeLocalLlm,
  mockStreamWithNativeLocalLlm,
  setPlatform,
} from '../../fixtures/localLlm/runtimeTestHarness';
import { getLocalLlmCatalogEntry } from '../../../src/services/localLlm/catalog';
import { sendLocalLlmMessage } from '../../../src/services/localLlm/generateSession';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';
import { createDefaultLocalLlmProvider } from '../../../src/services/localLlm/provider';
import { streamLocalLlmMessage } from '../../../src/services/localLlm/streamSession';
import {
  formatLocalLlmRuntimeStatusLabel,
  getLocalLlmRuntimeStatus,
} from '../../../src/services/localLlm/status';

installLocalLlmRuntimeTestHarness();

describe('localLlm runtime execution', () => {
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
        estimatedInputTokens: expect.any(Number),
        contextCompactionState: 'full',
        ...expectedSampling,
        minDeviceMemoryGb: catalogEntry?.minDeviceMemoryGb,
      }),
    );
    const request = mockGenerateWithNativeLocalLlm.mock.calls[0][0];
    expect(request).toHaveProperty('inputBudgetTokens');
    expect(request).toHaveProperty('contextPressureRatio');
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
    expect(mockGenerateWithNativeLocalLlm.mock.calls[0][0].contextWindowTokens).toBeLessThanOrEqual(
      (catalogEntry?.defaultMaxTokens || 1024) + 1024,
    );
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

  it('expands the Android context window only after stable GPU execution is observed', async () => {
    setPlatform('android', 34);
    mockGenerateWithNativeLocalLlm
      .mockResolvedValueOnce({
        text: 'Observed reply',
        backend: 'gpu',
      })
      .mockResolvedValueOnce({
        text: 'Expanded reply',
        backend: 'gpu',
      });

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'First turn observes the backend.' }] as any,
      undefined,
      { conversationId: 'conv-adaptive-context-1' },
    );

    await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'stable-context '.repeat(3_000) }] as any,
      undefined,
      { conversationId: 'conv-adaptive-context-2' },
    );

    expect(mockGenerateWithNativeLocalLlm.mock.calls[0][0].contextWindowTokens).toBeLessThanOrEqual(
      8192,
    );
    expect(mockGenerateWithNativeLocalLlm.mock.calls[1][0].contextWindowTokens).toBeGreaterThan(
      8192,
    );
  });

  it('reuses an observed CPU fallback backend on later requests instead of retrying GPU every turn', async () => {
    setPlatform('android', 34);
    mockGenerateWithNativeLocalLlm
      .mockResolvedValueOnce({
        text: 'Fallback reply',
        backend: 'cpu',
      })
      .mockResolvedValueOnce({
        text: 'Stable reply',
        backend: 'cpu',
      });

    const provider = createDefaultLocalLlmProvider('local-provider');
    const installedProvider = await installLocalLlmModel(provider, provider.model);

    await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'First turn' }] as any,
      undefined,
      { conversationId: 'conv-cpu-fallback-1' },
    );

    await sendLocalLlmMessage(
      installedProvider,
      [{ role: 'user', content: 'Second turn' }] as any,
      undefined,
      { conversationId: 'conv-cpu-fallback-2' },
    );

    expect(mockGenerateWithNativeLocalLlm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        backend: 'gpu',
      }),
    );
    expect(mockGenerateWithNativeLocalLlm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        backend: 'cpu',
      }),
    );

    const updatedStatus = await getLocalLlmRuntimeStatus(installedProvider);
    expect(updatedStatus).not.toBeNull();
    expect(formatLocalLlmRuntimeStatusLabel(updatedStatus!)).toBe('Running on CPU (GPU fallback)');
  });
});
