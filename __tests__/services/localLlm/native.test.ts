describe('localLlm native bridge', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('react-native');
    jest.clearAllMocks();
  });

  function loadNativeModule(options?: {
    platform?: 'android' | 'ios';
    nativeModule?: Record<string, any>;
  }) {
    jest.resetModules();

    let listener: ((event: any) => void) | undefined;
    const subscription = { remove: jest.fn() };
    const addListener = jest.fn((_eventName: string, callback: (event: any) => void) => {
      listener = callback;
      return subscription;
    });
    const NativeEventEmitter = jest.fn().mockImplementation(() => ({ addListener }));

    jest.doMock('react-native', () => ({
      DeviceEventEmitter: { addListener },
      NativeEventEmitter,
      NativeModules: options?.nativeModule ? { KaviLocalLlm: options.nativeModule } : {},
      Platform: { OS: options?.platform ?? 'android' },
    }));

    const mod = require('../../../src/services/localLlm/native');
    return {
      mod,
      addListener,
      NativeEventEmitter,
      subscription,
      emit: (event: any) => listener?.(event),
    };
  }

  it('reports whether the native module is linked', () => {
    expect(loadNativeModule().mod.isNativeLocalLlmLinked()).toBe(false);
    expect(
      loadNativeModule({
        nativeModule: { getAvailability: jest.fn() },
      }).mod.isNativeLocalLlmLinked(),
    ).toBe(true);
  });

  it('returns platform-specific fallback availability when the bridge is missing', async () => {
    await expect(loadNativeModule().mod.getNativeLocalLlmAvailability()).resolves.toEqual(
      expect.objectContaining({
        available: false,
        linked: false,
        platform: 'android',
        runtime: 'litert-lm',
        supportsStreaming: false,
        lowMemoryDevice: false,
      }),
    );

    await expect(
      loadNativeModule({ platform: 'ios' }).mod.getNativeLocalLlmAvailability(),
    ).resolves.toEqual(
      expect.objectContaining({
        available: false,
        linked: false,
        platform: 'ios',
        runtime: 'mediapipe-genai',
        supportsStreaming: false,
        lowMemoryDevice: false,
      }),
    );
  });

  it('delegates availability and generation to the native module when linked', async () => {
    const nativeModule = {
      getAvailability: jest.fn().mockResolvedValue({ available: true, linked: true }),
      generate: jest.fn().mockResolvedValue({ text: 'native reply' }),
    };
    const { mod } = loadNativeModule({ nativeModule });

    await expect(mod.getNativeLocalLlmAvailability()).resolves.toEqual({
      available: true,
      linked: true,
    });
    await expect(
      mod.generateWithNativeLocalLlm({
        requestId: 'req-1',
        conversationKey: 'conv-1',
        modelPath: '/model.gguf',
        prompt: 'Hello',
        maxTokens: 4000,
        contextWindowTokens: 32000,
        topK: 64,
        topP: 0.95,
        temperature: 1,
        enableConstrainedDecoding: true,
      }),
    ).resolves.toEqual({ text: 'native reply' });
    expect(nativeModule.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        conversationKey: 'conv-1',
        contextWindowTokens: 32000,
        topK: 64,
        topP: 0.95,
        temperature: 1,
        enableConstrainedDecoding: true,
      }),
    );
  });

  it('delegates warmup to the native module when linked', async () => {
    const nativeModule = {
      warmup: jest.fn().mockResolvedValue(undefined),
    };
    const { mod } = loadNativeModule({ nativeModule });

    await expect(
      mod.warmupNativeLocalLlmEngine({
        modelPath: '/model.gguf',
        backend: 'gpu',
        maxTokens: 4000,
        contextWindowTokens: 32000,
        topK: 64,
        topP: 0.95,
        temperature: 1,
        enableConstrainedDecoding: true,
      }),
    ).resolves.toBeUndefined();
    expect(nativeModule.warmup).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: '/model.gguf',
        backend: 'gpu',
        maxTokens: 4000,
        contextWindowTokens: 32000,
        topK: 64,
        topP: 0.95,
        temperature: 1,
        enableConstrainedDecoding: true,
      }),
    );
  });

  it('cancels native requests when the bridge exposes cancel', async () => {
    const nativeModule = {
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    const { mod } = loadNativeModule({ nativeModule });

    await expect(mod.cancelNativeLocalLlmRequest('req-1')).resolves.toBeUndefined();
    expect(nativeModule.cancel).toHaveBeenCalledWith('req-1');
  });

  it('treats cancel as a no-op when the bridge does not expose it', async () => {
    const { mod } = loadNativeModule();
    await expect(mod.cancelNativeLocalLlmRequest('req-1')).resolves.toBeUndefined();
  });

  it('treats warmup as a no-op when the bridge does not expose it', async () => {
    const { mod } = loadNativeModule();
    await expect(
      mod.warmupNativeLocalLlmEngine({ modelPath: '/model.gguf' }),
    ).resolves.toBeUndefined();
  });

  it('streams native events on Android and ignores unrelated request ids', async () => {
    const nativeModule: Record<string, any> = {
      startStreaming: jest.fn(),
    };
    const ctx = loadNativeModule({ nativeModule });
    nativeModule.startStreaming.mockImplementation(async (request: any) => {
      ctx.emit({ requestId: 'other', type: 'token', content: 'ignore' });
      ctx.emit({ requestId: request.requestId, type: 'token', content: 'hello' });
      ctx.emit({ requestId: request.requestId, type: 'done' });
    });

    const events = [];
    for await (const event of ctx.mod.streamWithNativeLocalLlm({
      requestId: 'req-android',
      modelPath: '/model.gguf',
      prompt: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ requestId: 'req-android', type: 'token', content: 'hello' }]);
    expect(ctx.NativeEventEmitter).not.toHaveBeenCalled();
    expect(ctx.subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('uses NativeEventEmitter on iOS and surfaces stream errors', async () => {
    const nativeModule: Record<string, any> = {
      startStreaming: jest.fn(),
    };
    const ctx = loadNativeModule({ platform: 'ios', nativeModule });
    nativeModule.startStreaming.mockImplementation(async (request: any) => {
      ctx.emit({ requestId: request.requestId, type: 'error', error: 'stream failed' });
    });

    await expect(
      (async () => {
        for await (const _event of ctx.mod.streamWithNativeLocalLlm({
          requestId: 'req-ios',
          modelPath: '/model.gguf',
          prompt: 'Hello',
        })) {
          // Consume the stream until it errors.
        }
      })(),
    ).rejects.toThrow('stream failed');

    expect(ctx.NativeEventEmitter).toHaveBeenCalledWith(nativeModule);
    expect(ctx.subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('throws clear errors when generate or streaming are unavailable', async () => {
    const { mod } = loadNativeModule({ nativeModule: {} });

    await expect(
      mod.generateWithNativeLocalLlm({
        requestId: 'req-1',
        modelPath: '/model.gguf',
        prompt: 'Hello',
      }),
    ).rejects.toThrow('local-llm-native-module-unavailable');
    await expect(
      (async () => {
        for await (const _event of mod.streamWithNativeLocalLlm({
          requestId: 'req-2',
          modelPath: '/model.gguf',
          prompt: 'Hello',
        })) {
          // No-op.
        }
      })(),
    ).rejects.toThrow('local-llm-native-module-unavailable');
  });
});
