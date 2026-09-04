import { classifyProviderError } from './providerErrorClassification';

/** @deprecated Prefer `classifyProviderError(error).status` for new call sites. */
export function getProviderRequestErrorStatus(error: unknown): number | undefined {
  return classifyProviderError(error).status;
}

export function isContextOverflowProviderError(error: unknown): boolean {
  return classifyProviderError(error).kind === 'context_overflow';
}

export function isNonRetryableProviderRequestError(error: unknown): boolean {
  return !classifyProviderError(error).retryable;
}
