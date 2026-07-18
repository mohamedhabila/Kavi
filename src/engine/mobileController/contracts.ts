import type { EffectDispatchIdentity } from '../../services/executionJournal/effectDispatchPolicy';
import type {
  ToolEffectDigest,
  ToolEffectVerificationState,
  ToolExecutionState,
} from '../../types/toolEffectReceipt';

export const MOBILE_UI_ACTION_TOOL_NAME = 'mobile_ui_action' as const;
export const MOBILE_CONTROLLER_CONTRACT_VERSION = 1 as const;

export const MOBILE_CONTROLLER_ENVIRONMENT_CLASSES = [
  'sandbox',
  'managed',
  'policy_approved',
] as const;
export type MobileControllerEnvironmentClass =
  (typeof MOBILE_CONTROLLER_ENVIRONMENT_CLASSES)[number];

export const MOBILE_CONTROLLER_ACTION_KINDS = [
  'activate',
  'double_tap',
  'long_press',
  'drag',
  'input_text',
  'keyboard_enter',
  'back',
  'home',
  'open_app',
  'scroll',
  'wait',
] as const;
export type MobileControllerActionKind = (typeof MOBILE_CONTROLLER_ACTION_KINDS)[number];

export const MOBILE_CONTROLLER_OBSERVATION_EVIDENCE = [
  'screenshot',
  'window_identity',
  'accessibility_snapshot',
  'hit_test',
  'result_code',
] as const;
export type MobileControllerObservationEvidence =
  (typeof MOBILE_CONTROLLER_OBSERVATION_EVIDENCE)[number];

export const MOBILE_CONTROLLER_OUTCOME_DELIVERY_MODES = ['synchronous', 'deferred'] as const;
export type MobileControllerOutcomeDeliveryMode =
  (typeof MOBILE_CONTROLLER_OUTCOME_DELIVERY_MODES)[number];

export interface MobileControllerCapability {
  readonly version: typeof MOBILE_CONTROLLER_CONTRACT_VERSION;
  readonly controllerId: string;
  readonly controllerContractVersion: number;
  readonly capabilityDigest: ToolEffectDigest;
  readonly policyAdmissionDigest: ToolEffectDigest;
  readonly environmentClass: MobileControllerEnvironmentClass;
  readonly supportedActionKinds: readonly MobileControllerActionKind[];
  readonly allowedAppIds: readonly string[];
  readonly observationEvidence: readonly MobileControllerObservationEvidence[];
  readonly outcomeDeliveryModes: readonly MobileControllerOutcomeDeliveryMode[];
  readonly normalizedCoordinateScale: number;
  readonly maxPendingActions: 1;
  readonly maxPayloadBytes: number;
  readonly timeoutMs: number;
}

export interface MobileControllerElementTarget {
  readonly kind: 'element';
  readonly observationId: string;
  readonly elementId: string;
}

export interface MobileControllerCoordinateTarget {
  readonly kind: 'coordinate';
  readonly observationId: string;
  readonly x: number;
  readonly y: number;
}

export type MobileControllerTarget =
  | MobileControllerElementTarget
  | MobileControllerCoordinateTarget;

type TargetedMobileControllerAction = Readonly<{
  kind: 'activate' | 'double_tap' | 'long_press';
  target: MobileControllerTarget;
}>;

export type MobileControllerAction =
  | TargetedMobileControllerAction
  | Readonly<{
      kind: 'drag';
      start: MobileControllerCoordinateTarget;
      end: MobileControllerCoordinateTarget;
    }>
  | Readonly<{ kind: 'input_text'; text: string }>
  | Readonly<{ kind: 'keyboard_enter' | 'back' | 'home' }>
  | Readonly<{ kind: 'open_app'; appId: string }>
  | Readonly<{ kind: 'scroll'; direction: 'up' | 'down' | 'left' | 'right' }>
  | Readonly<{ kind: 'wait'; durationMs: number }>;

export interface MobileControllerObservationRef {
  readonly observationId: string;
  readonly digest: ToolEffectDigest;
  readonly appId?: string;
  readonly windowId?: string;
}

export interface MobileControllerPendingHandoff {
  readonly version: typeof MOBILE_CONTROLLER_CONTRACT_VERSION;
  readonly handoffId: string;
  readonly claimToken: string;
  readonly dispatchIdentity: Readonly<EffectDispatchIdentity>;
  readonly controllerId: string;
  readonly controllerContractVersion: number;
  readonly capabilityDigest: ToolEffectDigest;
  readonly action: MobileControllerAction;
  readonly actionDigest: ToolEffectDigest;
  readonly beforeObservation: MobileControllerObservationRef;
  readonly claimedAt: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export const MOBILE_CONTROLLER_OBSERVABLE_DELTAS = ['changed', 'unchanged', 'unknown'] as const;
export type MobileControllerObservableDelta = (typeof MOBILE_CONTROLLER_OBSERVABLE_DELTAS)[number];

export const MOBILE_CONTROLLER_REASON_CODES = [
  'completed',
  'execution_failed',
  'timed_out',
  'cancelled',
  'permission_denied',
  'target_unavailable',
  'stale_observation',
  'observation_unavailable',
  'effect_unknown',
  'controller_unavailable',
] as const;
export type MobileControllerReasonCode = (typeof MOBILE_CONTROLLER_REASON_CODES)[number];

export type MobileControllerTerminalEffectState = 'applied' | 'failed' | 'cancelled' | 'unknown';

export interface MobileControllerOutcomeCorrelation {
  readonly runId: string;
  readonly effectId: string;
  readonly executionRunId: string;
  readonly toolCallId: string;
}

export interface MobileControllerStabilizationEvidence {
  readonly durationMs: number;
  readonly sampleCount: number;
}

export interface MobileControllerOutcome {
  readonly version: typeof MOBILE_CONTROLLER_CONTRACT_VERSION;
  readonly outcomeId: string;
  readonly handoffId: string;
  readonly controllerId: string;
  readonly capabilityDigest: ToolEffectDigest;
  readonly correlation: MobileControllerOutcomeCorrelation;
  readonly executionState: ToolExecutionState;
  readonly effectState: MobileControllerTerminalEffectState;
  readonly verificationState: ToolEffectVerificationState;
  readonly observableDelta: MobileControllerObservableDelta;
  readonly reasonCode?: MobileControllerReasonCode;
  readonly beforeObservationId: string;
  readonly afterObservation?: MobileControllerObservationRef;
  readonly stabilization?: MobileControllerStabilizationEvidence;
  readonly observedAt: number;
}

export type MobileControllerAuditEvent =
  | Readonly<{
      type: 'mobile_controller_handoff_pending';
      handoffId: string;
      runId: string;
      executionRunId: string;
      effectId: string;
      toolCallId: string;
      controllerId: string;
      actionKind: MobileControllerActionKind;
      actionDigest: ToolEffectDigest;
      timestamp: number;
    }>
  | Readonly<{
      type: 'mobile_controller_outcome_settled';
      handoffId: string;
      outcomeId: string;
      runId: string;
      executionRunId: string;
      effectId: string;
      toolCallId: string;
      controllerId: string;
      actionKind: MobileControllerActionKind;
      actionDigest: ToolEffectDigest;
      executionState: ToolExecutionState;
      effectState: MobileControllerTerminalEffectState;
      verificationState: ToolEffectVerificationState;
      observableDelta: MobileControllerObservableDelta;
      timestamp: number;
    }>;
