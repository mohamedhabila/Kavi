import type { EntityType } from './entities';
import {
  MEMORY_FACT_SENSITIVITY_LEVELS,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import type { MemoryRememberRequestEvidence } from './memoryRememberPersistence';
import { sha256HexUtf8 } from '../../utils/sha256';
import {
  SEMANTIC_FACT_ASSERTION_CLASSES,
  SEMANTIC_FACT_PROPOSAL_OPERATIONS,
  SEMANTIC_FACT_PROPOSAL_SCOPES,
  SEMANTIC_FACT_PROPOSAL_VERSION,
  type SemanticFactAssertionClass,
  type SemanticFactProposalOperation,
  type SemanticFactProposalScope,
  type SemanticFactProposalV1,
  type SemanticFactSubjectRef,
} from './semanticFactProposal';

export const MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION = 3 as const;
const MAX_MEMORY_REMEMBER_EVIDENCE_SPAN_LENGTH = 600;

export interface MemoryRememberSemanticEvidenceV3Input {
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
  'sensitivity',
]);
const NAMED_SUBJECT_TYPES = new Set<EntityType>([
  'person',
  'place',
  'org',
  'project',
  'thing',
  'concept',
  'event',
]);
const SUBJECT_REF_SELF_FIELDS = new Set(['kind']);
const SUBJECT_REF_NAMED_FIELDS = new Set(['kind', 'label']);

export interface BoundMemoryRememberSemanticEvidence {
  readonly kind: 'bound_memory_remember_semantic_evidence';
}

export interface MemoryRememberSemanticEvidenceBinding {
  proposal: Omit<SemanticFactProposalV1, 'evidenceQuote'>;
  subjectType: EntityType;
  evidenceSpan: string;
  sourceMessageSha256: string;
}

export type BindMemoryRememberSemanticEvidenceResult =
  | { valid: true; evidence: BoundMemoryRememberSemanticEvidence }
  | {
      valid: false;
      code:
        | 'invalid_contract'
        | 'non_current_assertion'
        | 'subject_not_grounded'
        | 'value_not_grounded'
        | 'evidence_span_limit_exceeded';
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
  const decoded = decodeMemoryRememberSemanticProposal(raw, request.userMessageId);
  if (!decoded) {
    return { valid: false, code: 'invalid_contract' };
  }
  const subjectType = decodeSubjectType(raw.subject_type, decoded);
  if (!subjectType) {
    return { valid: false, code: 'invalid_contract' };
  }
  if (decoded.assertionClass !== 'current_direct') {
    return { valid: false, code: 'non_current_assertion' };
  }
  const grounding = deriveExactEvidenceSpan(
    decoded.subjectRef,
    decoded.value,
    request.userMessageText,
  );
  if (!grounding.valid) return grounding;

  const evidence = Object.freeze({
    kind: 'bound_memory_remember_semantic_evidence' as const,
  });
  bindings.set(evidence, {
    proposal: decoded,
    subjectType,
    evidenceSpan: grounding.evidenceSpan,
    sourceMessageSha256: sha256HexUtf8(request.userMessageText),
  });
  return { valid: true, evidence };
}

function decodeMemoryRememberSemanticProposal(
  raw: Record<string, unknown>,
  sourceMessageId: string,
): Omit<SemanticFactProposalV1, 'evidenceQuote'> | null {
  const subjectRef = decodeSubjectRef(raw.subject_ref);
  const predicate = exactString(raw.predicate, 80);
  const value = exactString(raw.value, 200);
  if (
    !subjectRef ||
    predicate === null ||
    value === null ||
    !isUnitNumber(raw.importance) ||
    !isUnitNumber(raw.confidence) ||
    !includes(SEMANTIC_FACT_PROPOSAL_SCOPES, raw.scope) ||
    !includes(SEMANTIC_FACT_PROPOSAL_OPERATIONS, raw.operation) ||
    !includes(SEMANTIC_FACT_ASSERTION_CLASSES, raw.assertion_class) ||
    !includes(MEMORY_FACT_SENSITIVITY_LEVELS, raw.sensitivity)
  ) {
    return null;
  }
  return {
    version: SEMANTIC_FACT_PROPOSAL_VERSION,
    subjectRef,
    predicate,
    value,
    scope: raw.scope,
    importance: raw.importance,
    confidence: raw.confidence,
    sourceMessageId,
    operation: raw.operation,
    assertionClass: raw.assertion_class,
    sensitivity: raw.sensitivity,
  };
}

function decodeSubjectRef(raw: unknown): SemanticFactSubjectRef | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.kind === 'self') {
    return hasExactFields(raw, SUBJECT_REF_SELF_FIELDS) ? { kind: 'self' } : null;
  }
  if (raw.kind !== 'named' || !hasExactFields(raw, SUBJECT_REF_NAMED_FIELDS)) return null;
  const label = exactString(raw.label, 80);
  return label === null ? null : { kind: 'named', label };
}

function exactString(raw: unknown, maximumLength: number): string | null {
  return typeof raw === 'string' &&
    raw.length > 0 &&
    raw === raw.trim() &&
    Array.from(raw).length <= maximumLength
    ? raw
    : null;
}

function isUnitNumber(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1;
}

function includes<T extends string>(values: readonly T[], raw: unknown): raw is T {
  return typeof raw === 'string' && values.includes(raw as T);
}

type ExactEvidenceSpanResult =
  | { valid: true; evidenceSpan: string }
  | {
      valid: false;
      code: 'subject_not_grounded' | 'value_not_grounded' | 'evidence_span_limit_exceeded';
    };

function deriveExactEvidenceSpan(
  subjectRef: SemanticFactSubjectRef,
  value: string,
  source: string,
): ExactEvidenceSpanResult {
  const firstValueStart = source.indexOf(value);
  if (firstValueStart === -1) return { valid: false, code: 'value_not_grounded' };

  if (subjectRef.kind === 'self') {
    return boundedEvidenceSpan(source, firstValueStart, firstValueStart + value.length);
  }
  const firstSubjectStart = source.indexOf(subjectRef.label);
  if (firstSubjectStart === -1) {
    return { valid: false, code: 'subject_not_grounded' };
  }

  const bounds = shortestCoveringBoundsInSource(
    source,
    firstSubjectStart,
    subjectRef.label,
    firstValueStart,
    value,
  );
  return boundedEvidenceSpan(source, bounds.start, bounds.end);
}

function shortestCoveringBoundsInSource(
  source: string,
  firstLeftStart: number,
  left: string,
  firstRightStart: number,
  right: string,
): { start: number; end: number } {
  let leftStart = firstLeftStart;
  let rightStart = firstRightStart;
  let best = coveringBounds(leftStart, left.length, rightStart, right.length);
  while (leftStart !== -1 && rightStart !== -1) {
    const candidate = coveringBounds(
      leftStart,
      left.length,
      rightStart,
      right.length,
    );
    if (
      candidate.end - candidate.start < best.end - best.start ||
      (candidate.end - candidate.start === best.end - best.start && candidate.start < best.start)
    ) {
      best = candidate;
    }
    const advanceLeft = leftStart <= rightStart;
    const advanceRight = rightStart <= leftStart;
    if (advanceLeft) leftStart = source.indexOf(left, leftStart + 1);
    if (advanceRight) rightStart = source.indexOf(right, rightStart + 1);
  }
  return best;
}

function coveringBounds(
  leftStart: number,
  leftLength: number,
  rightStart: number,
  rightLength: number,
): { start: number; end: number } {
  return {
    start: Math.min(leftStart, rightStart),
    end: Math.max(leftStart + leftLength, rightStart + rightLength),
  };
}

function boundedEvidenceSpan(source: string, start: number, end: number): ExactEvidenceSpanResult {
  if (end - start > MAX_MEMORY_REMEMBER_EVIDENCE_SPAN_LENGTH) {
    return { valid: false, code: 'evidence_span_limit_exceeded' };
  }
  return { valid: true, evidenceSpan: source.slice(start, end) };
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

function decodeSubjectType(
  raw: unknown,
  proposal: Pick<SemanticFactProposalV1, 'subjectRef'>,
): EntityType | null {
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
