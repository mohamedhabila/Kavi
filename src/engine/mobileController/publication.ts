import type { AgentRunMobileControllerHandoffRef } from '../../types/agentRun';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';
import type { MobileControllerAction, MobileControllerObservationRef } from './contracts';

export type MobileControllerPublishedHandoff = Readonly<{
  version: 1;
  owner: Readonly<{ conversationId: string; agentRunId: string }>;
  handoff: AgentRunMobileControllerHandoffRef;
  action: MobileControllerAction;
  beforeObservation: MobileControllerObservationRef;
  createdAt: number;
}>;

function cloneAction(action: MobileControllerAction): MobileControllerAction {
  if (action.kind === 'activate' || action.kind === 'double_tap' || action.kind === 'long_press') {
    return Object.freeze({ ...action, target: Object.freeze({ ...action.target }) });
  }
  if (action.kind === 'drag') {
    return Object.freeze({
      ...action,
      start: Object.freeze({ ...action.start }),
      end: Object.freeze({ ...action.end }),
    });
  }
  return Object.freeze({ ...action });
}

export function buildMobileControllerPublishedHandoff(
  persisted: PersistedMobileControllerHandoff,
  owner: { conversationId: string; agentRunId: string },
): MobileControllerPublishedHandoff | null {
  const { handoff, handoffRef, handle, checkpoint, run } = persisted;
  const identity = handoff.dispatchIdentity;
  const conversationId = owner.conversationId.trim();
  const agentRunId = owner.agentRunId.trim();
  if (
    !conversationId ||
    !agentRunId ||
    handoffRef.effectRunId !== identity.runId ||
    handoffRef.executionRunId !== identity.executionRunId ||
    handoffRef.effectId !== identity.effectId ||
    handoffRef.toolCallId !== identity.toolCallId ||
    handoffRef.controlEpoch !== identity.controlEpoch ||
    handoffRef.handoffId !== handoff.handoffId ||
    handoffRef.controllerId !== handoff.controllerId ||
    handoffRef.controllerContractVersion !== handoff.controllerContractVersion ||
    handoffRef.capabilityDigest !== handoff.capabilityDigest ||
    handoffRef.actionDigest !== handoff.actionDigest ||
    handoffRef.beforeObservationId !== handoff.beforeObservation.observationId ||
    handoffRef.beforeObservationDigest !== handoff.beforeObservation.digest ||
    handoffRef.expiresAt !== handoff.expiresAt ||
    handoffRef.externalHandleId !== handle.id ||
    handle.runId !== identity.runId ||
    handle.effectId !== identity.effectId ||
    handle.status !== 'pending' ||
    checkpoint.runId !== identity.runId ||
    checkpoint.boundary !== 'waiting_external' ||
    checkpoint.stateRefId !== handoff.handoffId ||
    run.id !== identity.runId ||
    run.taskId !== identity.executionRunId ||
    run.status !== 'waiting'
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    owner: Object.freeze({ conversationId, agentRunId }),
    handoff: handoffRef,
    action: cloneAction(handoff.action),
    beforeObservation: Object.freeze({ ...handoff.beforeObservation }),
    createdAt: handoff.createdAt,
  });
}
