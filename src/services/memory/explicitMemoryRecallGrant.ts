import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { CANONICAL_SELF_MEMORY_SUBJECT } from './memorySubjectIdentity';
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

type ExplicitMemoryRecallGrantIdentity = {
  currentUserMessageId: string;
  currentUserMessageText: string;
  executionRunId: string;
  toolCallId: string;
  agentRunId: string | null;
  scope: RequiredMemoryAccessScopeIdentity;
};

/**
 * Evidence that the person's current message asks for one sensitive subject and
 * predicate: either the typed object a provider fills in, or just the words of the
 * message that ask for the relation, with everything else taken from code-owned values.
 */
export type ExplicitMemoryRecallGrantRequest = ExplicitMemoryRecallGrantIdentity &
  (
    | { explicitRequestEvidence: unknown }
    | { relationQuote: unknown; requestedSubject: unknown; requestedPredicate: unknown }
  );

/** Why a request could not authorize sensitive recall; returned to the caller to correct. */
export type ExplicitMemoryRecallGrantFailure =
  | 'request_identity_invalid'
  | 'evidence_malformed'
  | 'subject_missing'
  | 'predicate_missing'
  | 'relation_quote_missing'
  | 'source_message_mismatch'
  | 'evidence_quote_not_in_message'
  | 'subject_quote_mismatch'
  | 'subject_not_in_message'
  | 'relation_quote_not_in_message'
  | 'already_used';

type NormalizedRecallEvidence = {
  sourceMessageId: unknown;
  evidenceQuote: string;
  subject: { kind: 'self' } | { kind: 'named'; label: string };
  subjectQuote: string | null;
  predicate: string;
  relationQuote: string;
};

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
  const issued = issueExplicitMemoryRecallGrant(request);
  return 'grant' in issued ? issued.grant : null;
}

/** Issue one-use sensitive-recall authority, or say exactly why the request does not grant it. */
export function issueExplicitMemoryRecallGrant(
  request: ExplicitMemoryRecallGrantRequest,
): { grant: ExplicitMemoryRecallGrant } | { failure: ExplicitMemoryRecallGrantFailure } {
  try {
    if (
      !isExactMemoryProvenanceId(request.currentUserMessageId) ||
      typeof request.currentUserMessageText !== 'string' ||
      !isExactMemoryProvenanceId(request.executionRunId) ||
      !isExactMemoryProvenanceId(request.toolCallId) ||
      !exactNullableProvenanceId(request.agentRunId)
    ) {
      return { failure: 'request_identity_invalid' };
    }
    const evidence =
      'explicitRequestEvidence' in request
        ? decodeTypedEvidence(request.explicitRequestEvidence)
        : buildCodeOwnedEvidence(request);
    if ('failure' in evidence) return evidence;
    const target = bindRequestEvidence(
      evidence,
      request.currentUserMessageId,
      request.currentUserMessageText,
    );
    if ('failure' in target) return target;
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
      return { failure: 'already_used' };
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
    return { grant };
  } catch {
    return { failure: 'request_identity_invalid' };
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

/** The typed object a provider fills in; every field must be present and exact. */
function decodeTypedEvidence(
  raw: unknown,
): NormalizedRecallEvidence | { failure: ExplicitMemoryRecallGrantFailure } {
  if (!isPlainRecord(raw) || !hasExactFields(raw, EVIDENCE_FIELDS)) {
    return { failure: 'evidence_malformed' };
  }
  if (raw.version !== EXPLICIT_MEMORY_RECALL_EVIDENCE_VERSION) {
    return { failure: 'evidence_malformed' };
  }
  const evidenceQuote = exactString(raw.evidence_quote, 600);
  const predicate = exactString(raw.predicate, 80);
  const subjectQuote = exactString(raw.subject_quote, 160);
  const relationQuote = exactString(raw.relation_quote, 200);
  const subject = decodeSubjectRef(raw.subject_ref);
  if (!evidenceQuote || !predicate || !subjectQuote || !relationQuote || !subject) {
    return { failure: 'evidence_malformed' };
  }
  return {
    sourceMessageId: raw.source_message_id,
    evidenceQuote,
    subject,
    subjectQuote,
    predicate,
    relationQuote,
  };
}

/**
 * The simple form: the provider names only the words that ask for the relation. The
 * message, its id, the subject and the predicate are the code-owned request and the
 * recall's own filters, so nothing else has to be copied.
 */
function buildCodeOwnedEvidence(request: {
  currentUserMessageId: string;
  currentUserMessageText: string;
  relationQuote: unknown;
  requestedSubject: unknown;
  requestedPredicate: unknown;
}): NormalizedRecallEvidence | { failure: ExplicitMemoryRecallGrantFailure } {
  const subjectLabel = exactString(request.requestedSubject, 80);
  if (!subjectLabel) return { failure: 'subject_missing' };
  const predicate = exactString(request.requestedPredicate, 80);
  if (!predicate) return { failure: 'predicate_missing' };
  const relationQuote = exactString(request.relationQuote, 200);
  if (!relationQuote) return { failure: 'relation_quote_missing' };
  const self = subjectLabel === CANONICAL_SELF_MEMORY_SUBJECT;
  return {
    sourceMessageId: request.currentUserMessageId,
    evidenceQuote: request.currentUserMessageText,
    subject: self ? { kind: 'self' } : { kind: 'named', label: subjectLabel },
    // The person is the subject of their own message in any language; only a named
    // subject has a label that must appear in it.
    subjectQuote: self ? null : subjectLabel,
    predicate,
    relationQuote,
  };
}

function bindRequestEvidence(
  evidence: NormalizedRecallEvidence,
  currentUserMessageId: string,
  currentUserMessageText: string,
):
  | Readonly<{ subject: string; predicate: string }>
  | { failure: ExplicitMemoryRecallGrantFailure } {
  if (evidence.sourceMessageId !== currentUserMessageId) {
    return { failure: 'source_message_mismatch' };
  }
  if (!evidence.evidenceQuote || !currentUserMessageText.includes(evidence.evidenceQuote)) {
    return { failure: 'evidence_quote_not_in_message' };
  }
  if (evidence.subject.kind === 'named' && evidence.subjectQuote !== evidence.subject.label) {
    return { failure: 'subject_quote_mismatch' };
  }
  if (evidence.subjectQuote !== null && !evidence.evidenceQuote.includes(evidence.subjectQuote)) {
    return { failure: 'subject_not_in_message' };
  }
  if (!evidence.evidenceQuote.includes(evidence.relationQuote)) {
    return { failure: 'relation_quote_not_in_message' };
  }
  return Object.freeze({
    subject:
      evidence.subject.kind === 'self' ? CANONICAL_SELF_MEMORY_SUBJECT : evidence.subject.label,
    predicate: evidence.predicate,
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
