// ---------------------------------------------------------------------------
// Kavi — Effect receipt evidence
// ---------------------------------------------------------------------------
// The persisted string form of a tool call's settled effect receipt, as memory
// ingestion snapshots carry it. The prefix and shape are a stored format.
// ---------------------------------------------------------------------------

import {
  type ToolEffectDigest,
  type ToolEffectKind,
  type ToolEffectReceipt,
  type ToolContractIdentity,
} from '../../types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';

export const EFFECT_RECEIPT_EVIDENCE_PREFIX = 'effect_receipt_v2:';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RESOURCE_ID_MAX_LENGTH = 1_024;
const RESOURCE_KIND_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/u;
const RECEIPT_ID_PATTERN = /^ter_[a-f0-9]{32}$/u;
const TOOL_NAME_MAX_LENGTH = 256;
const RESOURCE_KEYS = new Set(['kind', 'id', 'digest']);
const RECEIPT_EVIDENCE_KEYS = new Set(['evidenceVersion', 'receipt', 'resource']);

export interface EffectReceiptResource {
  kind: string;
  id: string;
  digest?: ToolEffectDigest;
}

export interface EffectReceiptEvidence {
  evidenceVersion: 2;
  receiptVersion: 2;
  receiptId: string;
  toolCallId: string;
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
  resource: EffectReceiptResource;
  recordedAt: number;
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

export function normalizeEffectReceiptResource(value: unknown): EffectReceiptResource | null {
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

export function buildToolEffectReceiptEvidence(receipt: ToolEffectReceipt): string {
  const resource: EffectReceiptResource = receipt.resource
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
  const resource = normalizeEffectReceiptResource(record.resource);
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
    toolCallId: receipt.toolCallId,
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
    recordedAt: receipt.recordedAt,
  };
}
