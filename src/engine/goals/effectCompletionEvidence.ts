import {
  TOOL_EFFECT_KINDS,
  type ToolEffectDigest,
  type ToolEffectKind,
  type ToolEffectReceipt,
  type ToolContractIdentity,
} from '../../types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';

export const EFFECT_COMPLETION_CRITERION_PREFIX = 'evidence.effect:';
export const EFFECT_RECEIPT_EVIDENCE_PREFIX = 'effect_receipt_v2:';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RESOURCE_ID_MAX_LENGTH = 1_024;
const RESOURCE_KIND_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/u;
const RECEIPT_ID_PATTERN = /^ter_[a-f0-9]{32}$/u;
const TOOL_NAME_MAX_LENGTH = 256;
const CRITERION_KEYS = new Set(['effectKind', 'requestDigest', 'resource', 'verificationState']);
const RESOURCE_KEYS = new Set(['kind', 'id', 'digest']);
const RECEIPT_EVIDENCE_KEYS = new Set(['evidenceVersion', 'receipt', 'resource']);

export interface EffectCompletionResource {
  kind: string;
  id: string;
  digest?: ToolEffectDigest;
}

export interface EffectCompletionCriterion {
  effectKind: ToolEffectKind;
  requestDigest: ToolEffectDigest;
  resource: EffectCompletionResource;
  verificationState: 'verified';
}

export interface EffectReceiptEvidence {
  evidenceVersion: 2;
  receiptVersion: 2;
  receiptId: string;
  toolName: string;
  contractIdentity: ToolContractIdentity;
  executionRunId: string;
  dispatchRunId?: string;
  transportState: ToolEffectReceipt['transportState'];
  effectKind: ToolEffectKind;
  effectState: ToolEffectReceipt['effectState'];
  executionState?: ToolEffectReceipt['executionState'];
  verificationState: ToolEffectReceipt['verificationState'];
  requestDigest: ToolEffectDigest;
  resultDigest: ToolEffectDigest;
  resource: EffectCompletionResource;
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

function normalizeResource(value: unknown): EffectCompletionResource | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, RESOURCE_KEYS)) {
    return null;
  }
  const kind = typeof value.kind === 'string' ? value.kind : '';
  const id = typeof value.id === 'string' ? value.id : '';
  const digest = value.digest;
  if (
    !RESOURCE_KIND_PATTERN.test(kind) ||
    !id ||
    id !== id.trim() ||
    id.length > RESOURCE_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(id) ||
    (digest !== undefined && !isDigest(digest))
  ) {
    return null;
  }
  return {
    kind,
    id,
    ...(digest !== undefined ? { digest } : {}),
  };
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
  const resource = normalizeResource(record.resource);
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

export function buildToolEffectReceiptEvidence(receipt: ToolEffectReceipt): string {
  const resource: EffectCompletionResource = receipt.resource
    ? {
        kind: receipt.resource.kind,
        id: receipt.resource.id,
        ...(receipt.resource.digest ? { digest: receipt.resource.digest } : {}),
      }
    : {
        kind: 'effect_request',
        id: receipt.requestDigest,
      };
  const evidence = {
    evidenceVersion: 2,
    receipt,
    resource,
  } as const;
  return `${EFFECT_RECEIPT_EVIDENCE_PREFIX}${JSON.stringify(evidence)}`;
}

export function parseToolEffectReceiptEvidence(value: string): EffectReceiptEvidence | null {
  const record = parsePrefixedJson(value, EFFECT_RECEIPT_EVIDENCE_PREFIX);
  if (!record || !hasOnlyKeys(record, RECEIPT_EVIDENCE_KEYS) || record.evidenceVersion !== 2) {
    return null;
  }
  const receipt = decodeToolEffectReceipt(record.receipt);
  const resource = normalizeResource(record.resource);
  if (
    !receipt ||
    !RECEIPT_ID_PATTERN.test(receipt.receiptId) ||
    !receipt.toolName ||
    receipt.toolName.length > TOOL_NAME_MAX_LENGTH ||
    !resource ||
    (receipt.resource !== undefined &&
      (resource.kind !== receipt.resource.kind ||
        resource.id !== receipt.resource.id ||
        resource.digest !== receipt.resource.digest)) ||
    (receipt.resource === undefined &&
      (resource.kind !== 'effect_request' || resource.id !== receipt.requestDigest))
  ) {
    return null;
  }
  return {
    evidenceVersion: 2,
    receiptVersion: receipt.version,
    receiptId: receipt.receiptId,
    toolName: receipt.toolName,
    contractIdentity: receipt.contractIdentity,
    executionRunId: receipt.executionRunId,
    ...(receipt.dispatchRunId ? { dispatchRunId: receipt.dispatchRunId } : {}),
    transportState: receipt.transportState,
    effectKind: receipt.effectKind,
    effectState: receipt.effectState,
    ...(receipt.executionState ? { executionState: receipt.executionState } : {}),
    verificationState: receipt.verificationState,
    requestDigest: receipt.requestDigest,
    resultDigest: receipt.resultDigest,
    resource,
  };
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
