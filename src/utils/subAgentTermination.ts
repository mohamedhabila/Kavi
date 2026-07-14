import type { SubAgentSnapshot, SubAgentTerminationCause } from '../types/subAgent';

const SUB_AGENT_TERMINATION_CAUSES = new Set<SubAgentTerminationCause>([
  'completed',
  'app_restart',
  'timeout',
  'cancelled',
  'provider_failure',
  'tool_failure',
  'internal_failure',
  'preflight_rejected',
  'iteration_limit',
  'unknown',
]);

export function decodeSubAgentTerminationCause(value: unknown): SubAgentTerminationCause {
  return typeof value === 'string' &&
    SUB_AGENT_TERMINATION_CAUSES.has(value as SubAgentTerminationCause)
    ? (value as SubAgentTerminationCause)
    : 'unknown';
}

export function hydrateSubAgentTerminationCause<TSnapshot extends SubAgentSnapshot>(
  snapshot: TSnapshot,
): TSnapshot {
  return {
    ...snapshot,
    terminationCause: decodeSubAgentTerminationCause(snapshot.terminationCause),
  };
}
