import type { LlmProviderConfig } from '../../../types/provider';
import { resolveProviderFamily } from '../catalog/providerFamilies';

export const PRIMARY_OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const PRIMARY_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';

const IMAGE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3.1-flash-image-preview': PRIMARY_GEMINI_IMAGE_MODEL,
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
};

export function normalizeImageModelId(model?: string | null): string {
  const trimmed = (model || '').trim();
  if (!trimmed) {
    return '';
  }

  const normalizedKey = trimmed.toLowerCase();
  return IMAGE_MODEL_ALIASES[normalizedKey] || trimmed;
}

export function isOpenAIImageModel(model: string): boolean {
  const normalized = normalizeImageModelId(model);
  return /^gpt-image/i.test(normalized) || /^chatgpt-image-latest$/i.test(normalized);
}

export function isGeminiImageModel(model: string): boolean {
  const normalized = normalizeImageModelId(model);
  return /gemini-.*image|imagen/i.test(normalized);
}

export function resolveImageModel(
  provider: Pick<LlmProviderConfig, 'name' | 'baseUrl' | 'model' | 'providerFamily'>,
  requestedModel?: string,
): string {
  const explicitModel = normalizeImageModelId(requestedModel);
  if (explicitModel) {
    return explicitModel;
  }

  const configuredModel = normalizeImageModelId(provider.model);
  if (isOpenAIImageModel(configuredModel) || isGeminiImageModel(configuredModel)) {
    return configuredModel;
  }

  const family = resolveProviderFamily(provider);
  if (family === 'openai') {
    return PRIMARY_OPENAI_IMAGE_MODEL;
  }
  if (family === 'gemini') {
    return PRIMARY_GEMINI_IMAGE_MODEL;
  }

  return configuredModel || PRIMARY_OPENAI_IMAGE_MODEL;
}

export function isGeminiImageProvider(
  provider: Pick<LlmProviderConfig, 'name' | 'baseUrl' | 'providerFamily'>,
  model: string,
): boolean {
  const family = resolveProviderFamily(provider);
  return isGeminiImageModel(model) || family === 'gemini';
}

export function isSupportedOpenAIImageEditModel(model: string): boolean {
  return isOpenAIImageModel(model);
}
