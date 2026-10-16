// ---------------------------------------------------------------------------
// Kavi — Asking less of a phone that is running hot
// ---------------------------------------------------------------------------
// A long on-device generation heats a phone further, and a hot phone throttles until
// replies crawl. The phone's own thermal state (iOS ProcessInfo.thermalState, Android
// PowerManager thermal status, mapped onto Apple's four levels) is read with every request:
// when it is serious, replies are kept shorter; when it is critical, the context is cut to
// the smallest window too. The request still runs: a short answer beats none.

import { createLogger } from '../../utils/logger';
import type { LocalLlmExecutionPolicy } from './types';

export const LOCAL_LLM_THERMAL_STATES = ['nominal', 'fair', 'serious', 'critical'] as const;
export type LocalLlmThermalState = (typeof LOCAL_LLM_THERMAL_STATES)[number];

/** The longest reply a hot phone is asked for. */
export const LOCAL_LLM_HOT_MAX_TOKENS: Readonly<Record<'serious' | 'critical', number>> = {
  serious: 1_024,
  critical: 512,
};
/**
 * The context a critically hot phone prefills. Both runtimes reuse an engine whose window is
 * at least the one asked for, so this never starts a new engine; it only prefills less.
 */
export const LOCAL_LLM_CRITICAL_CONTEXT_TOKENS = 4_096;

const log = createLogger('local-llm-thermal');

export function parseLocalLlmThermalState(value: unknown): LocalLlmThermalState | null {
  return LOCAL_LLM_THERMAL_STATES.includes(value as LocalLlmThermalState)
    ? (value as LocalLlmThermalState)
    : null;
}

/** [policy] as a phone in [thermalState] can carry it. */
export function limitLocalLlmForHeat(
  policy: LocalLlmExecutionPolicy,
  thermalState: LocalLlmThermalState | null | undefined,
): LocalLlmExecutionPolicy {
  if (thermalState !== 'serious' && thermalState !== 'critical') return policy;
  const maxTokens = Math.min(policy.maxTokens, LOCAL_LLM_HOT_MAX_TOKENS[thermalState]);
  const safeMaxContextWindowTokens =
    thermalState === 'critical'
      ? Math.min(
          policy.safeMaxContextWindowTokens ?? LOCAL_LLM_CRITICAL_CONTEXT_TOKENS,
          LOCAL_LLM_CRITICAL_CONTEXT_TOKENS,
        )
      : policy.safeMaxContextWindowTokens;
  if (
    maxTokens === policy.maxTokens &&
    safeMaxContextWindowTokens === policy.safeMaxContextWindowTokens
  ) {
    return policy;
  }
  log.warn('Limited an on-device request for heat', {
    thermalState,
    maxTokens,
    safeMaxContextWindowTokens,
  });
  return { ...policy, maxTokens, safeMaxContextWindowTokens };
}
