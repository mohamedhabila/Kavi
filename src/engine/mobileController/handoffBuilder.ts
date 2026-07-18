import type { EffectDispatchClaimEvidence } from '../../services/executionJournal/effectDispatchCoordinator';
import type { MobileControllerPendingHandoff } from './contracts';
import { qualifyMobileControllerPendingHandoff } from './validation';
import type { MobileControllerDeferredExecution } from './runtimeExecution';

const EFFECT_RUN_PREFIX = 'effect-run-';

export function buildClaimedMobileControllerHandoff(input: {
  claim: EffectDispatchClaimEvidence;
  deferred: MobileControllerDeferredExecution;
  createdAt: number;
}): MobileControllerPendingHandoff | null {
  const { claim, deferred } = input;
  const runSuffix = claim.identity.runId.slice(EFFECT_RUN_PREFIX.length);
  if (
    !claim.identity.runId.startsWith(EFFECT_RUN_PREFIX) ||
    !/^[a-f0-9]{48}$/u.test(runSuffix) ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < claim.claimedAt ||
    !Number.isSafeInteger(deferred.capability.timeoutMs) ||
    input.createdAt > Number.MAX_SAFE_INTEGER - deferred.capability.timeoutMs
  ) {
    return null;
  }
  return qualifyMobileControllerPendingHandoff(
    {
      version: 1,
      handoffId: `mch_${runSuffix.slice(0, 32)}`,
      claimToken: claim.claimToken,
      dispatchIdentity: claim.identity,
      controllerId: deferred.capability.controllerId,
      controllerContractVersion: deferred.capability.controllerContractVersion,
      capabilityDigest: deferred.capability.capabilityDigest,
      action: deferred.action,
      actionDigest: `sha256:${claim.identity.requestDigest}`,
      beforeObservation: deferred.beforeObservation,
      claimedAt: claim.claimedAt,
      createdAt: input.createdAt,
      expiresAt: input.createdAt + deferred.capability.timeoutMs,
    },
    deferred.capability,
  );
}
