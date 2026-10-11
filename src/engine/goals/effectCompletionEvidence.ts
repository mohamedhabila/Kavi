import {
  TOOL_EFFECT_KINDS,
  type ToolEffectDigest,
  type ToolEffectKind,
} from '../../types/toolEffectReceipt';
import {
  normalizeEffectReceiptResource,
  type EffectReceiptEvidence,
  type EffectReceiptResource,
} from '../../services/memory/effectReceiptEvidence';

export const EFFECT_COMPLETION_CRITERION_PREFIX = 'evidence.effect:';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CRITERION_KEYS = new Set(['effectKind', 'requestDigest', 'resource', 'verificationState']);

export type EffectCompletionResource = EffectReceiptResource;

export interface EffectCompletionCriterion {
  effectKind: ToolEffectKind;
  requestDigest: ToolEffectDigest;
  resource: EffectCompletionResource;
  verificationState: 'verified';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function isDigest(value: unknown): value is ToolEffectDigest {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isEffectKind(value: unknown): value is ToolEffectKind {
  return typeof value === 'string' && TOOL_EFFECT_KINDS.includes(value as ToolEffectKind);
}

function parsePrefixedJson(value: string, prefix: string): Record<string, unknown> | null {
  if (!value.startsWith(prefix)) {
    return null;
  }
  try {
    const parsed = JSON.parse(value.slice(prefix.length)) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseEffectCompletionCriterion(value: string): EffectCompletionCriterion | null {
  const record = parsePrefixedJson(value, EFFECT_COMPLETION_CRITERION_PREFIX);
  if (!record || !hasOnlyKeys(record, CRITERION_KEYS)) {
    return null;
  }
  const resource = normalizeEffectReceiptResource(record.resource);
  if (
    !isEffectKind(record.effectKind) ||
    !isDigest(record.requestDigest) ||
    record.verificationState !== 'verified' ||
    !resource
  ) {
    return null;
  }
  return {
    effectKind: record.effectKind,
    requestDigest: record.requestDigest,
    resource,
    verificationState: 'verified',
  };
}

export function buildEffectCompletionCriterion(criterion: EffectCompletionCriterion): string {
  const normalized = parseEffectCompletionCriterion(
    `${EFFECT_COMPLETION_CRITERION_PREFIX}${JSON.stringify(criterion)}`,
  );
  if (!normalized) {
    throw new TypeError('Invalid effect completion criterion.');
  }
  return `${EFFECT_COMPLETION_CRITERION_PREFIX}${JSON.stringify(normalized)}`;
}

export function effectReceiptEvidenceTargetsCriterion(
  evidence: EffectReceiptEvidence,
  criterion: EffectCompletionCriterion,
): boolean {
  return (
    evidence.effectKind === criterion.effectKind &&
    evidence.requestDigest === criterion.requestDigest
  );
}

export function effectCompletionCriteriaEqual(
  left: EffectCompletionCriterion,
  right: EffectCompletionCriterion,
): boolean {
  return (
    left.effectKind === right.effectKind &&
    left.requestDigest === right.requestDigest &&
    left.resource.kind === right.resource.kind &&
    left.resource.id === right.resource.id &&
    left.resource.digest === right.resource.digest &&
    left.verificationState === right.verificationState
  );
}

export function effectReceiptEvidenceSatisfiesCriterion(
  evidence: EffectReceiptEvidence,
  criterion: EffectCompletionCriterion,
): boolean {
  if (
    !effectReceiptEvidenceTargetsCriterion(evidence, criterion) ||
    evidence.transportState !== 'returned' ||
    evidence.effectState !== 'applied' ||
    evidence.verificationState !== 'verified' ||
    evidence.resource.kind !== criterion.resource.kind ||
    (criterion.resource.id !== '*' && evidence.resource.id !== criterion.resource.id)
  ) {
    return false;
  }
  return (
    criterion.resource.digest === undefined ||
    evidence.resource.digest === criterion.resource.digest
  );
}
