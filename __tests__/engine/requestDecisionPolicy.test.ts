import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import {
  requestDecisionIsPolicyReachable,
  resolveRequestDecision,
} from '../../src/services/agents/requestDecisionPolicy';
import type { RequiredRequestInformation } from '../../src/services/agents/requestFrame';

function baseFrame() {
  return buildGraphEntryRequestFrame({
    text: 'Complete the requested work',
    attachmentCount: 0,
    continuation: 'new',
  });
}

function decide(overrides: Partial<Parameters<typeof resolveRequestDecision>[0]> = {}) {
  return resolveRequestDecision({
    frame: baseFrame(),
    requiredInformation: [],
    ...overrides,
  });
}

function required(
  authority: RequiredRequestInformation['authority'],
  resolution: RequiredRequestInformation['resolution'] = 'unresolved',
  requiredFor: RequiredRequestInformation['requiredFor'] = 'execution',
): RequiredRequestInformation {
  return { key: `${authority}.target`, authority, requiredFor, resolution };
}

describe('request decision policy', () => {
  it('clarifies only information whose authority is the user', () => {
    const information = required('user');
    expect(decide({ requiredInformation: [information] })).toMatchObject({
      requiredInformation: [information],
      decision: { action: 'clarify', reason: 'required_information_missing' },
    });
  });

  it('uses safe lookup for unresolved memory or tool observations', () => {
    expect(
      decide({ requiredInformation: [required('memory'), required('tool')] }).decision,
    ).toEqual({ action: 'act', reason: 'information_lookup_required' });
  });

  // Consent, decline and wait outcomes forced a tool-less turn on a resumed run; the model
  // now reads what it still needs with its tools, and approval stays per concrete effect.
  it('acts on unresolved policy information instead of forcing a tool-less turn', () => {
    expect(
      decide({ requiredInformation: [required('policy', 'unresolved', 'authorization')] }).decision,
    ).toEqual({ action: 'act', reason: 'information_lookup_required' });
  });

  it('acts when every required item has matching authority evidence', () => {
    expect(
      decide({
        requiredInformation: [
          required('user', 'user_provided'),
          required('memory', 'memory_supported'),
          required('tool', 'tool_observed'),
          required('policy', 'policy_granted'),
        ],
      }).decision,
    ).toEqual({ action: 'act', reason: 'requirements_resolved' });
  });

  it('checks a persisted decision against the one the policy reaches', () => {
    const userInformation = required('user');
    expect(
      requestDecisionIsPolicyReachable({
        ...baseFrame(),
        requiredInformation: [userInformation],
        decision: { action: 'clarify', reason: 'required_information_missing' },
      }),
    ).toBe(true);
    expect(
      requestDecisionIsPolicyReachable({
        ...baseFrame(),
        requiredInformation: [userInformation],
        decision: { action: 'act', reason: 'requirements_resolved' },
      }),
    ).toBe(false);
  });

  it('clarifies an empty input', () => {
    const frame = buildGraphEntryRequestFrame({
      text: '',
      attachmentCount: 0,
      continuation: 'new',
    });
    expect(decide({ frame }).decision).toEqual({
      action: 'clarify',
      reason: 'missing_input',
    });
  });

  it.each([
    {
      requiredInformation: [{ ...required('user'), key: 'not valid' }],
      error: 'request_information_key_invalid',
    },
    {
      requiredInformation: [required('user'), required('user')],
      error: 'request_information_key_duplicate',
    },
    {
      requiredInformation: [required('memory', 'user_provided')],
      error: 'request_information_resolution_authority_mismatch',
    },
  ])('rejects malformed code-owned information: $error', ({ requiredInformation, error }) => {
    expect(() => decide({ requiredInformation })).toThrow(error);
  });
});
