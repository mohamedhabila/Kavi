// ---------------------------------------------------------------------------
// Kavi — LLM Service
// ---------------------------------------------------------------------------
// Stable public facade for provider-backed chat, streaming, model discovery,
// and image operations. Implementation details live in focused service modules.

import type { LlmProviderConfig } from '../../types/provider';
import { performLlmFetch } from './core/fetchTransport';
import { editLlmImage, generateLlmImage } from './imageService';
import type {
  GeneratedImagePayload,
  ImageEditRequest,
  ImageGenerationRequest,
} from './images/types';
import { sendLlmMessage } from './messageService';
import { fetchLlmProviderModels } from './modelService';
import { streamLlmMessage } from './streamService';
import type {
  ChatCompletionMessage,
  MessageRequestOptions,
  ModelsWithCapabilities,
  StreamEvent,
} from './support/contracts';

export type { GeneratedImagePayload } from './images/types';
export type { ModelsWithCapabilities, StreamCallbacks } from './support/contracts';
export {
  getGeminiPromptCacheTelemetrySnapshot,
  resetGeminiPromptCacheForTests,
} from './providers/gemini/promptCache';
export type { GeminiPromptCacheTelemetrySnapshot } from './providers/gemini/promptCache';

export class LlmService {
  private config: LlmProviderConfig;

  constructor(config: LlmProviderConfig) {
    this.config = config;
  }

  async fetchModels(): Promise<ModelsWithCapabilities> {
    return fetchLlmProviderModels({
      provider: this.config,
      performFetch: performLlmFetch,
    });
  }

  async sendMessage(
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions = {},
  ): Promise<any> {
    return sendLlmMessage({
      provider: this.config,
      messages,
      options,
      performFetch: performLlmFetch,
    });
  }

  async generateImage(options: ImageGenerationRequest): Promise<GeneratedImagePayload> {
    return generateLlmImage({
      provider: this.config,
      options,
      performFetch: performLlmFetch,
    });
  }

  async editImage(options: ImageEditRequest): Promise<GeneratedImagePayload> {
    return editLlmImage({
      provider: this.config,
      options,
      performFetch: performLlmFetch,
    });
  }

  async *streamMessage(
    messages: ChatCompletionMessage[],
    options: Omit<MessageRequestOptions, 'stream'> = {},
  ): AsyncGenerator<StreamEvent> {
    yield* streamLlmMessage({
      provider: this.config,
      messages,
      options,
      performFetch: performLlmFetch,
    });
  }
}
