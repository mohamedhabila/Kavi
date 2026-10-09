// ---------------------------------------------------------------------------
// Kavi — Foreground scenario input validation
// ---------------------------------------------------------------------------
// The scenario driver's contract checks, run before a scenario touches any
// product state.
// ---------------------------------------------------------------------------

import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import { E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES } from './e2eTraceMemoryPolicy';
import {
  resolveForegroundScenarioProviderOutcomes,
  type ForegroundScenarioDriverInput,
} from './foregroundScenarioDriverTypes';

const FOREGROUND_PRODUCT_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
const PROVIDER_OUTCOME_EVIDENCE_VALUES = new Set(E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES);

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be empty.`);
  return trimmed;
}

function validatePositiveNumber(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function validateRequiredPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function validateAllowedToolNames(
  allowedToolNames: ReadonlyArray<string> | undefined,
  fieldName: string,
): void {
  if (
    allowedToolNames !== undefined &&
    (allowedToolNames.length === 0 ||
      new Set(allowedToolNames).size !== allowedToolNames.length ||
      allowedToolNames.some(
        (name) =>
          typeof name !== 'string' ||
          !name.trim() ||
          name !== name.trim() ||
          !FOREGROUND_PRODUCT_TOOL_NAMES.has(name),
      ))
  ) {
    throw new Error(`${fieldName} must contain unique canonical tool names.`);
  }
}

/** Reject a malformed scenario before any product state is touched. */
export function validateForegroundScenarioInput(input: ForegroundScenarioDriverInput): void {
  const conversationId = requireTrimmed(input.conversationId, 'conversationId');
  if (conversationId !== input.conversationId) {
    throw new Error('conversationId must not contain surrounding whitespace.');
  }
  requireTrimmed(input.conversationTitle, 'conversationTitle');
  const providerId = requireTrimmed(input.provider.id, 'provider.id');
  if (providerId !== input.provider.id) {
    throw new Error('provider.id must not contain surrounding whitespace.');
  }
  requireTrimmed(input.provider.model, 'provider.model');
  if (!input.provider.enabled) throw new Error('provider must be enabled.');
  if (input.turns.length === 0) throw new Error('turns must contain at least one turn.');
  validatePositiveNumber(input.maxTokens, 'maxTokens');
  validateRequiredPositiveNumber(input.scenarioTimeoutMs, 'scenarioTimeoutMs');
  validatePositiveNumber(input.timeoutMs, 'timeoutMs');
  validatePositiveNumber(input.memoryTimeoutMs, 'memoryTimeoutMs');
  if (input.providerOutcomeEvidenceRequirements !== undefined) {
    const requirementKeys = new Set<string>();
    for (const requirement of input.providerOutcomeEvidenceRequirements) {
      const providerOutcomes = resolveForegroundScenarioProviderOutcomes(requirement);
      const hasSingleOutcome = requirement.providerOutcome !== undefined;
      const hasOutcomeSet = requirement.providerOutcomes !== undefined;
      if (
        !Number.isSafeInteger(requirement.turnIndex) ||
        requirement.turnIndex < 0 ||
        requirement.turnIndex >= input.turns.length ||
        hasSingleOutcome === hasOutcomeSet ||
        providerOutcomes.length === 0 ||
        new Set(providerOutcomes).size !== providerOutcomes.length ||
        providerOutcomes.some((outcome) => !PROVIDER_OUTCOME_EVIDENCE_VALUES.has(outcome))
      ) {
        throw new Error('providerOutcomeEvidenceRequirements contains an invalid requirement.');
      }
      const key = `${requirement.turnIndex}:${[...providerOutcomes].sort().join('|')}`;
      if (requirementKeys.has(key)) {
        throw new Error('providerOutcomeEvidenceRequirements must not contain duplicates.');
      }
      requirementKeys.add(key);
    }
  }
  validateAllowedToolNames(input.allowedToolNames, 'allowedToolNames');
  if (input.disableTools && input.allowedToolNames !== undefined) {
    throw new Error('disableTools and allowedToolNames cannot be configured together.');
  }
  for (const [index, turn] of input.turns.entries()) {
    if (!turn.content.trim() && !turn.attachments?.length) {
      throw new Error(`turns[${index}] must contain text or an attachment.`);
    }
    if (
      turn.lifecycleBefore !== undefined &&
      !['app_relaunch', 'new_conversation'].includes(turn.lifecycleBefore)
    ) {
      throw new Error(`turns[${index}].lifecycleBefore must be app_relaunch or new_conversation.`);
    }
    validatePositiveNumber(turn.maxTokens, `turns[${index}].maxTokens`);
    validatePositiveNumber(turn.timeoutMs, `turns[${index}].timeoutMs`);
    validatePositiveNumber(turn.delayBeforeMs, `turns[${index}].delayBeforeMs`);
    validateAllowedToolNames(turn.allowedToolNames, `turns[${index}].allowedToolNames`);
    if (input.disableTools && turn.allowedToolNames !== undefined) {
      throw new Error('disableTools and turn allowedToolNames cannot be configured together.');
    }
    if (turn.selectedMode !== undefined && !['agentic', 'chitchat'].includes(turn.selectedMode)) {
      throw new Error(`turns[${index}].selectedMode must be agentic or chitchat.`);
    }
  }
}
