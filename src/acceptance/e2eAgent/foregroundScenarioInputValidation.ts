// ---------------------------------------------------------------------------
// Kavi — Foreground scenario input validation
// ---------------------------------------------------------------------------
// The scenario driver's contract checks, run before a scenario touches any
// product state.
// ---------------------------------------------------------------------------

import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import type { ForegroundScenarioDriverInput } from './foregroundScenarioDriverTypes';

const FOREGROUND_PRODUCT_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

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
    if (
      turn.steer !== undefined &&
      (!Number.isSafeInteger(turn.steer.afterToolResults) ||
        turn.steer.afterToolResults <= 0 ||
        !turn.steer.content.trim())
    ) {
      throw new Error(`turns[${index}].steer needs a positive tool-result count and text.`);
    }
  }
}
