import type { LlmProviderConfig } from '../../types/provider';
import { isOnDeviceLlmProvider } from '../localLlm/provider';
import { resolveProviderTransport } from './catalog/providerProtocols';
import type { LlmPerformFetch } from './core/fetchTransport';
import {
  buildProviderHeaders,
  resolveGeminiBaseUrl,
  resolveProviderBaseUrl,
} from './core/providerRequest';
import {
  editGeminiImage as editGeminiImageRequest,
  generateGeminiImage as generateGeminiImageRequest,
} from './images/geminiImageAdapter';
import {
  editOpenAICompatibleImage as editOpenAICompatibleImageRequest,
  generateOpenAICompatibleImage as generateOpenAICompatibleImageRequest,
} from './images/openaiImageAdapter';
import type {
  GeneratedImagePayload,
  ImageEditRequest,
  ImageGenerationRequest,
} from './images/types';

export function generateLlmImage(params: {
  provider: LlmProviderConfig;
  options: ImageGenerationRequest;
  performFetch: LlmPerformFetch;
}): Promise<GeneratedImagePayload> {
  assertImageGenerationSupported(params.provider);

  if (resolveProviderTransport(params.provider) === 'gemini') {
    assertGeminiImageApiKey(params.provider, 'generation');
    return generateGeminiImageRequest({
      baseUrl: resolveGeminiBaseUrl(params.provider),
      headers: buildProviderHeaders(params.provider),
      defaultModel: params.provider.model,
      options: params.options,
      performFetch: (url, init) => params.performFetch(url, init),
    });
  }

  return generateOpenAICompatibleImageRequest({
    baseUrl: resolveProviderBaseUrl(params.provider),
    headers: buildProviderHeaders(params.provider),
    defaultModel: params.provider.model,
    options: params.options,
    performFetch: (url, init) => params.performFetch(url, init),
  });
}

export function editLlmImage(params: {
  provider: LlmProviderConfig;
  options: ImageEditRequest;
  performFetch: LlmPerformFetch;
}): Promise<GeneratedImagePayload> {
  assertImageEditingSupported(params.provider);

  if (resolveProviderTransport(params.provider) === 'gemini') {
    assertGeminiImageApiKey(params.provider, 'editing');
    return editGeminiImageRequest({
      baseUrl: resolveGeminiBaseUrl(params.provider),
      headers: buildProviderHeaders(params.provider),
      defaultModel: params.provider.model,
      options: params.options,
      performFetch: (url, init) => params.performFetch(url, init),
    });
  }

  return editOpenAICompatibleImageRequest({
    baseUrl: resolveProviderBaseUrl(params.provider),
    headers: buildProviderHeaders(params.provider),
    defaultModel: params.provider.model,
    options: params.options,
    performFetch: (url, init) => params.performFetch(url, init),
  });
}

function assertImageGenerationSupported(provider: LlmProviderConfig): void {
  if (isOnDeviceLlmProvider(provider)) {
    throw new Error('On-device local models do not support image generation in this build');
  }
  if (resolveProviderTransport(provider) === 'anthropic') {
    throw new Error('Anthropic image generation is not supported');
  }
}

function assertImageEditingSupported(provider: LlmProviderConfig): void {
  if (isOnDeviceLlmProvider(provider)) {
    throw new Error('On-device local models do not support image editing in this build');
  }
  if (resolveProviderTransport(provider) === 'anthropic') {
    throw new Error('Anthropic image editing is not supported');
  }
}

function assertGeminiImageApiKey(
  provider: Pick<LlmProviderConfig, 'apiKey'>,
  operation: 'generation' | 'editing',
): void {
  if (!(provider.apiKey || '').trim()) {
    throw new Error(`Gemini API key is required for image ${operation}`);
  }
}
