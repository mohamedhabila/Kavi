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
): Promise<NativeLocalLlmGenerateResult> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.generate) {
    throw new Error('local-llm-native-module-unavailable');
  }

  const result = await kaviLocalLlmModule.generate(request);
  return {
    text: result?.text || '',
    ...(Array.isArray(result?.toolCalls) ? { toolCalls: result.toolCalls } : {}),
    ...(result?.backend ? { backend: result.backend } : {}),
    ...(result?.visionBackend ? { visionBackend: result.visionBackend } : {}),
    ...(result?.audioBackend ? { audioBackend: result.audioBackend } : {}),
  };
}

export async function cancelNativeLocalLlmRequest(requestId: string): Promise<void> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.cancel) {
    return;
  }

  await kaviLocalLlmModule.cancel(requestId);
}

export async function* streamWithNativeLocalLlm(
  request: NativeLocalLlmRequest,
): AsyncGenerator<NativeLocalLlmStreamEvent> {
  const kaviLocalLlmModule = getKaviLocalLlmModule();
  if (!kaviLocalLlmModule?.startStreaming) {
    throw new Error('local-llm-native-module-unavailable');
  }

  const emitter = getEventEmitter();
  const queue: NativeLocalLlmStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let terminalEvent: NativeLocalLlmStreamEvent | null = null;

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

  try {
    await kaviLocalLlmModule.startStreaming(request);

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }

      while (queue.length > 0) {
        const event = queue.shift();
        if (!event) {
          continue;
        }

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
    subscription.remove();
  }
}
