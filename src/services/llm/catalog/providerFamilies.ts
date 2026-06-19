import type { LlmProviderConfig, LlmProviderFamily } from '../../../types/provider';

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizeHost(baseUrl?: string): string {
  const trimmed = (baseUrl || '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
  }
}

export function normalizeHostedModelId(model: string | undefined): string {
  const normalizedModel = normalizeText(model);
  if (!normalizedModel) {
    return '';
  }

  const stripped = normalizedModel
    .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//, '')
    .replace(/^publishers\/[^/]+\/models\//, '')
    .replace(/^models\//, '');

  const segments = stripped.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

export function resolveModelHostedFamily(model: string | undefined): LlmProviderFamily | undefined {
  const normalizedModel = normalizeHostedModelId(model);
  if (!normalizedModel) {
    return undefined;
  }

  if (
    normalizedModel.startsWith('gpt-') ||
    /^o1(?:[.-]|$)/.test(normalizedModel) ||
    /^o3(?:[.-]|$)/.test(normalizedModel) ||
    /^o4(?:[.-]|$)/.test(normalizedModel)
  ) {
    return 'openai';
  }

  if (/^claude(?:[.-]|$)/.test(normalizedModel)) {
    return 'anthropic';
  }

  if (/^gemini(?:[.-]|$)/.test(normalizedModel)) {
    return 'gemini';
  }

  if (/^deepseek(?:[.-]|$)/.test(normalizedModel)) {
    return 'deepseek';
  }

  if (/^qwen(?:[.-]|$|\d)/.test(normalizedModel)) {
    return 'qwen';
  }

  if (/^(?:kimi|moonshot)(?:[.-]|$)/.test(normalizedModel)) {
    return 'kimi';
  }

  return undefined;
}

export function isGeminiModelName(model: string | undefined): boolean {
  return resolveModelHostedFamily(model) === 'gemini';
}

export function resolveProviderFamily(
  provider: Pick<LlmProviderConfig, 'name' | 'baseUrl' | 'providerFamily'>,
): LlmProviderFamily {
  if (provider.providerFamily && provider.providerFamily !== 'custom') {
    return provider.providerFamily;
  }

  const baseUrl = normalizeText(provider.baseUrl);
  const host = normalizeHost(provider.baseUrl);
  const name = normalizeText(provider.name);

  if (host.includes('openrouter.ai') || name.includes('openrouter')) {
    return 'openrouter';
  }

  if (host.includes('deepseek.com') || name.includes('deepseek')) {
    return 'deepseek';
  }

  if (host.includes('mistral.ai') || name.includes('mistral')) {
    return 'mistral';
  }

  if (host.includes('voyageai.com') || name.includes('voyage')) {
    return 'voyage';
  }

  if (
    host.includes('dashscope') ||
    host.includes('qwen') ||
    name.includes('qwen') ||
    name.includes('dashscope')
  ) {
    return 'qwen';
  }

  if (
    host.includes('moonshot') ||
    host.includes('kimi') ||
    name.includes('moonshot') ||
    name.includes('kimi')
  ) {
    return 'kimi';
  }

  if (host.includes('anthropic.com') || name === 'anthropic') {
    return 'anthropic';
  }

  if (
    host.includes('generativelanguage.googleapis.com') ||
    host.includes('aiplatform.googleapis.com') ||
    name.includes('gemini') ||
    name === 'google'
  ) {
    return 'gemini';
  }

  if (/(^|\.)openai\.com$/i.test(host) || host.endsWith('.openai.com') || name === 'openai') {
    return 'openai';
  }

  if (host.includes('localhost') && baseUrl.includes(':11434')) {
    return 'ollama';
  }

  if (name.includes('ollama')) {
    return 'ollama';
  }

  return provider.providerFamily || 'custom';
}
