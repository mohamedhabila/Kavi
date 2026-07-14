import {
  MEMORY_FACT_SENSITIVITY_LEVELS,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import type { MemoryFactScope } from './facts/types';

export const SEMANTIC_FACT_PROPOSAL_VERSION = 1 as const;

export const SEMANTIC_FACT_PROPOSAL_SCOPES = [
  'global',
  'project',
  'conversation',
  'session',
] as const satisfies readonly MemoryFactScope[];

export const SEMANTIC_FACT_PROPOSAL_OPERATIONS = ['record', 'replace_current'] as const;

export const SEMANTIC_FACT_ASSERTION_CLASSES = [
  'current_direct',
  'historical',
  'hypothetical',
  'quoted',
  'third_party',
  'uncertain',
] as const;

export type SemanticFactProposalScope = (typeof SEMANTIC_FACT_PROPOSAL_SCOPES)[number];
export type SemanticFactProposalOperation = (typeof SEMANTIC_FACT_PROPOSAL_OPERATIONS)[number];
export type SemanticFactAssertionClass = (typeof SEMANTIC_FACT_ASSERTION_CLASSES)[number];

export type SemanticFactSubjectRef = { kind: 'self' } | { kind: 'named'; label: string };

/** Strict, provider-originated semantics. This type never carries write authority. */
export interface SemanticFactProposalV1 {
  version: typeof SEMANTIC_FACT_PROPOSAL_VERSION;
  subjectRef: SemanticFactSubjectRef;
  predicate: string;
  value: string;
  scope: SemanticFactProposalScope;
  importance: number;
  confidence: number;
  sourceMessageId: string;
  operation: SemanticFactProposalOperation;
  assertionClass: SemanticFactAssertionClass;
  evidenceQuote: string;
  sensitivity: MemoryFactSensitivity;
}

export type SemanticFactProposalDecodeCode =
  | 'missing_required_field'
  | 'unexpected_field'
  | 'invalid_field_type'
  | 'invalid_field_value'
  | 'limit_exceeded';

export type SemanticFactProposalDecodeResult =
  | { valid: true; value: SemanticFactProposalV1[] }
  | { valid: false; code: SemanticFactProposalDecodeCode };

const PROPOSAL_FIELDS = new Set([
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
]);
const REQUIRED_PROPOSAL_FIELDS = [...PROPOSAL_FIELDS];
const SUBJECT_REF_FIELDS = new Set(['kind', 'label']);

export function decodeSemanticFactProposals(raw: unknown): SemanticFactProposalDecodeResult {
  if (!Array.isArray(raw)) return invalid('invalid_field_type');
  if (raw.length > 5) return invalid('limit_exceeded');

  const proposals: SemanticFactProposalV1[] = [];
  for (const item of raw) {
    if (!isPlainRecord(item)) return invalid('invalid_field_type');
    if (Object.keys(item).some((field) => !PROPOSAL_FIELDS.has(field))) {
      return invalid('unexpected_field');
    }
    if (REQUIRED_PROPOSAL_FIELDS.some((field) => !hasOwn(item, field))) {
      return invalid('missing_required_field');
    }
    if (item.version !== SEMANTIC_FACT_PROPOSAL_VERSION) {
      return invalid('invalid_field_value');
    }

    const subjectRef = decodeSubjectRef(item.subject_ref);
    if (!subjectRef.valid) return subjectRef;
    const predicate = exactString(item.predicate, 80);
    if (!predicate.valid) return predicate;
    const value = exactString(item.value, 200);
    if (!value.valid) return value;
    const sourceMessageId = exactString(item.source_message_id, 120);
    if (!sourceMessageId.valid) return sourceMessageId;
    const evidenceQuote = exactString(item.evidence_quote, 600);
    if (!evidenceQuote.valid) return evidenceQuote;
    if (!isUnitNumber(item.importance) || !isUnitNumber(item.confidence)) {
      return invalid('invalid_field_value');
    }
    if (!includes(SEMANTIC_FACT_PROPOSAL_SCOPES, item.scope)) {
      return invalid('invalid_field_value');
    }
    if (!includes(SEMANTIC_FACT_PROPOSAL_OPERATIONS, item.operation)) {
      return invalid('invalid_field_value');
    }
    if (!includes(SEMANTIC_FACT_ASSERTION_CLASSES, item.assertion_class)) {
      return invalid('invalid_field_value');
    }
    if (!includes(MEMORY_FACT_SENSITIVITY_LEVELS, item.sensitivity)) {
      return invalid('invalid_field_value');
    }

    proposals.push({
      version: SEMANTIC_FACT_PROPOSAL_VERSION,
      subjectRef: subjectRef.value,
      predicate: predicate.value,
      value: value.value,
      scope: item.scope,
      importance: item.importance,
      confidence: item.confidence,
      sourceMessageId: sourceMessageId.value,
      operation: item.operation,
      assertionClass: item.assertion_class,
      evidenceQuote: evidenceQuote.value,
      sensitivity: item.sensitivity,
    });
  }
  return { valid: true, value: proposals };
}

function decodeSubjectRef(
  raw: unknown,
):
  | { valid: true; value: SemanticFactSubjectRef }
  | { valid: false; code: SemanticFactProposalDecodeCode } {
  if (!isPlainRecord(raw)) return invalid('invalid_field_type');
  if (Object.keys(raw).some((field) => !SUBJECT_REF_FIELDS.has(field))) {
    return invalid('unexpected_field');
  }
  if (!hasOwn(raw, 'kind')) return invalid('missing_required_field');
  if (raw.kind === 'self') {
    return Object.keys(raw).length === 1
      ? { valid: true, value: { kind: 'self' } }
      : invalid('unexpected_field');
  }
  if (raw.kind !== 'named') return invalid('invalid_field_value');
  if (!hasOwn(raw, 'label')) return invalid('missing_required_field');
  const label = exactString(raw.label, 80);
  return label.valid ? { valid: true, value: { kind: 'named', label: label.value } } : label;
}

function exactString(
  raw: unknown,
  maxLength: number,
): { valid: true; value: string } | { valid: false; code: SemanticFactProposalDecodeCode } {
  if (typeof raw !== 'string') return invalid('invalid_field_type');
  if (!raw || raw !== raw.trim()) return invalid('invalid_field_value');
  if (raw.length > maxLength) return invalid('limit_exceeded');
  return { valid: true, value: raw };
}

function invalid(code: SemanticFactProposalDecodeCode): {
  valid: false;
  code: SemanticFactProposalDecodeCode;
} {
  return { valid: false, code };
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
