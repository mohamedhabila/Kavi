import {
  decideProactiveAssistantAction,
  type ProactiveAssistantPolicyInput,
} from '../../../src/services/agents/proactiveAssistantPolicy';

function policyInput(
  overrides: Partial<ProactiveAssistantPolicyInput> = {},
): ProactiveAssistantPolicyInput {
  return {
    proposalId: 'proposal-1',
    initiative: 'assistant_initiated',
    preference: {
      disposition: 'accepted',
      source: 'explicit_memory',
      confidence: 0.95,
    },
    expectedBenefit: 0.95,
    relevanceConfidence: 0.95,
    userBurden: 0.1,
    missingRequiredInformation: false,
    readOnlyLookupCanResolve: false,
    effect: 'none',
    sensitive: false,
    requiresConsent: false,
    authorization: { kind: 'none', state: 'none' },
    ...overrides,
  };
}

describe('proactive assistant policy', () => {
  it('fails closed on malformed structural or confidence input', () => {
    expect(decideProactiveAssistantAction(policyInput({ proposalId: ' proposal-1' }))).toEqual({
      action: 'silence',
      reason: 'invalid_input',
    });
    expect(decideProactiveAssistantAction(policyInput({ expectedBenefit: Number.NaN }))).toEqual({
      action: 'silence',
      reason: 'invalid_input',
    });
    expect(
      decideProactiveAssistantAction(
        policyInput({ authorization: { kind: 'none', state: 'valid' } }),
      ),
    ).toEqual({ action: 'silence', reason: 'invalid_input' });
  });

  it.each(['none', 'read_only', 'reversible_local', 'reversible_remote', 'irreversible'] as const)(
    'never takes or proposes %s effects after rejection',
    (effect) => {
      expect(
        decideProactiveAssistantAction(
          policyInput({
            effect,
            preference: { disposition: 'rejected', source: 'current_turn', confidence: 1 },
            authorization: { kind: 'standing', state: 'valid' },
          }),
        ),
      ).toEqual({ action: 'silence', reason: 'user_rejected' });
    },
  );

  it('clarifies missing information for a user request', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({ initiative: 'user_requested', missingRequiredInformation: true }),
      ),
    ).toEqual({ action: 'clarify', reason: 'missing_required_information' });
  });

  it('uses a safe read-only lookup instead of burdening the user', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({
          initiative: 'user_requested',
          missingRequiredInformation: true,
          readOnlyLookupCanResolve: true,
          effect: 'reversible_remote',
        }),
      ),
    ).toEqual({ action: 'act', reason: 'safe_lookup', authorizedEffect: 'read_only' });
  });

  it('asks a proactive clarification only for strong explicit preference and value', () => {
    expect(
      decideProactiveAssistantAction(policyInput({ missingRequiredInformation: true })),
    ).toEqual({ action: 'clarify', reason: 'missing_required_information' });
    expect(
      decideProactiveAssistantAction(
        policyInput({
          missingRequiredInformation: true,
          preference: { disposition: 'unknown', source: 'none', confidence: 0 },
        }),
      ),
    ).toEqual({ action: 'silence', reason: 'insufficient_preference_confidence' });
  });

  it('requires consent for requested sensitive or irreversible effects', () => {
    for (const input of [
      policyInput({ initiative: 'user_requested', sensitive: true, effect: 'read_only' }),
      policyInput({ initiative: 'user_requested', effect: 'irreversible' }),
    ]) {
      expect(decideProactiveAssistantAction(input)).toEqual({
        action: 'request_consent',
        reason: 'consent_required',
      });
    }
  });

  it('suppresses proactive sensitive and irreversible proposals', () => {
    expect(decideProactiveAssistantAction(policyInput({ sensitive: true }))).toEqual({
      action: 'silence',
      reason: 'sensitive_proactive_suppressed',
    });
    expect(decideProactiveAssistantAction(policyInput({ effect: 'irreversible' }))).toEqual({
      action: 'silence',
      reason: 'irreversible_proactive_suppressed',
    });
  });

  it('acts on a requested reversible effect only with valid authorization', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({
          initiative: 'user_requested',
          effect: 'reversible_remote',
          authorization: { kind: 'single_use', state: 'valid' },
        }),
      ),
    ).toEqual({
      action: 'act',
      reason: 'authorized_action',
      authorizedEffect: 'reversible_remote',
    });
    expect(
      decideProactiveAssistantAction(
        policyInput({
          initiative: 'user_requested',
          effect: 'reversible_remote',
          authorization: { kind: 'single_use', state: 'expired' },
        }),
      ),
    ).toEqual({ action: 'request_consent', reason: 'consent_required' });
  });

  it('allows requested read-only work without manufacturing an authorization requirement', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({ initiative: 'user_requested', effect: 'read_only' }),
      ),
    ).toEqual({
      action: 'act',
      reason: 'authorized_action',
      authorizedEffect: 'read_only',
    });
  });

  it('acts proactively only under explicit standing authorization and the higher value bar', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({
          effect: 'reversible_local',
          authorization: { kind: 'standing', state: 'valid' },
        }),
      ),
    ).toEqual({
      action: 'act',
      reason: 'authorized_action',
      authorizedEffect: 'reversible_local',
    });
    expect(
      decideProactiveAssistantAction(
        policyInput({
          effect: 'reversible_local',
          authorization: { kind: 'single_use', state: 'valid' },
        }),
      ),
    ).toEqual({ action: 'suggest', reason: 'suggest_before_acting' });
  });

  it('asks proactive consent only when explicit preference and value justify the burden', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({ effect: 'reversible_remote', requiresConsent: true }),
      ),
    ).toEqual({ action: 'request_consent', reason: 'consent_required' });
    expect(
      decideProactiveAssistantAction(
        policyInput({
          effect: 'reversible_remote',
          requiresConsent: true,
          preference: { disposition: 'unknown', source: 'none', confidence: 0 },
        }),
      ),
    ).toEqual({ action: 'silence', reason: 'insufficient_preference_confidence' });
  });

  it('suggests only high-value low-burden help and otherwise stays silent', () => {
    expect(decideProactiveAssistantAction(policyInput())).toEqual({
      action: 'suggest',
      reason: 'helpful_suggestion',
    });
    expect(decideProactiveAssistantAction(policyInput({ expectedBenefit: 0.4 }))).toEqual({
      action: 'silence',
      reason: 'low_expected_value',
    });
    expect(decideProactiveAssistantAction(policyInput({ userBurden: 0.8 }))).toEqual({
      action: 'silence',
      reason: 'high_user_burden',
    });
  });

  it('accepts a persisted explicit request but never inferred preference for suggestions', () => {
    expect(
      decideProactiveAssistantAction(
        policyInput({
          preference: { disposition: 'accepted', source: 'explicit_request', confidence: 1 },
        }),
      ),
    ).toEqual({ action: 'suggest', reason: 'helpful_suggestion' });
    expect(
      decideProactiveAssistantAction(
        policyInput({
          preference: { disposition: 'accepted', source: 'inferred', confidence: 1 },
        }),
      ),
    ).toEqual({ action: 'silence', reason: 'insufficient_preference_confidence' });
  });
});
