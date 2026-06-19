import type { AssistantCompletionMetadata } from '../types/message';
import type { LlmProviderConfig } from '../types/provider';
import { getProviderApiKey } from '../services/storage/SecureStorage';
import {
  resolveFinalizationMaxTokens,
  resolveSubAgentMaxTokens,
} from '../services/context/tokenOptimization';

const MIN_PROVIDER_OVERFLOW_RETRY_MAX_TOKENS = 1024;

export function isDirectAnthropicProvider(provider: LlmProviderConfig): boolean {
  return provider.providerFamily === 'anthropic';
}

export async function hydrateProviderApiKey(
  provider: LlmProviderConfig,
): Promise<LlmProviderConfig> {
  const apiKey = (await getProviderApiKey(provider.id)) || provider.apiKey;
  return apiKey === provider.apiKey ? provider : { ...provider, apiKey };
}

export function shouldFailoverOnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/LLM API error\s+(\d{3})/i);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  return /network request failed|failed to fetch|fetch failed|timeout|timed out|econn|enotfound/i.test(
    message,
  );
}

export function isIncompleteAssistantCompletion(completion?: AssistantCompletionMetadata): boolean {
  return completion?.completionStatus === 'incomplete';
}

export function getEscalatedToolCallEmissionMaxTokens(
  currentMaxTokens: number,
  model: string,
): number {
  const retryCeiling = resolveSubAgentMaxTokens(model);
  const retryFloor = Math.max(resolveFinalizationMaxTokens(model), 8192);
  if (currentMaxTokens >= retryCeiling) {
    return currentMaxTokens;
  }

  return Math.min(retryCeiling, Math.max(currentMaxTokens * 2, retryFloor));
}

export function getProviderOverflowRetryMaxTokens(currentMaxTokens: number, model: string): number {
  if (currentMaxTokens <= MIN_PROVIDER_OVERFLOW_RETRY_MAX_TOKENS) {
    return currentMaxTokens;
  }

  return Math.max(
    MIN_PROVIDER_OVERFLOW_RETRY_MAX_TOKENS,
    Math.min(resolveFinalizationMaxTokens(model), Math.floor(currentMaxTokens * 0.75)),
  );
}
