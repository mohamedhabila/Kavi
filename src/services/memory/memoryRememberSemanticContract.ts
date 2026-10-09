// ---------------------------------------------------------------------------
// Kavi — memory_remember semanticEvidence contract decoding
// ---------------------------------------------------------------------------
// The declared semanticEvidence contract, decoded exactly. A call that does not match
// is refused, and the refusal names every violation: the field, and what the contract
// accepts there.
//
// The refusal used to say "include no undeclared fields" for every mismatch, including
// a missing field and an out-of-range subject kind. A model that had sent no undeclared
// field could not see what to change, so it resent the same call — five identical
// `subject.kind: "thing"` writes in one traced run, every one refused, before it closed
// the goal those writes were meant to prove.
// ---------------------------------------------------------------------------

import type { EntityType } from './entities';
import {
  MEMORY_FACT_SENSITIVITY_LEVELS,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
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

export const MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION = 4 as const;

const MAX_PREDICATE_LENGTH = 80;
const MAX_VALUE_LENGTH = 200;
const MAX_SUBJECT_LABEL_LENGTH = 80;
/** A rejected value is echoed back only far enough to identify it. */
const MAX_REPORTED_VALUE_LENGTH = 40;

type NamedSubjectType = Exclude<EntityType, 'self'>;

export type MemoryRememberSemanticSubjectV4 =
  | Readonly<{ kind: 'self' }>
  | Readonly<{
      kind: 'named';
      label: string;
      type: NamedSubjectType;
    }>;

export interface MemoryRememberSemanticEvidenceV4Input {
  readonly version: typeof MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION;
  readonly subject: MemoryRememberSemanticSubjectV4;
  readonly predicate: string;
  readonly value: string;
  readonly scope: SemanticFactProposalScope;
  readonly importance: number;
  readonly confidence: number;
  readonly operation: SemanticFactProposalOperation;
  readonly assertion_class: SemanticFactAssertionClass;
  readonly sensitivity: MemoryFactSensitivity;
}

const SEMANTIC_EVIDENCE_FIELDS: ReadonlyArray<keyof MemoryRememberSemanticEvidenceV4Input> = [
  'version',
  'subject',
  'predicate',
  'value',
  'scope',
  'importance',
  'confidence',
  'operation',
  'assertion_class',
  'sensitivity',
];
const NAMED_SUBJECT_TYPES: ReadonlyArray<NamedSubjectType> = [
  'person',
  'place',
  'org',
  'project',
  'thing',
  'concept',
  'event',
];
const SELF_SUBJECT_FIELDS = ['kind'] as const;
const NAMED_SUBJECT_FIELDS = ['kind', 'label', 'type'] as const;
const SUBJECT_SHAPES = '{"kind":"self"} or {"kind":"named","label":…,"type":…}';

export type DecodedMemoryRememberSemanticContract = {
  proposal: Omit<SemanticFactProposalV1, 'evidenceQuote'>;
  subjectType: EntityType;
};

export type MemoryRememberSemanticContractResult =
  | { ok: true; decoded: DecodedMemoryRememberSemanticContract }
  | { ok: false; violations: string[] };

export function decodeMemoryRememberSemanticContract(
  raw: unknown,
  sourceMessageId: string,
): MemoryRememberSemanticContractResult {
  if (!isPlainRecord(raw)) {
    return { ok: false, violations: ['semanticEvidence must be an object'] };
  }
  const violations = describeFieldSetViolations('', raw, SEMANTIC_EVIDENCE_FIELDS);
  if (hasOwn(raw, 'version') && raw.version !== MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION) {
    violations.push(`version must be ${MEMORY_REMEMBER_SEMANTIC_EVIDENCE_VERSION}`);
  }
  const subject = hasOwn(raw, 'subject') ? decodeSubject(raw.subject, violations) : undefined;
  const predicate = decodeExactString(raw, 'predicate', MAX_PREDICATE_LENGTH, violations);
  const value = decodeExactString(raw, 'value', MAX_VALUE_LENGTH, violations);
  const importance = decodeUnitNumber(raw, 'importance', violations);
  const confidence = decodeUnitNumber(raw, 'confidence', violations);
  const scope = decodeEnum(raw, 'scope', SEMANTIC_FACT_PROPOSAL_SCOPES, violations);
  const operation = decodeEnum(raw, 'operation', SEMANTIC_FACT_PROPOSAL_OPERATIONS, violations);
  const assertionClass = decodeEnum(
    raw,
    'assertion_class',
    SEMANTIC_FACT_ASSERTION_CLASSES,
    violations,
  );
  const sensitivity = decodeEnum(raw, 'sensitivity', MEMORY_FACT_SENSITIVITY_LEVELS, violations);

  if (
    violations.length > 0 ||
    !subject ||
    predicate === undefined ||
    value === undefined ||
    importance === undefined ||
    confidence === undefined ||
    scope === undefined ||
    operation === undefined ||
    assertionClass === undefined ||
    sensitivity === undefined
  ) {
    return { ok: false, violations };
  }
  return {
    ok: true,
    decoded: {
      proposal: {
        version: SEMANTIC_FACT_PROPOSAL_VERSION,
        subjectRef: subject.ref,
        predicate,
        value,
        scope,
        importance,
        confidence,
        sourceMessageId,
        operation,
        assertionClass,
        sensitivity,
      },
      subjectType: subject.type,
    },
  };
}

function decodeSubject(
  raw: unknown,
  violations: string[],
): { ref: SemanticFactSubjectRef; type: EntityType } | undefined {
  if (!isPlainRecord(raw)) {
    violations.push(`subject must be ${SUBJECT_SHAPES}`);
    return undefined;
  }
  if (raw.kind === 'self') {
    const fieldViolations = describeFieldSetViolations('subject.', raw, SELF_SUBJECT_FIELDS);
    violations.push(...fieldViolations);
    return fieldViolations.length === 0 ? { ref: { kind: 'self' }, type: 'self' } : undefined;
  }
  if (raw.kind !== 'named') {
    violations.push(
      `subject.kind must be "self" or "named", not ${describeValue(raw.kind)}; a subject is ${SUBJECT_SHAPES}`,
    );
    return undefined;
  }
  const fieldViolationCount = violations.length;
  violations.push(...describeFieldSetViolations('subject.', raw, NAMED_SUBJECT_FIELDS));
  const label = decodeExactString(raw, 'label', MAX_SUBJECT_LABEL_LENGTH, violations, 'subject.');
  const type = decodeEnum(raw, 'type', NAMED_SUBJECT_TYPES, violations, 'subject.');
  if (violations.length > fieldViolationCount || label === undefined || type === undefined) {
    return undefined;
  }
  return { ref: { kind: 'named', label }, type };
}

/** Missing and undeclared fields, each listed in the contract's own order. */
function describeFieldSetViolations(
  prefix: string,
  raw: Record<string, unknown>,
  declared: ReadonlyArray<string>,
): string[] {
  const declaredSet = new Set(declared);
  const missing = declared.filter((field) => !hasOwn(raw, field));
  const undeclared = Object.keys(raw)
    .filter((field) => !declaredSet.has(field))
    .sort();
  return [
    ...(missing.length > 0
      ? [`missing required ${plural('field', missing.length)}: ${prefixed(prefix, missing)}`]
      : []),
    ...(undeclared.length > 0
      ? [`undeclared ${plural('field', undeclared.length)}: ${prefixed(prefix, undeclared)}`]
      : []),
  ];
}

function decodeExactString(
  raw: Record<string, unknown>,
  field: string,
  maximumLength: number,
  violations: string[],
  prefix = '',
): string | undefined {
  if (!hasOwn(raw, field)) return undefined;
  const value = raw[field];
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= maximumLength
  ) {
    return value;
  }
  violations.push(
    `${prefix}${field} must be a non-empty string of at most ${maximumLength} characters with no surrounding whitespace`,
  );
  return undefined;
}

function decodeUnitNumber(
  raw: Record<string, unknown>,
  field: string,
  violations: string[],
): number | undefined {
  if (!hasOwn(raw, field)) return undefined;
  const value = raw[field];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  violations.push(`${field} must be a number from 0 to 1, not ${describeValue(value)}`);
  return undefined;
}

function decodeEnum<T extends string>(
  raw: Record<string, unknown>,
  field: string,
  allowed: ReadonlyArray<T>,
  violations: string[],
  prefix = '',
): T | undefined {
  if (!hasOwn(raw, field)) return undefined;
  const value = raw[field];
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }
  violations.push(
    `${prefix}${field} must be one of ${allowed.join(', ')}, not ${describeValue(value)}`,
  );
  return undefined;
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'missing';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = typeof value;
  }
  const characters = Array.from(text);
  return characters.length > MAX_REPORTED_VALUE_LENGTH
    ? `${characters.slice(0, MAX_REPORTED_VALUE_LENGTH).join('')}…`
    : text;
}

function hasOwn(raw: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, field);
}

function prefixed(prefix: string, fields: ReadonlyArray<string>): string {
  return fields.map((field) => `${prefix}${field}`).join(', ');
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
