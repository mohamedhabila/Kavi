import {
  LOCAL_LLM_STREAM_EVENT,
  type NativeLocalLlmAvailability,
  type NativeLocalLlmGenerateResult,
  type NativeLocalLlmRequest,
  type NativeLocalLlmStreamEvent,
  type NativeLocalLlmWarmupRequest,
  type NativeLocalLlmWarmupResult,
} from './nativeTypes';

interface KaviLocalLlmModuleShape {
  addListener?(eventName: string): void;
  removeListeners?(count: number): void;
  getAvailability(): Promise<NativeLocalLlmAvailability>;
  warmup?(request: NativeLocalLlmWarmupRequest): Promise<NativeLocalLlmWarmupResult | void>;
  generate(request: NativeLocalLlmRequest): Promise<NativeLocalLlmGenerateResult>;
  startStreaming(request: NativeLocalLlmRequest): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

function getReactNativeRuntime(): typeof import('react-native') {
  return require('react-native') as typeof import('react-native');
}

function getPlatformOs(): 'android' | 'ios' | string {
  return getReactNativeRuntime().Platform.OS;
}

function getKaviLocalLlmModule(): KaviLocalLlmModuleShape | undefined {
  return getReactNativeRuntime().NativeModules.KaviLocalLlm as
    | KaviLocalLlmModuleShape
    | undefined;
}

function getEventEmitter() {
  const reactNative = getReactNativeRuntime();
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (getPlatformOs() === 'ios' && kaviLocalLlmModule) {
    return new reactNative.NativeEventEmitter(kaviLocalLlmModule as any);
  }
  return reactNative.DeviceEventEmitter;
}

export function isNativeLocalLlmLinked(): boolean {
  return Boolean(getKaviLocalLlmModule()?.getAvailability);
}

export async function getNativeLocalLlmAvailability(): Promise<NativeLocalLlmAvailability> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  const platformOs = getPlatformOs();
  if (!kaviLocalLlmModule?.getAvailability) {
    return {
      available: false,
      linked: false,
      platform: platformOs,
      runtime: 'litert-lm',
      reason:
        platformOs === 'android'
          ? 'The on-device Android bridge is not linked in this build.'
          : 'The on-device iOS bridge is not linked in this build.',
      supportsStreaming: false,
      deviceMemoryGb: null,
      lowMemoryDevice: false,
    };
  }

  return kaviLocalLlmModule.getAvailability();
}

export async function warmupNativeLocalLlmEngine(
  request: NativeLocalLlmWarmupRequest,
): Promise<NativeLocalLlmWarmupResult | undefined> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.warmup) {
    return undefined;
  }

  const result = await kaviLocalLlmModule.warmup(request);
  return result || undefined;
}

export async function generateWithNativeLocalLlm(
  request: NativeLocalLlmRequest,
  signal?: AbortSignal,
): Promise<NativeLocalLlmGenerateResult> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.generate) {
    throw new Error('local-llm-native-module-unavailable');
  }

  throwIfNativeLocalLlmAborted(signal);
  const generationPromise = Promise.resolve(kaviLocalLlmModule.generate(request));
  let rejectPendingGeneration: ((error: Error) => void) | null = null;
  const cancelGeneration = () => {
    if (!signal) return;
    rejectPendingGeneration?.(localLlmAbortError(signal));
    if (kaviLocalLlmModule.cancel) {
      void kaviLocalLlmModule.cancel(request.requestId).catch(() => undefined);
    }
  };
  signal?.addEventListener('abort', cancelGeneration, { once: true });

  try {
    throwIfNativeLocalLlmAborted(signal);
    const result = signal
      ? await Promise.race([
          generationPromise,
          new Promise<never>((_resolve, reject) => {
            rejectPendingGeneration = reject;
            if (signal.aborted) reject(localLlmAbortError(signal));
          }),
        ])
      : await generationPromise;
    throwIfNativeLocalLlmAborted(signal);
    return {
      text: result?.text || '',
      ...(Array.isArray(result?.toolCalls) ? { toolCalls: result.toolCalls } : {}),
      ...(result?.backend ? { backend: result.backend } : {}),
      ...(result?.visionBackend ? { visionBackend: result.visionBackend } : {}),
      ...(result?.audioBackend ? { audioBackend: result.audioBackend } : {}),
    };
  } finally {
    rejectPendingGeneration = null;
    signal?.removeEventListener('abort', cancelGeneration);
  }
}

export async function cancelNativeLocalLlmRequest(requestId: string): Promise<void> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.cancel) {
    return;
  }

  await kaviLocalLlmModule.cancel(requestId);
}

function localLlmAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfNativeLocalLlmAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw localLlmAbortError(signal);
}

export async function* streamWithNativeLocalLlm(
  request: NativeLocalLlmRequest,
  signal?: AbortSignal,
): AsyncGenerator<NativeLocalLlmStreamEvent> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.startStreaming) {
    throw new Error('local-llm-native-module-unavailable');
  }

  const emitter = getEventEmitter();
  const queue: NativeLocalLlmStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let terminalEvent: NativeLocalLlmStreamEvent | null = null;
  let rejectPendingStart: ((error: Error) => void) | null = null;

  const cancelNativeStream = () => {
    if (!signal) return;
    wake?.();
    rejectPendingStart?.(localLlmAbortError(signal));
    if (kaviLocalLlmModule.cancel) {
      void kaviLocalLlmModule.cancel(request.requestId).catch(() => undefined);
    }
  };
  throwIfNativeLocalLlmAborted(signal);

  const subscription = emitter.addListener(
    LOCAL_LLM_STREAM_EVENT,
    (event: NativeLocalLlmStreamEvent) => {
      if (!event || event.requestId !== request.requestId) {
        return;
      }

      queue.push(event);
      if (event.type === 'done' || event.type === 'error') {
        terminalEvent = event;
      }
      wake?.();
    },
  );
  signal?.addEventListener('abort', cancelNativeStream, { once: true });

  try {
    const startPromise = Promise.resolve(kaviLocalLlmModule.startStreaming(request));
    try {
      if (signal) {
        const startAbortPromise = new Promise<never>((_resolve, reject) => {
          rejectPendingStart = reject;
          if (signal.aborted) reject(localLlmAbortError(signal));
        });
        await Promise.race([startPromise, startAbortPromise]);
      } else {
        await startPromise;
      }
    } catch (error) {
      if (signal?.aborted && kaviLocalLlmModule.cancel) {
        void startPromise
          .then(() => kaviLocalLlmModule.cancel?.(request.requestId))
          .catch(() => undefined);
      }
      throw error;
    } finally {
      rejectPendingStart = null;
    }
    throwIfNativeLocalLlmAborted(signal);

    while (true) {
      throwIfNativeLocalLlmAborted(signal);
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (signal?.aborted) resolve();
        });
        wake = null;
        throwIfNativeLocalLlmAborted(signal);
      }

      while (queue.length > 0) {
        const event = queue.shift();
        if (!event) {
          continue;
        }
        throwIfNativeLocalLlmAborted(signal);

        if (event.type === 'error') {
          throw new Error(event.error || 'local-llm-stream-failed');
        }

        if (event.type === 'done') {
          return;
        }

        yield event;
      }

      if (terminalEvent) {
        return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancelNativeStream);
    subscription.remove();
  }
}
