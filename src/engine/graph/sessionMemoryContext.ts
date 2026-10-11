import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotDurablyCurrent,
  type MemoryAuthoritySnapshot,
} from '../../services/memory/memoryAuthority';
import type { NextTurnMemoryConsistencyResult } from '../../services/memory/nextTurnConsistency';
import { captureMemoryReadEpoch, getMemoryPolicyEpoch } from '../../services/memory/policy';
import { isMemoryValidityDeadlineCurrent } from '../../services/memory/memoryValidityDeadline';

export type SessionMemoryAdmission = 'admitted' | 'opt_out' | 'degraded';

export type AdmittedSessionMemoryContext = Readonly<{
  admission: SessionMemoryAdmission;
  authoritySnapshot: MemoryAuthoritySnapshot | null;
  consistencyBarrier: NextTurnMemoryConsistencyResult;
  livingMemory: LivingMemoryBridgeOutput | null;
  policyEpoch: number;
}>;

export type SessionMemoryAccessCandidate = Readonly<{
  consistencyBarrier: NextTurnMemoryConsistencyResult;
  livingMemory: LivingMemoryBridgeOutput | null;
}>;

export function admitSessionMemoryContext(
  candidate: SessionMemoryAccessCandidate,
): AdmittedSessionMemoryContext {
  const policyEpoch = getMemoryPolicyEpoch();
  if (candidate.consistencyBarrier.outcome === 'opt_out') {
    return Object.freeze({
      admission: 'opt_out',
      authoritySnapshot: null,
      consistencyBarrier: candidate.consistencyBarrier,
      livingMemory: null,
      policyEpoch,
    });
  }

  const livingMemoryAuthority = candidate.livingMemory?.memoryAuthoritySnapshot;
  if (candidate.livingMemory && livingMemoryAuthority) {
    return Object.freeze({
      admission: 'admitted',
      authoritySnapshot: livingMemoryAuthority,
      consistencyBarrier: candidate.consistencyBarrier,
      livingMemory: candidate.livingMemory,
      policyEpoch,
    });
  }

  return Object.freeze({
    admission: 'degraded',
    authoritySnapshot: captureMemoryAuthoritySnapshot(),
    consistencyBarrier: Object.freeze({
      ...candidate.consistencyBarrier,
      outcome: 'degraded',
    }),
    livingMemory: null,
    policyEpoch,
  });
}

/**
 * The session refreshes only when the admitted projection can no longer
 * describe the current memory state. A storage outage without a readable
 * snapshot is intentionally stable for this session: retrying it every model
 * iteration would add latency without improving the truthful degraded prompt.
 */
export function isAdmittedSessionMemoryContextFresh(
  context: AdmittedSessionMemoryContext,
  now = Date.now(),
): boolean {
  if (context.policyEpoch !== getMemoryPolicyEpoch()) return false;
  if (context.admission === 'opt_out') return captureMemoryReadEpoch() === null;
  if (!context.authoritySnapshot) return context.admission === 'degraded';
  return (
    isMemoryValidityDeadlineCurrent(context.livingMemory?.validUntil, now) &&
    isMemoryProjectionSnapshotDurablyCurrent(context.authoritySnapshot)
  );
}
