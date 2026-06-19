describe('localLlm acceleration metadata', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('react-native');
    jest.clearAllMocks();
  });

  function mockAndroidPlatform() {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'android' },
    }));
  }

  function mockIosPlatform() {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
    }));
  }

  it('marks only Gallery allowlisted Gemma 4 models as speculative-decoding capable metadata', () => {
    jest.resetModules();
    mockAndroidPlatform();

    const { getLocalLlmCatalogEntry } = require('../../../src/services/localLlm/catalog');

    expect(getLocalLlmCatalogEntry('gemma-4-E2B-it')?.supportsSpeculativeDecoding).toBe(true);
    expect(getLocalLlmCatalogEntry('gemma-4-E4B-it')?.supportsSpeculativeDecoding).toBe(true);
    expect(getLocalLlmCatalogEntry('qwen-2.5-1.5b-instruct')?.supportsSpeculativeDecoding)
      .toBeUndefined();
    expect(getLocalLlmCatalogEntry('deepseek-r1-distill-qwen-1.5b')?.supportsSpeculativeDecoding)
      .toBeUndefined();
  });

  it('keeps Gallery-aligned multimodal accelerator metadata in execution policy', () => {
    jest.resetModules();
    mockAndroidPlatform();

    const { getLocalLlmExecutionPolicy } = require('../../../src/services/localLlm/executionPolicy');

    expect(getLocalLlmExecutionPolicy('gemma-4-E2B-it')).toEqual(
      expect.objectContaining({
        defaultVisionAccelerator: 'gpu',
        defaultAudioAccelerator: 'cpu',
      }),
    );
    expect(getLocalLlmExecutionPolicy('qwen-2.5-1.5b-instruct')).toEqual(
      expect.objectContaining({
        defaultVisionAccelerator: null,
        defaultAudioAccelerator: null,
      }),
    );
  });

  it('normalizes auxiliary accelerators after CPU fallback', () => {
    jest.resetModules();
    mockAndroidPlatform();

    const {
      resolveLocalLlmAuxiliaryAccelerator,
    } = require('../../../src/services/localLlm/backendPolicy');

    expect(resolveLocalLlmAuxiliaryAccelerator('gpu', 'gpu')).toBe('gpu');
    expect(resolveLocalLlmAuxiliaryAccelerator('npu', 'gpu')).toBe('gpu');
    expect(resolveLocalLlmAuxiliaryAccelerator('cpu', 'gpu')).toBe('cpu');
    expect(resolveLocalLlmAuxiliaryAccelerator('gpu', null)).toBeUndefined();
  });

  it('passes multimodal accelerator defaults into native local requests', async () => {
    jest.resetModules();
    mockAndroidPlatform();

    const generateWithNativeLocalLlm = jest.fn().mockResolvedValue({
      text: 'ok',
      backend: 'gpu',
    });
    jest.doMock('../../../src/services/localLlm/native', () => ({
      generateWithNativeLocalLlm,
    }));
    jest.doMock('../../../src/services/localLlm/availability', () => ({
      ensureLocalLlmModelCanRun: jest.fn().mockResolvedValue({
        available: true,
        deviceMemoryGb: 16,
      }),
    }));
    jest.doMock('../../../src/services/localLlm/modelArtifacts', () => ({
      getNativeLocalLlmModelPath: (modelPath: string) => modelPath,
      resolveInstalledLocalLlmModelPath: jest.fn(() => '/models/gemma-4-E2B-it.litertlm'),
      normalizeInstalledModels: jest.fn(() => []),
    }));

    const { sendLocalLlmMessage } = require('../../../src/services/localLlm/generateSession');

    await sendLocalLlmMessage(
      {
        id: 'local',
        kind: 'on-device',
        name: 'On Device',
        baseUrl: '',
        apiKey: '',
        model: 'gemma-4-E2B-it',
        enabled: true,
        local: {
          runtime: 'litert-lm',
          backend: 'gpu',
        },
      },
      [{ role: 'user', content: 'hello' }],
    );

    expect(generateWithNativeLocalLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'gpu',
        visionBackend: 'gpu',
        audioBackend: 'cpu',
      }),
    );
  });

  it('surfaces native acceleration telemetry through runtime status', async () => {
    jest.resetModules();
    mockAndroidPlatform();
    jest.doMock('../../../src/services/localLlm/native', () => ({
      getNativeLocalLlmAvailability: jest.fn().mockResolvedValue({
        available: true,
        linked: true,
        platform: 'android',
        runtime: 'litert-lm',
        reason: null,
        supportsStreaming: true,
        deviceMemoryGb: 16,
        lowMemoryDevice: false,
        accelerationFeatures: {
          constrainedDecodingEnabled: true,
          speculativeDecodingSupported: true,
          speculativeDecodingEnabled: true,
          capabilityCheckFailureCount: 0,
        },
        supportedAccelerators: ['cpu', 'gpu', 'npu', 'tpu'],
      }),
    }));

    const { createDefaultLocalLlmProvider } = require('../../../src/services/localLlm/provider');
    const { getLocalLlmRuntimeStatus } = require('../../../src/services/localLlm/status');

    await expect(getLocalLlmRuntimeStatus(createDefaultLocalLlmProvider('local-provider')))
      .resolves.toEqual(
        expect.objectContaining({
          accelerationFeatures: expect.objectContaining({
            constrainedDecodingEnabled: true,
            speculativeDecodingSupported: true,
            speculativeDecodingEnabled: true,
          }),
          supportedAccelerators: ['cpu', 'gpu', 'npu', 'tpu'],
        }),
      );
  });

  it('formats observed fallback labels for any requested accelerator', () => {
    jest.resetModules();
    mockAndroidPlatform();

    const { formatLocalLlmRuntimeStatusLabel } = require('../../../src/services/localLlm/status');

    expect(
      formatLocalLlmRuntimeStatusLabel({
        runtime: 'litert-lm',
        requestedBackend: 'npu',
        resolvedBackend: 'npu',
        resolvedBackendReason: 'configured',
        observedBackend: 'cpu',
        activeBackend: 'cpu',
        backendSource: 'observed',
        fellBackFromRequestedBackend: true,
      }),
    ).toBe('Running on CPU (NPU fallback)');
  });

  it('falls back to the catalog accelerator when a configured accelerator is unsupported', () => {
    jest.resetModules();
    mockIosPlatform();

    const {
      resolveLocalLlmAcceleratorAnalysis,
    } = require('../../../src/services/localLlm/backendPolicy');

    expect(
      resolveLocalLlmAcceleratorAnalysis(
        {
          model: 'qwen-2.5-1.5b-instruct',
          local: {
            runtime: 'litert-lm',
            backend: 'npu',
          },
        },
        'qwen-2.5-1.5b-instruct',
      ),
    ).toEqual({
      backend: 'gpu',
      reason: 'default',
    });
  });
});
