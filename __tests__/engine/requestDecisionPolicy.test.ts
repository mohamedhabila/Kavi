import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { resolveRequestDecision } from '../../src/services/agents/requestDecisionPolicy';
import type { RequiredRequestInformation } from '../../src/services/agents/requestFrame';

function baseFrame() {
  return buildGraphEntryRequestFrame({
    text: 'Complete the requested work',
    attachmentCount: 0,
    mode: 'agentic',
    continuation: 'new',
  });
}

function decide(overrides: Partial<Parameters<typeof resolveRequestDecision>[0]> = {}) {
  return resolveRequestDecision({
    frame: baseFrame(),
    requiredInformation: [],
    policyDisposition: 'allowed',
    permissionState: 'not_required',
    awaitingExternalOperation: false,
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
  it.each([
    {
      input: { policyDisposition: 'prohibited' as const },
      expected: { action: 'decline', reason: 'prohibited' },
    },
    {
      input: { policyDisposition: 'approval_required' as const },
      expected: { action: 'consent', reason: 'authorization_required' },
    },
    {
      input: { permissionState: 'missing' as const },
      expected: { action: 'consent', reason: 'permission_missing' },
    },
    {
      input: { awaitingExternalOperation: true },
      expected: { action: 'wait', reason: 'waiting_for_async' },
    },
  ])('selects the closed $expected.action outcome', ({ input, expected }) => {
    expect(decide(input).decision).toEqual(expected);
  });

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

  it('requires consent for unresolved authorization policy', () => {
    expect(
      decide({ requiredInformation: [required('policy', 'unresolved', 'authorization')] }).decision,
    ).toEqual({ action: 'consent', reason: 'authorization_required' });
  });

  it('declines when non-authorization policy evidence is unavailable', () => {
    expect(decide({ requiredInformation: [required('policy')] }).decision).toEqual({
      action: 'decline',
      reason: 'policy_information_unavailable',
    });
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

  it('preserves structural empty-input clarification ahead of policy context', () => {
    const frame = buildGraphEntryRequestFrame({
      text: '',
      attachmentCount: 0,
      mode: 'agentic',
      continuation: 'new',
    });
    expect(decide({ frame, policyDisposition: 'prohibited' }).decision).toEqual({
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
