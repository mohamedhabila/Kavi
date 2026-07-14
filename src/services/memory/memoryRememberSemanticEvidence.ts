import type { EntityType } from './entities';
import type { MemoryRememberRequestEvidence } from './memoryRememberPersistence';
import { decodeSemanticFactProposals, type SemanticFactProposalV1 } from './semanticFactProposal';

const MEMORY_REMEMBER_SEMANTIC_EVIDENCE_FIELDS = new Set([
  'version',
  'subject_ref',
  'subject_type',
  'predicate',
  'value',
  'scope',
  'importance',
  'confidence',
  'source_message_id',
  'operation',
  'assertion_class',
  'evidence_quote',
  'sensitivity',
  'subject_quote',
  'predicate_quote',
  'value_quote',
]);
const PROPOSAL_FIELDS = [
  'version',
  'subject_ref',
  'predicate',
  'value',
  'scope',
  'importance',
  'confidence',
  'source_message_id',
  'operation',
  'assertion_class',
  'evidence_quote',
  'sensitivity',
] as const;
const NAMED_SUBJECT_TYPES = new Set<EntityType>([
  'person',
  'place',
  'org',
  'project',
  'thing',
  'concept',
  'event',
]);

export interface BoundMemoryRememberSemanticEvidence {
  readonly kind: 'bound_memory_remember_semantic_evidence';
}

export interface MemoryRememberSemanticEvidenceBinding {
  proposal: SemanticFactProposalV1;
  subjectType: EntityType;
  subjectQuote: string;
  predicateQuote: string;
  valueQuote: string;
}

export type BindMemoryRememberSemanticEvidenceResult =
  | { valid: true; evidence: BoundMemoryRememberSemanticEvidence }
  | {
      valid: false;
      code:
        | 'invalid_contract'
        | 'non_current_assertion'
        | 'wrong_source_message'
        | 'evidence_quote_mismatch'
        | 'subject_quote_mismatch'
        | 'predicate_quote_mismatch'
        | 'value_quote_mismatch';
    };

const bindings = new WeakMap<object, MemoryRememberSemanticEvidenceBinding>();

export function bindMemoryRememberSemanticEvidence(
  raw: unknown,
  request: MemoryRememberRequestEvidence,
): BindMemoryRememberSemanticEvidenceResult {
  if (!isPlainRecord(raw) || !hasExactFields(raw, MEMORY_REMEMBER_SEMANTIC_EVIDENCE_FIELDS)) {
    return { valid: false, code: 'invalid_contract' };
  }
  const proposalRaw = Object.fromEntries(PROPOSAL_FIELDS.map((field) => [field, raw[field]]));
  const decoded = decodeSemanticFactProposals([proposalRaw]);
  if (!decoded.valid || decoded.value.length !== 1) {
    return { valid: false, code: 'invalid_contract' };
  }
  const proposal = decoded.value[0]!;
  const subjectType = decodeSubjectType(raw.subject_type, proposal);
  const subjectQuote = exactString(raw.subject_quote, 160);
  const predicateQuote = exactString(raw.predicate_quote, 200);
  const valueQuote = exactString(raw.value_quote, 200);
  if (!subjectType || !subjectQuote || !predicateQuote || !valueQuote) {
    return { valid: false, code: 'invalid_contract' };
  }
  if (proposal.assertionClass !== 'current_direct') {
    return { valid: false, code: 'non_current_assertion' };
  }
  if (proposal.sourceMessageId !== request.userMessageId) {
    return { valid: false, code: 'wrong_source_message' };
  }
  if (!request.userMessageText.includes(proposal.evidenceQuote)) {
    return { valid: false, code: 'evidence_quote_mismatch' };
  }
  if (valueQuote !== proposal.value || !proposal.evidenceQuote.includes(valueQuote)) {
    return { valid: false, code: 'value_quote_mismatch' };
  }
  if (
    !proposal.evidenceQuote.includes(subjectQuote) ||
    (proposal.subjectRef.kind === 'named' && subjectQuote !== proposal.subjectRef.label)
  ) {
    return { valid: false, code: 'subject_quote_mismatch' };
  }
  if (!proposal.evidenceQuote.includes(predicateQuote)) {
    return { valid: false, code: 'predicate_quote_mismatch' };
  }

  const evidence = Object.freeze({
    kind: 'bound_memory_remember_semantic_evidence' as const,
  });
  bindings.set(evidence, {
    proposal,
    subjectType,
    subjectQuote,
    predicateQuote,
    valueQuote,
  });
  return { valid: true, evidence };
}

export function resolveBoundMemoryRememberSemanticEvidence(
  evidence: BoundMemoryRememberSemanticEvidence,
): MemoryRememberSemanticEvidenceBinding | null {
  const binding = bindings.get(evidence);
  return binding
    ? {
        ...binding,
        proposal: {
          ...binding.proposal,
          subjectRef: { ...binding.proposal.subjectRef },
        },
      }
    : null;
}

function decodeSubjectType(raw: unknown, proposal: SemanticFactProposalV1): EntityType | null {
  if (proposal.subjectRef.kind === 'self') return raw === 'self' ? 'self' : null;
  return typeof raw === 'string' && NAMED_SUBJECT_TYPES.has(raw as EntityType)
    ? (raw as EntityType)
    : null;
}

function exactString(raw: unknown, maxLength: number): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw === raw.trim() && raw.length <= maxLength
    ? raw
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
