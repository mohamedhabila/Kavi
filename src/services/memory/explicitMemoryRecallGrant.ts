import {
  isExactMemoryScopeId,
  requireMemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from './memoryScopeIdentity';

/**
 * Opaque, one-use authority for exposing one sensitive predicate to one user
 * request. The binding lives only in this module's WeakMap, so copying or
 * reconstructing the visible object cannot manufacture authority.
 */
export interface ExplicitMemoryRecallGrant {
  readonly kind: 'explicit_memory_recall_grant';
}

interface ExplicitMemoryRecallGrantBinding {
  currentUserMessageId: string;
  currentUserMessageText: string;
  executionRunId: string;
  agentRunId: string | null;
  scope: RequiredMemoryAccessScopeIdentity;
  requestedSubject: string;
  requestedPredicate: string;
  subjectKey: string;
  predicateKey: string;
}

export interface ExplicitMemoryRecallGrantRequest {
  currentUserMessageId: string;
  currentUserMessageText: string;
  executionRunId: string;
  agentRunId: string | null;
  scope: RequiredMemoryAccessScopeIdentity;
}

export interface ExplicitMemoryRecallGrantValidation {
  grant: ExplicitMemoryRecallGrant | undefined;
  currentUserMessageId: string | undefined;
  currentUserMessageText: string | undefined;
  executionRunId: string | undefined;
  agentRunId: string | null | undefined;
  scope: RequiredMemoryAccessScopeIdentity;
  subject: unknown;
  predicate: unknown;
  all: unknown;
}

const grantBindings = new WeakMap<object, ExplicitMemoryRecallGrantBinding>();
const LABEL_PATTERN = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.:'’/+ -]{0,78}[\p{L}\p{N}_])?$/u;

function exactLabel(value: string): string | null {
  const trimmed = value.trim();
  const normalized = trimmed.normalize('NFKC');
  if (!trimmed || trimmed !== value || trimmed.length > 80 || !LABEL_PATTERN.test(normalized)) {
    return null;
  }
  return trimmed;
}

function exactRecallLabelKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = exactLabel(value);
  return label
    ? label
        .normalize('NFKC')
        .toLowerCase()
        .split(/[ _-]+/u)
        .join('\u0000')
    : null;
}

function unquoteExactLabel(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '`' && last === '`') || (first === '"' && last === '"')) {
      return exactLabel(trimmed.slice(1, -1));
    }
  }
  return exactLabel(trimmed);
}

function stripOneTerminalPunctuation(value: string): string {
  return /[.?!]$/u.test(value) ? value.slice(0, -1) : value;
}

/**
 * Deliberately narrow request grammar. If product code cannot derive exactly
 * one subject and predicate from the raw current-user message, no grant exists
 * and recall stays on the automatic-prompt sensitivity policy.
 */
export function deriveExplicitMemoryRecallTarget(
  currentUserMessageText: string,
): Readonly<{ subject: string; predicate: string }> | null {
  if (
    typeof currentUserMessageText !== 'string' ||
    currentUserMessageText !== currentUserMessageText.trim() ||
    currentUserMessageText.length === 0 ||
    currentUserMessageText.length > 500 ||
    /[\r\n\p{C}]/u.test(currentUserMessageText)
  ) {
    return null;
  }
  const text = stripOneTerminalPunctuation(currentUserMessageText);
  if (/[.?!]/u.test(text)) return null;

  const coordinate = text.match(
    /^(?:please +)?(?:recall|retrieve|show me|tell me|what do you remember about) +(?:the +)?predicate +(.+?) +(?:for|about) +(?:the +)?subject +(.+)$/iu,
  );
  if (coordinate) {
    const predicate = unquoteExactLabel(coordinate[1] ?? '');
    const subject = unquoteExactLabel(coordinate[2] ?? '');
    return subject && predicate ? Object.freeze({ subject, predicate }) : null;
  }

  const self = text.match(
    /^(?:please +)?(?:what (?:is|was)|what(?:'s|\u2019s)|tell me|recall|retrieve|show me|do you remember|what do you remember about) +my +(.+)$/iu,
  );
  if (self) {
    const predicate = unquoteExactLabel(self[1] ?? '');
    return predicate ? Object.freeze({ subject: 'user', predicate }) : null;
  }

  const named = text.match(
    /^(?:please +)?(?:what (?:is|was)|what(?:'s|\u2019s)|tell me|recall|retrieve|show me|do you remember|what do you remember about) +(.+?)(?:'s|\u2019s) +(.+)$/iu,
  );
  if (!named) return null;
  const subject = unquoteExactLabel(named[1] ?? '');
  const predicate = unquoteExactLabel(named[2] ?? '');
  return subject && predicate ? Object.freeze({ subject, predicate }) : null;
}

function exactNullableId(value: unknown): value is string | null {
  return value === null || isExactMemoryScopeId(value);
}

export function createExplicitMemoryRecallGrant(
  request: ExplicitMemoryRecallGrantRequest,
): ExplicitMemoryRecallGrant | null {
  try {
    if (
      !isExactMemoryScopeId(request.currentUserMessageId) ||
      !isExactMemoryScopeId(request.executionRunId) ||
      !exactNullableId(request.agentRunId)
    ) {
      return null;
    }
    const target = deriveExplicitMemoryRecallTarget(request.currentUserMessageText);
    if (!target) return null;
    const subjectKey = exactRecallLabelKey(target.subject);
    const predicateKey = exactRecallLabelKey(target.predicate);
    if (!subjectKey || !predicateKey) return null;
    const scope = requireMemoryAccessScopeIdentity(request.scope);
    const grant = Object.freeze({
      kind: 'explicit_memory_recall_grant' as const,
    });
    grantBindings.set(grant, {
      currentUserMessageId: request.currentUserMessageId,
      currentUserMessageText: request.currentUserMessageText,
      executionRunId: request.executionRunId,
      agentRunId: request.agentRunId,
      scope,
      requestedSubject: target.subject,
      requestedPredicate: target.predicate,
      subjectKey,
      predicateKey,
    });
    return grant;
  } catch {
    return null;
  }
}

export function discardExplicitMemoryRecallGrant(
  grant: ExplicitMemoryRecallGrant | undefined,
): void {
  if (grant && typeof grant === 'object') grantBindings.delete(grant);
}

function sameScope(
  left: RequiredMemoryAccessScopeIdentity,
  right: RequiredMemoryAccessScopeIdentity,
): boolean {
  return (
    left.memoryOwnerId === right.memoryOwnerId &&
    left.memoryConversationId === right.memoryConversationId &&
    left.sourceThreadId === right.sourceThreadId &&
    left.personaId === right.personaId &&
    left.taskId === right.taskId
  );
}

/** Consumes authority on the first validation attempt, including a mismatch. */
export function consumeExplicitMemoryRecallGrant(
  validation: ExplicitMemoryRecallGrantValidation,
): boolean {
  const grant = validation.grant;
  if (!grant || typeof grant !== 'object') return false;
  const binding = grantBindings.get(grant);
  if (!binding) return false;
  grantBindings.delete(grant);
  const subjectKey = exactRecallLabelKey(validation.subject);
  const predicateKey = exactRecallLabelKey(validation.predicate);
  return (
    validation.all !== true &&
    subjectKey !== null &&
    subjectKey === binding.subjectKey &&
    predicateKey !== null &&
    predicateKey === binding.predicateKey &&
    validation.currentUserMessageId === binding.currentUserMessageId &&
    validation.currentUserMessageText === binding.currentUserMessageText &&
    validation.executionRunId === binding.executionRunId &&
    (validation.agentRunId ?? null) === binding.agentRunId &&
    sameScope(validation.scope, binding.scope)
  );
}
