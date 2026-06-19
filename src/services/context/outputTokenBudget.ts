import { getWorkingContextWindow } from './tokenCounter';

export const OUTPUT_TOKEN_MAX = 32_000;
const MIN_OUTPUT_TOKEN_BUDGET = 1024;
const DEFAULT_ESCALATION_MIN_TOKENS = 8192;
const MAX_OUTPUT_CONTEXT_SHARE = 0.5;
const OUTPUT_CONTEXT_HEADROOM = 4096;

export function resolveModelOutputTokenBudget(
  model: string,
  requestedTokens: number = OUTPUT_TOKEN_MAX,
): number {
  const workingContext = getWorkingContextWindow(model);
  const maxByShare = Math.floor(workingContext * MAX_OUTPUT_CONTEXT_SHARE);
  const maxByHeadroom = Math.max(MIN_OUTPUT_TOKEN_BUDGET, workingContext - OUTPUT_CONTEXT_HEADROOM);
  const hardCap = Math.max(MIN_OUTPUT_TOKEN_BUDGET, Math.min(maxByShare, maxByHeadroom));
  return Math.max(MIN_OUTPUT_TOKEN_BUDGET, Math.min(requestedTokens, hardCap));
}

export function resolveSubAgentMaxTokens(model: string): number {
  return resolveModelOutputTokenBudget(model);
}

export function resolveFinalizationMaxTokens(model: string): number {
  return resolveModelOutputTokenBudget(model);
}

export function getEscalatedFinalizationMaxTokens(currentMaxTokens: number, model: string): number {
  const retryCeiling = resolveSubAgentMaxTokens(model);
  const retryFloor = Math.max(
    Math.min(resolveFinalizationMaxTokens(model), retryCeiling),
    DEFAULT_ESCALATION_MIN_TOKENS,
  );
  if (currentMaxTokens >= retryCeiling) {
    return currentMaxTokens;
  }

  return Math.min(retryCeiling, Math.max(currentMaxTokens * 2, retryFloor));
}
