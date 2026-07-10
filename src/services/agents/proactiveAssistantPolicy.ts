import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';

export type AssistantInitiative = 'user_requested' | 'assistant_initiated';
export type PreferenceDisposition = 'accepted' | 'rejected' | 'unknown';
export type PreferenceSource =
  | 'current_turn'
  | 'explicit_request'
  | 'explicit_memory'
  | 'inferred'
  | 'none';
export type ProposedEffect =
  | 'none'
  | 'read_only'
  | 'reversible_local'
  | 'reversible_remote'
  | 'irreversible';
export type ActionAuthorizationKind = 'none' | 'single_use' | 'standing';
export type ActionAuthorizationState = 'none' | 'valid' | 'expired' | 'revoked';

export interface ProactiveAssistantPolicyInput {
  proposalId: string;
  initiative: AssistantInitiative;
  preference: {
    disposition: PreferenceDisposition;
    source: PreferenceSource;
    confidence: number;
  };
  expectedBenefit: number;
  relevanceConfidence: number;
  userBurden: number;
  missingRequiredInformation: boolean;
  readOnlyLookupCanResolve: boolean;
  effect: ProposedEffect;
  sensitive: boolean;
  requiresConsent: boolean;
  authorization: {
    kind: ActionAuthorizationKind;
    state: ActionAuthorizationState;
  };
}

export type ProactiveAssistantDecision =
  | { action: 'silence'; reason: ProactiveAssistantSilenceReason }
  | { action: 'suggest'; reason: 'helpful_suggestion' | 'suggest_before_acting' }
  | { action: 'clarify'; reason: 'missing_required_information' }
  | { action: 'request_consent'; reason: 'consent_required' }
  | {
      action: 'act';
      reason: 'safe_lookup' | 'authorized_action';
      authorizedEffect: Exclude<ProposedEffect, 'none' | 'irreversible'>;
    };

export type ProactiveAssistantSilenceReason =
  | 'invalid_input'
  | 'user_rejected'
  | 'low_expected_value'
  | 'high_user_burden'
  | 'insufficient_preference_confidence'
  | 'sensitive_proactive_suppressed'
  | 'irreversible_proactive_suppressed';

const MIN_SUGGESTION_VALUE = 0.8;
const MIN_PROACTIVE_ACTION_VALUE = 0.9;
const MIN_EXPLICIT_PREFERENCE_CONFIDENCE = 0.9;
const MAX_SUGGESTION_BURDEN = 0.3;
const MAX_PROACTIVE_ACTION_BURDEN = 0.2;

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidInput(input: ProactiveAssistantPolicyInput): boolean {
  return (
    isExactDurableScopeId(input.proposalId) &&
    (input.initiative === 'user_requested' || input.initiative === 'assistant_initiated') &&
    (input.preference.disposition === 'accepted' ||
      input.preference.disposition === 'rejected' ||
      input.preference.disposition === 'unknown') &&
    (input.preference.source === 'current_turn' ||
      input.preference.source === 'explicit_request' ||
      input.preference.source === 'explicit_memory' ||
      input.preference.source === 'inferred' ||
      input.preference.source === 'none') &&
    isUnitInterval(input.preference.confidence) &&
    isUnitInterval(input.expectedBenefit) &&
    isUnitInterval(input.relevanceConfidence) &&
    isUnitInterval(input.userBurden) &&
    typeof input.missingRequiredInformation === 'boolean' &&
    typeof input.readOnlyLookupCanResolve === 'boolean' &&
    typeof input.sensitive === 'boolean' &&
    typeof input.requiresConsent === 'boolean' &&
    (input.effect === 'none' ||
      input.effect === 'read_only' ||
      input.effect === 'reversible_local' ||
      input.effect === 'reversible_remote' ||
      input.effect === 'irreversible') &&
    (input.authorization.kind === 'none' ||
      input.authorization.kind === 'single_use' ||
      input.authorization.kind === 'standing') &&
    (input.authorization.state === 'none' ||
      input.authorization.state === 'valid' ||
      input.authorization.state === 'expired' ||
      input.authorization.state === 'revoked') &&
    ((input.authorization.kind === 'none' && input.authorization.state === 'none') ||
      (input.authorization.kind !== 'none' && input.authorization.state !== 'none'))
  );
}

function hasExplicitAcceptedPreference(input: ProactiveAssistantPolicyInput): boolean {
  return (
    input.preference.disposition === 'accepted' &&
    (input.preference.source === 'current_turn' ||
      input.preference.source === 'explicit_request' ||
      input.preference.source === 'explicit_memory') &&
    input.preference.confidence >= MIN_EXPLICIT_PREFERENCE_CONFIDENCE
  );
}

function meetsSuggestionBar(input: ProactiveAssistantPolicyInput): boolean {
  return (
    input.expectedBenefit >= MIN_SUGGESTION_VALUE &&
    input.relevanceConfidence >= MIN_SUGGESTION_VALUE &&
    input.userBurden <= MAX_SUGGESTION_BURDEN
  );
}

function meetsProactiveActionBar(input: ProactiveAssistantPolicyInput): boolean {
  return (
    input.expectedBenefit >= MIN_PROACTIVE_ACTION_VALUE &&
    input.relevanceConfidence >= MIN_PROACTIVE_ACTION_VALUE &&
    input.userBurden <= MAX_PROACTIVE_ACTION_BURDEN &&
    hasExplicitAcceptedPreference(input)
  );
}

function lowValueSilenceReason(
  input: ProactiveAssistantPolicyInput,
): ProactiveAssistantSilenceReason {
  return input.userBurden > MAX_SUGGESTION_BURDEN ? 'high_user_burden' : 'low_expected_value';
}

export function decideProactiveAssistantAction(
  input: ProactiveAssistantPolicyInput,
): ProactiveAssistantDecision {
  if (!isValidInput(input)) return { action: 'silence', reason: 'invalid_input' };
  if (input.preference.disposition === 'rejected') {
    return { action: 'silence', reason: 'user_rejected' };
  }

  if (input.missingRequiredInformation) {
    if (input.readOnlyLookupCanResolve) {
      return { action: 'act', reason: 'safe_lookup', authorizedEffect: 'read_only' };
    }
    if (input.initiative === 'user_requested') {
      return { action: 'clarify', reason: 'missing_required_information' };
    }
    return hasExplicitAcceptedPreference(input) && meetsSuggestionBar(input)
      ? { action: 'clarify', reason: 'missing_required_information' }
      : { action: 'silence', reason: 'insufficient_preference_confidence' };
  }

  if (input.sensitive) {
    return input.initiative === 'user_requested'
      ? { action: 'request_consent', reason: 'consent_required' }
      : { action: 'silence', reason: 'sensitive_proactive_suppressed' };
  }
  if (input.effect === 'irreversible') {
    return input.initiative === 'user_requested'
      ? { action: 'request_consent', reason: 'consent_required' }
      : { action: 'silence', reason: 'irreversible_proactive_suppressed' };
  }

  if (input.effect === 'none') {
    if (input.initiative === 'assistant_initiated' && !hasExplicitAcceptedPreference(input)) {
      return { action: 'silence', reason: 'insufficient_preference_confidence' };
    }
    return meetsSuggestionBar(input)
      ? { action: 'suggest', reason: 'helpful_suggestion' }
      : { action: 'silence', reason: lowValueSilenceReason(input) };
  }

  if (input.effect === 'read_only' && !input.requiresConsent) {
    if (input.initiative === 'user_requested') {
      return { action: 'act', reason: 'authorized_action', authorizedEffect: 'read_only' };
    }
    if (meetsProactiveActionBar(input)) {
      return { action: 'act', reason: 'authorized_action', authorizedEffect: 'read_only' };
    }
    return meetsSuggestionBar(input)
      ? { action: 'suggest', reason: 'suggest_before_acting' }
      : { action: 'silence', reason: lowValueSilenceReason(input) };
  }

  const authorizationValid = input.authorization.state === 'valid';
  const consentRequired = input.requiresConsent || !authorizationValid;
  if (consentRequired) {
    if (input.initiative === 'user_requested') {
      return { action: 'request_consent', reason: 'consent_required' };
    }
    if (!hasExplicitAcceptedPreference(input)) {
      return { action: 'silence', reason: 'insufficient_preference_confidence' };
    }
    return meetsSuggestionBar(input)
      ? { action: 'request_consent', reason: 'consent_required' }
      : { action: 'silence', reason: lowValueSilenceReason(input) };
  }

  if (input.initiative === 'user_requested') {
    return { action: 'act', reason: 'authorized_action', authorizedEffect: input.effect };
  }
  if (input.authorization.kind === 'standing' && meetsProactiveActionBar(input)) {
    return { action: 'act', reason: 'authorized_action', authorizedEffect: input.effect };
  }
  return meetsSuggestionBar(input)
    ? { action: 'suggest', reason: 'suggest_before_acting' }
    : { action: 'silence', reason: lowValueSilenceReason(input) };
}
