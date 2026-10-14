import type {
  RequestDecisionReason,
  RequestFrame,
  RequiredRequestInformation,
} from './requestFrame';

export interface RequestDecisionPolicyInput {
  frame: RequestFrame;
  requiredInformation: ReadonlyArray<RequiredRequestInformation>;
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

/**
 * Whether the request can be acted on: an empty input or information only the person can
 * give asks them; anything else acts, the model reading what it still needs with its tools.
 */
export function resolveRequestDecision(input: RequestDecisionPolicyInput): RequestFrame {
  const requiredInformation = validateRequiredInformation(input.requiredInformation);
  if (input.frame.input.kind === 'empty') {
    return withDecision(input.frame, requiredInformation, 'clarify', 'missing_input');
  }
  const unresolved = requiredInformation.filter((entry) => entry.resolution === 'unresolved');
  if (unresolved.some((entry) => entry.authority === 'user')) {
    return withDecision(
      input.frame,
      requiredInformation,
      'clarify',
      'required_information_missing',
    );
  }
  if (unresolved.length > 0) {
    return withDecision(input.frame, requiredInformation, 'act', 'information_lookup_required');
  }
  return withDecision(input.frame, requiredInformation, 'act', 'requirements_resolved');
}

/** Whether the persisted decision is the one the policy reaches for its frame. */
export function requestDecisionIsPolicyReachable(frame: RequestFrame): boolean {
  if (frame.decision.reason === 'actionable_input') {
    return (
      frame.decision.action === 'act' &&
      frame.input.kind !== 'empty' &&
      frame.requiredInformation.length === 0
    );
  }

  try {
    const resolved = resolveRequestDecision({
      frame,
      requiredInformation: frame.requiredInformation,
    });
    return (
      resolved.decision.action === frame.decision.action &&
      resolved.decision.reason === frame.decision.reason
    );
  } catch {
    return false;
  }
}
