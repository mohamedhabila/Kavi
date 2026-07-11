import type {
  RequestDecisionReason,
  RequestFrame,
  RequiredRequestInformation,
} from './requestFrame';

export type RequestPolicyDisposition = 'allowed' | 'approval_required' | 'prohibited';
export type RequestPermissionState = 'not_required' | 'granted' | 'missing';

const REQUEST_POLICY_DISPOSITIONS: ReadonlyArray<RequestPolicyDisposition> = [
  'allowed',
  'approval_required',
  'prohibited',
];
const REQUEST_PERMISSION_STATES: ReadonlyArray<RequestPermissionState> = [
  'not_required',
  'granted',
  'missing',
];

export interface RequestDecisionPolicyInput {
  frame: RequestFrame;
  requiredInformation: ReadonlyArray<RequiredRequestInformation>;
  policyDisposition: RequestPolicyDisposition;
  permissionState: RequestPermissionState;
  awaitingExternalOperation: boolean;
}

const INFORMATION_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

const RESOLUTION_BY_AUTHORITY = {
  user: 'user_provided',
  memory: 'memory_supported',
  tool: 'tool_observed',
  policy: 'policy_granted',
} as const;

function validateRequiredInformation(
  entries: ReadonlyArray<RequiredRequestInformation>,
): ReadonlyArray<RequiredRequestInformation> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!INFORMATION_KEY_PATTERN.test(entry.key)) {
      throw new Error('request_information_key_invalid');
    }
    if (keys.has(entry.key)) {
      throw new Error('request_information_key_duplicate');
    }
    keys.add(entry.key);
    if (
      entry.resolution !== 'unresolved' &&
      entry.resolution !== RESOLUTION_BY_AUTHORITY[entry.authority]
    ) {
      throw new Error('request_information_resolution_authority_mismatch');
    }
  }
  return entries.map((entry) => ({ ...entry }));
}

function withDecision(
  frame: RequestFrame,
  requiredInformation: ReadonlyArray<RequiredRequestInformation>,
  action: RequestFrame['decision']['action'],
  reason: RequestDecisionReason,
): RequestFrame {
  return {
    ...frame,
    requiredInformation,
    decision: { action, reason },
  };
}

export function resolveRequestDecision(input: RequestDecisionPolicyInput): RequestFrame {
  const requiredInformation = validateRequiredInformation(input.requiredInformation);
  if (input.frame.input.kind === 'empty') {
    return withDecision(input.frame, requiredInformation, 'clarify', 'missing_input');
  }
  if (input.frame.decision.reason === 'punctuation_only') {
    return withDecision(input.frame, requiredInformation, 'clarify', 'punctuation_only');
  }
  if (input.policyDisposition === 'prohibited') {
    return withDecision(input.frame, requiredInformation, 'decline', 'prohibited');
  }
  if (input.policyDisposition === 'approval_required') {
    return withDecision(input.frame, requiredInformation, 'consent', 'authorization_required');
  }
  if (input.permissionState === 'missing') {
    return withDecision(input.frame, requiredInformation, 'consent', 'permission_missing');
  }

  const unresolved = requiredInformation.filter((entry) => entry.resolution === 'unresolved');
  if (
    unresolved.some(
      (entry) => entry.authority === 'policy' && entry.requiredFor === 'authorization',
    )
  ) {
    return withDecision(input.frame, requiredInformation, 'consent', 'authorization_required');
  }
  if (unresolved.some((entry) => entry.authority === 'user')) {
    return withDecision(
      input.frame,
      requiredInformation,
      'clarify',
      'required_information_missing',
    );
  }
  if (unresolved.some((entry) => entry.authority === 'policy')) {
    return withDecision(
      input.frame,
      requiredInformation,
      'decline',
      'policy_information_unavailable',
    );
  }
  if (input.awaitingExternalOperation) {
    return withDecision(input.frame, requiredInformation, 'wait', 'waiting_for_async');
  }
  if (unresolved.length > 0) {
    return withDecision(input.frame, requiredInformation, 'act', 'information_lookup_required');
  }
  return withDecision(input.frame, requiredInformation, 'act', 'requirements_resolved');
}

/**
 * Returns whether the persisted decision is reachable through the canonical policy.
 * Policy, permission, and external-operation signals are not stored in RequestFrame, so
 * they remain unknown here; one valid external context is enough to preserve the decision.
 */
export function requestDecisionIsPolicyReachable(frame: RequestFrame): boolean {
  if (frame.decision.reason === 'actionable_input') {
    return (
      frame.decision.action === 'act' &&
      frame.input.kind !== 'empty' &&
      frame.requiredInformation.length === 0
    );
  }

  try {
    for (const policyDisposition of REQUEST_POLICY_DISPOSITIONS) {
      for (const permissionState of REQUEST_PERMISSION_STATES) {
        for (const awaitingExternalOperation of [false, true]) {
          const resolved = resolveRequestDecision({
            frame,
            requiredInformation: frame.requiredInformation,
            policyDisposition,
            permissionState,
            awaitingExternalOperation,
          });
          if (
            resolved.decision.action === frame.decision.action &&
            resolved.decision.reason === frame.decision.reason
          ) {
            return true;
          }
        }
      }
    }
  } catch {
    return false;
  }

  return false;
}
