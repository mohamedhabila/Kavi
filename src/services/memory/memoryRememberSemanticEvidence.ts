import type { EntityType } from './entities';
import type { MemoryFactSensitivity } from './facts/applicabilityProvenance';
import type { MemoryRememberRequestEvidence } from './memoryRememberPersistence';
import {
  decodeSemanticFactProposals,
  SEMANTIC_FACT_PROPOSAL_VERSION,
  type SemanticFactAssertionClass,
  type SemanticFactProposalOperation,
  type SemanticFactProposalScope,
  type SemanticFactProposalV1,
  type SemanticFactSubjectRef,
} from './semanticFactProposal';

export const MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION = 2 as const;

export interface MemoryRememberSemanticEvidenceV2Input {
  readonly version: typeof MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION;
  readonly subject_ref: SemanticFactSubjectRef;
  readonly subject_type: EntityType;
  readonly predicate: string;
  readonly value: string;
  readonly scope: SemanticFactProposalScope;
  readonly importance: number;
  readonly confidence: number;
  readonly operation: SemanticFactProposalOperation;
  readonly assertion_class: SemanticFactAssertionClass;
  readonly evidence_quote: string;
  readonly sensitivity: MemoryFactSensitivity;
}

const MEMORY_REMEMBER_SEMANTIC_EVIDENCE_FIELDS = new Set([
  'version',
  'subject_ref',
  'subject_type',
  'predicate',
  'value',
  'scope',
  'importance',
  'confidence',
  'operation',
  'assertion_class',
  'evidence_quote',
  'sensitivity',
]);
const PROPOSAL_FIELDS = [
  'subject_ref',
  'predicate',
  'value',
  'scope',
  'importance',
  'confidence',
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
}

export type BindMemoryRememberSemanticEvidenceResult =
  | { valid: true; evidence: BoundMemoryRememberSemanticEvidence }
  | {
      valid: false;
      code:
        | 'invalid_contract'
        | 'non_current_assertion'
        | 'evidence_quote_mismatch'
        | 'subject_not_grounded'
        | 'value_not_grounded';
    };

const bindings = new WeakMap<object, MemoryRememberSemanticEvidenceBinding>();

export function bindMemoryRememberSemanticEvidence(
  raw: unknown,
  request: MemoryRememberRequestEvidence,
): BindMemoryRememberSemanticEvidenceResult {
  if (!isPlainRecord(raw) || !hasExactFields(raw, MEMORY_REMEMBER_SEMANTIC_EVIDENCE_FIELDS)) {
    return { valid: false, code: 'invalid_contract' };
  }
  if (raw.version !== MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION) {
    return { valid: false, code: 'invalid_contract' };
  }
  const proposalRaw = {
    version: SEMANTIC_FACT_PROPOSAL_VERSION,
    ...Object.fromEntries(PROPOSAL_FIELDS.map((field) => [field, raw[field]])),
    source_message_id: request.userMessageId,
  };
  const decoded = decodeSemanticFactProposals([proposalRaw]);
  if (!decoded.valid || decoded.value.length !== 1) {
    return { valid: false, code: 'invalid_contract' };
  }
  const proposal = decoded.value[0]!;
  const subjectType = decodeSubjectType(raw.subject_type, proposal);
  if (!subjectType) {
    return { valid: false, code: 'invalid_contract' };
  }
  if (proposal.assertionClass !== 'current_direct') {
    return { valid: false, code: 'non_current_assertion' };
  }
  if (!request.userMessageText.includes(proposal.evidenceQuote)) {
    return { valid: false, code: 'evidence_quote_mismatch' };
  }
  if (!proposal.evidenceQuote.includes(proposal.value)) {
    return { valid: false, code: 'value_not_grounded' };
  }
  if (
    proposal.subjectRef.kind === 'named' &&
    !proposal.evidenceQuote.includes(proposal.subjectRef.label)
  ) {
    return { valid: false, code: 'subject_not_grounded' };
  }

  const evidence = Object.freeze({
    kind: 'bound_memory_remember_semantic_evidence' as const,
  });
  bindings.set(evidence, {
    proposal,
    subjectType,
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

function hasExactFields(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
