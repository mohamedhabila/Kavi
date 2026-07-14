import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import {
  requireMemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from './memoryScopeIdentity';

export const EXPLICIT_MEMORY_RECALL_EVIDENCE_VERSION = 1 as const;

/** Opaque one-use authority. Provider arguments cannot construct this value. */
export interface ExplicitMemoryRecallGrant {
  readonly kind: 'explicit_memory_recall_grant';
}

interface ExplicitMemoryRecallGrantBinding {
  currentUserMessageId: string;
  currentUserMessageText: string;
  executionRunId: string;
  toolCallId: string;
  agentRunId: string | null;
  scope: RequiredMemoryAccessScopeIdentity;
  requestedSubject: string;
  requestedPredicate: string;
  replayIdentity: string;
}

export interface ExplicitMemoryRecallGrantRequest {
  currentUserMessageId: string;
  currentUserMessageText: string;
  executionRunId: string;
  toolCallId: string;
  agentRunId: string | null;
  scope: RequiredMemoryAccessScopeIdentity;
  explicitRequestEvidence: unknown;
}

export interface ExplicitMemoryRecallGrantValidation {
  grant: ExplicitMemoryRecallGrant | undefined;
  currentUserMessageId: string | undefined;
  currentUserMessageText: string | undefined;
  executionRunId: string | undefined;
  toolCallId: string | undefined;
  agentRunId: string | null | undefined;
  scope: RequiredMemoryAccessScopeIdentity;
  subject: unknown;
  predicate: unknown;
  all: unknown;
}

const EVIDENCE_FIELDS = new Set([
  'version',
  'source_message_id',
  'evidence_quote',
  'subject_ref',
  'subject_quote',
  'predicate',
  'relation_quote',
]);
const grantBindings = new WeakMap<object, ExplicitMemoryRecallGrantBinding>();
const issuedReplayIdentities = new Set<string>();
const consumedReplayIdentities = new Set<string>();
const consumedReplayIdentityOrder: string[] = [];
const MAX_CONSUMED_REPLAY_IDENTITIES = 4_096;

export function createExplicitMemoryRecallGrant(
  request: ExplicitMemoryRecallGrantRequest,
): ExplicitMemoryRecallGrant | null {
  try {
    if (
      !isExactMemoryProvenanceId(request.currentUserMessageId) ||
      !isExactMemoryProvenanceId(request.executionRunId) ||
      !isExactMemoryProvenanceId(request.toolCallId) ||
      !exactNullableProvenanceId(request.agentRunId)
    ) {
      return null;
    }
    const target = bindExplicitRequestEvidence(
      request.explicitRequestEvidence,
      request.currentUserMessageId,
      request.currentUserMessageText,
    );
    if (!target) return null;
    const scope = requireMemoryAccessScopeIdentity(request.scope);
    const replayIdentity = JSON.stringify([
      request.executionRunId,
      request.toolCallId,
      request.currentUserMessageId,
      scope.memoryOwnerId,
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.personaId,
      scope.taskId,
    ]);
    if (
      issuedReplayIdentities.has(replayIdentity) ||
      consumedReplayIdentities.has(replayIdentity)
    ) {
      return null;
    }
    const grant = Object.freeze({ kind: 'explicit_memory_recall_grant' as const });
    grantBindings.set(grant, {
      currentUserMessageId: request.currentUserMessageId,
      currentUserMessageText: request.currentUserMessageText,
      executionRunId: request.executionRunId,
      toolCallId: request.toolCallId,
      agentRunId: request.agentRunId,
      scope,
      requestedSubject: target.subject,
      requestedPredicate: target.predicate,
      replayIdentity,
    });
    issuedReplayIdentities.add(replayIdentity);
    return grant;
  } catch {
    return null;
  }
}

export function discardExplicitMemoryRecallGrant(
  grant: ExplicitMemoryRecallGrant | undefined,
): void {
  if (!grant || typeof grant !== 'object') return;
  const binding = grantBindings.get(grant);
  if (!binding) return;
  grantBindings.delete(grant);
  consumeReplayIdentity(binding.replayIdentity);
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
  consumeReplayIdentity(binding.replayIdentity);
  return (
    validation.all !== true &&
    validation.subject === binding.requestedSubject &&
    validation.predicate === binding.requestedPredicate &&
    validation.currentUserMessageId === binding.currentUserMessageId &&
    validation.currentUserMessageText === binding.currentUserMessageText &&
    validation.executionRunId === binding.executionRunId &&
    validation.toolCallId === binding.toolCallId &&
    (validation.agentRunId ?? null) === binding.agentRunId &&
    sameScope(validation.scope, binding.scope)
  );
}

export function resetExplicitMemoryRecallGrantStateForTests(): void {
  issuedReplayIdentities.clear();
  consumedReplayIdentities.clear();
  consumedReplayIdentityOrder.splice(0);
}

function bindExplicitRequestEvidence(
  raw: unknown,
  currentUserMessageId: string,
  currentUserMessageText: string,
): Readonly<{ subject: string; predicate: string }> | null {
  if (!isPlainRecord(raw) || !hasExactFields(raw, EVIDENCE_FIELDS)) return null;
  if (raw.version !== EXPLICIT_MEMORY_RECALL_EVIDENCE_VERSION) return null;
  if (raw.source_message_id !== currentUserMessageId) return null;
  const evidenceQuote = exactString(raw.evidence_quote, 600);
  const predicate = exactString(raw.predicate, 80);
  const subjectQuote = exactString(raw.subject_quote, 160);
  const relationQuote = exactString(raw.relation_quote, 200);
  const subject = decodeSubjectRef(raw.subject_ref);
  if (
    !evidenceQuote ||
    !predicate ||
    !subjectQuote ||
    !relationQuote ||
    !subject ||
    !currentUserMessageText.includes(evidenceQuote)
  ) {
    return null;
  }
  if (!evidenceQuote.includes(subjectQuote) || !evidenceQuote.includes(relationQuote)) {
    return null;
  }
  if (subject.kind === 'named' && subjectQuote !== subject.label) {
    return null;
  }
  return Object.freeze({
    subject: subject.kind === 'self' ? 'user' : subject.label,
    predicate,
  });
}

function decodeSubjectRef(
  raw: unknown,
): { kind: 'self' } | { kind: 'named'; label: string } | null {
  if (!isPlainRecord(raw)) return null;
  const keys = Object.keys(raw).sort().join(',');
  if (raw.kind === 'self') return keys === 'kind' ? { kind: 'self' } : null;
  if (raw.kind !== 'named' || keys !== 'kind,label') return null;
  const label = exactString(raw.label, 80);
  return label ? { kind: 'named', label } : null;
}

function consumeReplayIdentity(identity: string): void {
  issuedReplayIdentities.delete(identity);
  if (consumedReplayIdentities.has(identity)) return;
  consumedReplayIdentities.add(identity);
  consumedReplayIdentityOrder.push(identity);
  if (consumedReplayIdentityOrder.length <= MAX_CONSUMED_REPLAY_IDENTITIES) return;
  const expired = consumedReplayIdentityOrder.shift();
  if (expired) consumedReplayIdentities.delete(expired);
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

function exactNullableProvenanceId(value: unknown): value is string | null {
  return value === null || isExactMemoryProvenanceId(value);
}

function exactString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= maxLength
    ? value
    : null;
}

function hasExactFields(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
