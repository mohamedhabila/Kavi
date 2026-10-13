import { classifyProviderError } from './providerErrorClassification';

export function isContextOverflowProviderError(error: unknown): boolean {
  return classifyProviderError(error).kind === 'context_overflow';
}

export function isNonRetryableProviderRequestError(error: unknown): boolean {
  return !classifyProviderError(error).retryable;
}
