export const MAX_AGENT_GOAL_USER_CONSTRAINTS = 8;
// Long-running tasks commonly carry a detailed acceptance contract in the
// opening turn. Keep that exact code-owned request intact without allowing an
// unbounded graph prompt.
export const MAX_AGENT_GOAL_USER_CONSTRAINT_CHARACTERS = 8192;

export type AgentGoalUserConstraint = Readonly<{
  text: string;
  sourceMessageId: string;
}>;

export type AgentGoalUserConstraintIntegrity = 'conflict';

export type PersistedAgentGoalUserConstraintState =
  | { state: 'absent' }
  | { state: 'canonical'; constraints: AgentGoalUserConstraint[] }
  | { state: 'conflict' };

export type AgentGoalUserConstraintTextResult =
  | { valid: true; text: string }
  | {
      valid: false;
      code: 'control_character' | 'empty' | 'not_string' | 'oversized' | 'unsupported';
    };

const UNSUPPORTED_CONTROL_PATTERN = /\p{C}/u;
const ALLOWED_FORMAT_CONTROL_PATTERN = /[\u0009\u000a\u200c\u200d]/gu;
const CARRIAGE_RETURN_PATTERN = /\r\n?/gu;
const SOURCE_MESSAGE_ID_PATTERN = /^[^\p{Z}\p{C}]{1,512}$/u;
const MEANINGFUL_CONSTRAINT_CONTENT_PATTERN = /[\p{L}\p{N}]/u;

function containsUnsupportedControl(value: string): boolean {
  return UNSUPPORTED_CONTROL_PATTERN.test(value.replace(ALLOWED_FORMAT_CONTROL_PATTERN, ''));
}

export function normalizeAgentGoalUserConstraintText(
  value: unknown,
): AgentGoalUserConstraintTextResult {
  if (typeof value !== 'string') return { valid: false, code: 'not_string' };
  const normalized = value.normalize('NFC').replace(CARRIAGE_RETURN_PATTERN, '\n');
  if (containsUnsupportedControl(normalized)) {
    return { valid: false, code: 'control_character' };
  }
  const text = normalized.trim();
  if (!text) return { valid: false, code: 'empty' };
  if (!MEANINGFUL_CONSTRAINT_CONTENT_PATTERN.test(text)) {
    return { valid: false, code: 'unsupported' };
  }
  if (Array.from(text).length > MAX_AGENT_GOAL_USER_CONSTRAINT_CHARACTERS) {
    return { valid: false, code: 'oversized' };
  }
  return { valid: true, text };
}

export function captureCurrentUserGoalConstraint(params: {
  currentUserMessage: Readonly<{ id: string; text: string }> | undefined;
}):
  | { captured: true; constraint: AgentGoalUserConstraint }
  | {
      captured: false;
      code: 'invalid_current_user_message' | 'missing_current_user_message';
      textCode?: Exclude<AgentGoalUserConstraintTextResult, { valid: true }>['code'];
    } {
  const source = params.currentUserMessage;
  if (!source || typeof source.id !== 'string' || !SOURCE_MESSAGE_ID_PATTERN.test(source.id)) {
    return { captured: false, code: 'missing_current_user_message' };
  }
  const normalized = normalizeAgentGoalUserConstraintText(source.text);
  if (!normalized.valid) {
    return {
      captured: false,
      code: 'invalid_current_user_message',
      textCode: normalized.code,
    };
  }
  return {
    captured: true,
    constraint: { text: normalized.text, sourceMessageId: source.id },
  };
}

export function readPersistedAgentGoalUserConstraintState(params: {
  value: unknown;
  allowedOnGoal: boolean;
}): PersistedAgentGoalUserConstraintState {
  if (params.value === undefined) return { state: 'absent' };
  if (!params.allowedOnGoal || !arePersistedAgentGoalUserConstraintsCanonical(params.value)) {
    return { state: 'conflict' };
  }
  return {
    state: 'canonical',
    constraints: params.value.map((constraint) => ({ ...constraint })),
  };
}

export function arePersistedAgentGoalUserConstraintsCanonical(
  value: unknown,
): value is AgentGoalUserConstraint[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AGENT_GOAL_USER_CONSTRAINTS)
    return false;
  const seen = new Set<string>();
  const sourceTexts = new Map<string, string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !== 'sourceMessageId,text' ||
      typeof record.sourceMessageId !== 'string' ||
      !SOURCE_MESSAGE_ID_PATTERN.test(record.sourceMessageId)
    ) {
      return false;
    }
    const normalized = normalizeAgentGoalUserConstraintText(record.text);
    const sourceText = sourceTexts.get(record.sourceMessageId);
    if (
      !normalized.valid ||
      normalized.text !== record.text ||
      seen.has(normalized.text) ||
      (sourceText !== undefined && sourceText !== normalized.text)
    ) {
      return false;
    }
    seen.add(normalized.text);
    sourceTexts.set(record.sourceMessageId, normalized.text);
  }
  return true;
}
