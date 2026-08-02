export const DELEGATED_WORKER_GOAL_OWNER = 'delegated-worker' as const;
export const DELEGATED_WORKER_EVIDENCE_CRITERION = 'evidence.prefix:worker' as const;
export const DELEGATED_WORKER_MIN_EVIDENCE_CRITERION = 'evidence.min:1' as const;
export const DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX = 'delegation_launch:' as const;

export function buildDelegatedWorkerLaunchEvidence(sessionId: string): string {
  return `${DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX}${sessionId.trim()}`;
}

export function readDelegatedWorkerLaunchSessionId(evidence: string): string | undefined {
  if (!evidence.startsWith(DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX)) return undefined;
  const sessionId = evidence.slice(DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX.length).trim();
  return sessionId || undefined;
}
