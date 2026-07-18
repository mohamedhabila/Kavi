import type { PersistedMobileControllerHandoff } from '../../src/services/executionJournal/mobileControllerHandoffStore';
import type {
  MobileControllerCapability,
  MobileControllerOutcome,
} from '../../src/engine/mobileController/contracts';
import { buildStructuredToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import type { MobileControllerOutcomeSettlementResult } from '../../src/services/executionJournal/mobileControllerOutcomeStore';

const RUN_SUFFIX = '1'.repeat(48);
const HANDOFF_SUFFIX = RUN_SUFFIX.slice(0, 32);
const REQUEST_DIGEST = 'a'.repeat(64);
const TOOL_NAME_DIGEST = 'b'.repeat(64);
const CONTRACT_DIGEST = 'c'.repeat(64);
const OBSERVATION_DIGEST = 'd'.repeat(64);
const CAPABILITY_DIGEST = `sha256:${'e'.repeat(64)}` as const;

export function createPersistedMobileControllerHandoffFixture(): PersistedMobileControllerHandoff {
  const effectRunId = `effect-run-${RUN_SUFFIX}`;
  const handoffId = `mch_${HANDOFF_SUFFIX}`;
  const externalHandleId = `mobile-handoff-${HANDOFF_SUFFIX}`;
  const executionRunId = 'execution-run-mobile-1';
  const toolCallId = 'tool-call-mobile-1';
  const effectId = `effect-${HANDOFF_SUFFIX}`;
  const createdAt = 110;
  const expiresAt = 10_110;
  const actionDigest = `sha256:${REQUEST_DIGEST}` as const;
  const beforeObservationDigest = `sha256:${OBSERVATION_DIGEST}` as const;
  const locator = {
    version: 1 as const,
    kind: 'mobile_controller_handoff' as const,
    handoffId,
    controllerId: 'android-controller-1',
    controllerContractVersion: 1,
    capabilityDigest: CAPABILITY_DIGEST,
    actionDigest,
    beforeObservationId: 'observation-before-1',
    beforeObservationDigest,
    expiresAt,
  };

  return Object.freeze({
    kind: 'persisted',
    handoff: Object.freeze({
      version: 1,
      handoffId,
      claimToken: `effect-claim-${RUN_SUFFIX}`,
      dispatchIdentity: Object.freeze({
        runId: effectRunId,
        effectId,
        executionRunId,
        toolCallId,
        toolName: 'mobile_ui_action',
        toolNameDigest: TOOL_NAME_DIGEST,
        toolContractIdentityDigest: CONTRACT_DIGEST,
        requestDigest: REQUEST_DIGEST,
        idempotencyKeyDigest: null,
        dispatchTargetDigest: 'f'.repeat(64),
        expectedEffectKind: 'unknown',
        expectedResource: null,
        attempt: 1,
        controlEpoch: 0,
        authorityCheckpointId: 'effect-authority-checkpoint-1',
      }),
      controllerId: 'android-controller-1',
      controllerContractVersion: 1,
      capabilityDigest: CAPABILITY_DIGEST,
      action: Object.freeze({ kind: 'input_text', text: 'private draft text' }),
      actionDigest,
      beforeObservation: Object.freeze({
        observationId: 'observation-before-1',
        digest: beforeObservationDigest,
        appId: 'notes',
        windowId: 'note-editor',
      }),
      claimedAt: 100,
      createdAt,
      expiresAt,
    }),
    handoffRef: Object.freeze({
      version: 1,
      effectRunId,
      executionRunId,
      effectId,
      externalHandleId,
      toolCallId,
      controlEpoch: 0,
      handoffId,
      controllerId: 'android-controller-1',
      controllerContractVersion: 1,
      capabilityDigest: CAPABILITY_DIGEST,
      actionDigest,
      beforeObservationId: 'observation-before-1',
      beforeObservationDigest,
      expiresAt,
    }),
    handle: Object.freeze({
      id: externalHandleId,
      runId: effectRunId,
      effectId,
      locator,
      sourceToolNameDigest: TOOL_NAME_DIGEST,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      lastAttemptedAt: createdAt,
      lastVerifiedAt: createdAt,
    }),
    checkpoint: Object.freeze({
      id: `mobile-wait-${HANDOFF_SUFFIX}`,
      runId: effectRunId,
      sequence: 3,
      taskId: executionRunId,
      goalId: null,
      phase: 'work',
      boundary: 'waiting_external',
      stateRefId: handoffId,
      stateDigest: REQUEST_DIGEST,
      resumeStrategy: 'reconcile_first',
      approvalState: 'granted',
      permissionState: 'granted',
      controlEpoch: 0,
      createdAt,
    }),
    run: Object.freeze({
      id: effectRunId,
      conversationId: 'conversation-mobile-1',
      threadId: 'conversation-mobile-1',
      taskId: executionRunId,
      goalId: null,
      requestMessageId: toolCallId,
      durabilityClass: 'external_durable_operation',
      requestedCapability: 'coordinate',
      executionSurface: 'native_tool',
      status: 'waiting',
      resumeStrategy: 'reconcile_first',
      approvalState: 'granted',
      permissionState: 'granted',
      inputDigest: REQUEST_DIGEST,
      modelConfigDigest: CONTRACT_DIGEST,
      retryCount: 0,
      nextRetryPolicy: 'reconcile_before_retry',
      controlEpoch: 0,
      createdAt: 90,
      updatedAt: createdAt,
      terminalAt: null,
    }),
  });
}

export function createMobileControllerCapabilityFixture(
  overrides: Partial<MobileControllerCapability> = {},
): MobileControllerCapability {
  return {
    version: 1,
    controllerId: 'android-controller-1',
    controllerContractVersion: 1,
    capabilityDigest: CAPABILITY_DIGEST,
    policyAdmissionDigest: `sha256:${'f'.repeat(64)}`,
    environmentClass: 'sandbox',
    supportedActionKinds: ['activate', 'input_text', 'back'],
    allowedAppIds: [],
    observationEvidence: ['screenshot', 'window_identity', 'result_code'],
    outcomeDeliveryModes: ['deferred'],
    normalizedCoordinateScale: 1_000,
    maxPendingActions: 1,
    maxPayloadBytes: 16_384,
    timeoutMs: 10_000,
    ...overrides,
  };
}

export function createMobileControllerOutcomeFixture(
  overrides: Partial<MobileControllerOutcome> = {},
): MobileControllerOutcome {
  const handoff = createPersistedMobileControllerHandoffFixture().handoffRef;
  return {
    version: 1,
    outcomeId: `mco_${'2'.repeat(32)}`,
    handoffId: handoff.handoffId,
    controllerId: handoff.controllerId,
    capabilityDigest: handoff.capabilityDigest,
    correlation: {
      runId: handoff.effectRunId,
      effectId: handoff.effectId,
      executionRunId: handoff.executionRunId,
      toolCallId: handoff.toolCallId,
    },
    executionState: 'completed',
    effectState: 'applied',
    verificationState: 'verified',
    observableDelta: 'changed',
    reasonCode: 'completed',
    beforeObservationId: handoff.beforeObservationId,
    afterObservation: {
      observationId: 'observation-after-1',
      digest: `sha256:${'9'.repeat(64)}`,
      appId: 'notes',
      windowId: 'editor',
    },
    stabilization: { durationMs: 250, sampleCount: 2 },
    observedAt: 200,
    ...overrides,
  };
}

export async function createMobileControllerSettlementFixture(
  kind: MobileControllerOutcomeSettlementResult['kind'] = 'settled',
): Promise<MobileControllerOutcomeSettlementResult> {
  const handoff = createPersistedMobileControllerHandoffFixture().handoffRef;
  const outcome = createMobileControllerOutcomeFixture();
  const content = JSON.stringify({ outcomeId: outcome.outcomeId, effectState: 'applied' });
  const receipt = await buildStructuredToolEffectReceipt({
    toolCallId: handoff.toolCallId,
    toolName: 'mobile_ui_action',
    executionRunId: handoff.executionRunId,
    dispatchRunId: handoff.effectRunId,
    executionState: 'completed',
    effectKind: 'unknown',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: handoff.actionDigest,
    resultText: content,
    recordedAt: outcome.observedAt,
  });
  return {
    kind,
    handoff,
    outcome,
    receipt,
    toolMessage: {
      version: 1,
      toolCallId: handoff.toolCallId,
      status: 'completed',
      content,
    },
    requiresReconciliation: false,
    settledAt: outcome.observedAt,
  };
}
