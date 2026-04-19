import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { LocalLlmBackend, LocalLlmRuntime } from '../../types';

export const LOCAL_LLM_STREAM_EVENT = 'KaviLocalLlmStream';

export interface NativeLocalLlmAvailability {
  available: boolean;
  linked: boolean;
  platform?: string | null;
  runtime?: string | null;
  reason?: string | null;
  supportsStreaming?: boolean;
  deviceMemoryGb?: number | null;
  lowMemoryDevice?: boolean;
}

export interface NativeLocalLlmWarmupResult {
  backend?: LocalLlmBackend;
}

export interface NativeLocalLlmConversationToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface NativeLocalLlmConversationToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface NativeLocalLlmConversationToolResponse {
  name: string;
  response: unknown;
}

export interface NativeLocalLlmConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: NativeLocalLlmConversationToolCall[];
  toolResponses?: NativeLocalLlmConversationToolResponse[];
}

export interface NativeLocalLlmToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface NativeLocalLlmGenerateResult {
  text: string;
  toolCalls?: NativeLocalLlmToolCallResult[];
  backend?: LocalLlmBackend;
}

export interface NativeLocalLlmRequest {
  requestId: string;
  conversationKey?: string;
  modelPath: string;
  runtime?: LocalLlmRuntime;
  prompt?: string;
  systemPrompt?: string | null;
  history?: NativeLocalLlmConversationMessage[];
  currentMessage?: NativeLocalLlmConversationMessage;
  tools?: NativeLocalLlmConversationToolDefinition[];
  backend?: LocalLlmBackend;
  maxTokens?: number;
  contextWindowTokens?: number;
  topK?: number;
  topP?: number;
  temperature?: number;
  enableConstrainedDecoding?: boolean;
  minDeviceMemoryGb?: number;
}

export interface NativeLocalLlmWarmupRequest {
  modelPath: string;
  conversationKey?: string;
  runtime?: LocalLlmRuntime;
  systemPrompt?: string | null;
  tools?: NativeLocalLlmConversationToolDefinition[];
  backend?: LocalLlmBackend;
  maxTokens?: number;
  contextWindowTokens?: number;
  topK?: number;
  topP?: number;
  temperature?: number;
  enableConstrainedDecoding?: boolean;
  minDeviceMemoryGb?: number;
}

export interface NativeLocalLlmStreamEvent {
  requestId: string;
  type: 'token' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: NativeLocalLlmToolCallResult;
  error?: string;
  backend?: LocalLlmBackend;
}

interface KaviLocalLlmModuleShape {
  addListener?(eventName: string): void;
  removeListeners?(count: number): void;
  getAvailability(): Promise<NativeLocalLlmAvailability>;
  warmup?(request: NativeLocalLlmWarmupRequest): Promise<NativeLocalLlmWarmupResult | void>;
  generate(request: NativeLocalLlmRequest): Promise<NativeLocalLlmGenerateResult>;
  startStreaming(request: NativeLocalLlmRequest): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

const kaviLocalLlmModule = NativeModules.KaviLocalLlm as KaviLocalLlmModuleShape | undefined;

function getEventEmitter() {
  if (Platform.OS === 'ios' && kaviLocalLlmModule) {
    return new NativeEventEmitter(kaviLocalLlmModule as any);
  }
  return DeviceEventEmitter;
}

export function isNativeLocalLlmLinked(): boolean {
  return Boolean(kaviLocalLlmModule?.getAvailability);
}

export async function getNativeLocalLlmAvailability(): Promise<NativeLocalLlmAvailability> {
  if (!kaviLocalLlmModule?.getAvailability) {
    const runtime = Platform.OS === 'android' ? 'litert-lm' : 'mediapipe-genai';
    return {
      available: false,
      linked: false,
      platform: Platform.OS,
      runtime,
      reason:
        Platform.OS === 'android'
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
  if (!kaviLocalLlmModule?.warmup) {
    return undefined;
  }

  const result = await kaviLocalLlmModule.warmup(request);
  return result || undefined;
}

export async function generateWithNativeLocalLlm(
  request: NativeLocalLlmRequest,
): Promise<NativeLocalLlmGenerateResult> {
  if (!kaviLocalLlmModule?.generate) {
    throw new Error('local-llm-native-module-unavailable');
  }

  const result = await kaviLocalLlmModule.generate(request);
  return {
    text: result?.text || '',
    ...(Array.isArray(result?.toolCalls) ? { toolCalls: result.toolCalls } : {}),
    ...(result?.backend ? { backend: result.backend } : {}),
  };
}

export async function cancelNativeLocalLlmRequest(requestId: string): Promise<void> {
  if (!kaviLocalLlmModule?.cancel) {
    return;
  }

  await kaviLocalLlmModule.cancel(requestId);
}

export async function* streamWithNativeLocalLlm(
  request: NativeLocalLlmRequest,
): AsyncGenerator<NativeLocalLlmStreamEvent> {
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
