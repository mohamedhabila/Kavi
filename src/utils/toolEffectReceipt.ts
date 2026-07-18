import {
  TOOL_EFFECT_KINDS,
  TOOL_EFFECT_STATES,
  TOOL_EFFECT_TRANSPORT_STATES,
  TOOL_EFFECT_VERIFICATION_STATES,
  TOOL_EXECUTION_STATES,
  type CodeOwnedToolContractIdentity,
  type RuntimeExternalToolContractIdentity,
  type ToolContractIdentity,
  type ToolEffectOperationHandle,
  type ToolEffectReceipt,
  type ToolEffectResourceRef,
  type ToolEffectState,
  type ToolEffectTransportState,
  type ToolEffectVerificationState,
  type ToolExecutionState,
} from '../types/toolEffectReceipt';

const RECEIPT_ID_PATTERN = /^ter_[a-f0-9]{32}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const RECEIPT_KEYS = new Set([
  'version',
  'receiptId',
  'toolCallId',
  'toolName',
  'contractIdentity',
  'executionRunId',
  'dispatchRunId',
  'transportState',
  'executionState',
  'effectKind',
  'effectState',
  'verificationState',
  'requestDigest',
  'resultDigest',
  'resource',
  'operationHandle',
  'recordedAt',
]);
const RESOURCE_REFERENCE_KEYS = new Set(['kind', 'id', 'digest']);
const OPERATION_HANDLE_KEYS = new Set(['kind', 'id']);
const CONTRACT_IDENTITY_KEYS = new Set([
  'kind',
  'version',
  'toolName',
  'schemaDigest',
  'capabilityContractDigest',
  'workflowContractDigest',
  'effectContractDigest',
  'executionPolicyDigest',
]);
const RUNTIME_EXTERNAL_IDENTITY_KEYS = new Set([
  'kind',
  'version',
  'toolName',
  'source',
  'namespace',
  'declarationDigest',
  'executionBindingDigest',
]);

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

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined;
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlyArray<T>): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : undefined;
}

function decodeResourceReference(value: unknown): ToolEffectResourceRef | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, RESOURCE_REFERENCE_KEYS)) {
    return undefined;
  }
  const kind = boundedString(value.kind, 128);
  const id = boundedString(value.id, 1024);
  const digest = value.digest === undefined ? undefined : boundedString(value.digest, 71);
  if (!kind || !id || (value.digest !== undefined && (!digest || !SHA256_PATTERN.test(digest)))) {
    return undefined;
  }
  return Object.freeze({
    kind,
    id,
    ...(digest ? { digest: digest as ToolEffectResourceRef['digest'] } : {}),
  });
}

function decodeOperationHandle(value: unknown): ToolEffectOperationHandle | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, OPERATION_HANDLE_KEYS)) {
    return undefined;
  }
  const kind = boundedString(value.kind, 128);
  const id = boundedString(value.id, 1024);
  return kind && id ? Object.freeze({ kind, id }) : undefined;
}

function runtimeExternalNameMatches(
  toolName: string,
  source: RuntimeExternalToolContractIdentity['source'],
  namespace: string,
): boolean {
  if (source === 'mcp') {
    const match = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/u);
    return Boolean(match && match[1] === namespace);
  }
  const parts = toolName.split('__');
  return parts.length === 3 && parts[0] === 'skill' && parts[1] === namespace;
}

function decodeCodeOwnedContractIdentity(
  value: Record<string, unknown>,
): CodeOwnedToolContractIdentity | undefined {
  if (
    !hasOnlyKeys(value, CONTRACT_IDENTITY_KEYS) ||
    value.kind !== 'code_owned' ||
    value.version !== 1
  ) {
    return undefined;
  }
  const toolName = boundedString(value.toolName, 256);
  const schemaDigest = boundedString(value.schemaDigest, 71);
  const capabilityContractDigest = boundedString(value.capabilityContractDigest, 71);
  const workflowContractDigest = boundedString(value.workflowContractDigest, 71);
  const effectContractDigest = boundedString(value.effectContractDigest, 71);
  const executionPolicyDigest = boundedString(value.executionPolicyDigest, 71);
  if (
    !toolName ||
    !schemaDigest ||
    !SHA256_PATTERN.test(schemaDigest) ||
    !capabilityContractDigest ||
    !SHA256_PATTERN.test(capabilityContractDigest) ||
    !workflowContractDigest ||
    !SHA256_PATTERN.test(workflowContractDigest) ||
    !effectContractDigest ||
    !SHA256_PATTERN.test(effectContractDigest) ||
    !executionPolicyDigest ||
    !SHA256_PATTERN.test(executionPolicyDigest)
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: 'code_owned' as const,
    version: 1,
    toolName,
    schemaDigest: schemaDigest as CodeOwnedToolContractIdentity['schemaDigest'],
    capabilityContractDigest:
      capabilityContractDigest as CodeOwnedToolContractIdentity['capabilityContractDigest'],
    workflowContractDigest:
      workflowContractDigest as CodeOwnedToolContractIdentity['workflowContractDigest'],
    effectContractDigest:
      effectContractDigest as CodeOwnedToolContractIdentity['effectContractDigest'],
    executionPolicyDigest:
      executionPolicyDigest as CodeOwnedToolContractIdentity['executionPolicyDigest'],
  });
}

function decodeRuntimeExternalContractIdentity(
  value: Record<string, unknown>,
): RuntimeExternalToolContractIdentity | undefined {
  if (
    !hasOnlyKeys(value, RUNTIME_EXTERNAL_IDENTITY_KEYS) ||
    value.kind !== 'runtime_external' ||
    value.version !== 1
  ) {
    return undefined;
  }
  const toolName = boundedString(value.toolName, 256);
  const source = value.source === 'mcp' || value.source === 'skill' ? value.source : undefined;
  const namespace = boundedString(value.namespace, 256);
  const declarationDigest = boundedString(value.declarationDigest, 71);
  const executionBindingDigest = boundedString(value.executionBindingDigest, 71);
  if (
    !toolName ||
    !source ||
    !namespace ||
    !runtimeExternalNameMatches(toolName, source, namespace) ||
    !declarationDigest ||
    !SHA256_PATTERN.test(declarationDigest) ||
    !executionBindingDigest ||
    !SHA256_PATTERN.test(executionBindingDigest)
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: 'runtime_external' as const,
    version: 1,
    toolName,
    source,
    namespace,
    declarationDigest:
      declarationDigest as RuntimeExternalToolContractIdentity['declarationDigest'],
    executionBindingDigest:
      executionBindingDigest as RuntimeExternalToolContractIdentity['executionBindingDigest'],
  });
}

function decodeContractIdentity(value: unknown): ToolContractIdentity | undefined {
  if (!isPlainRecord(value)) return undefined;
  return value.kind === 'code_owned'
    ? decodeCodeOwnedContractIdentity(value)
    : value.kind === 'runtime_external'
      ? decodeRuntimeExternalContractIdentity(value)
      : undefined;
}

export function isToolEffectStateCombinationValid(params: {
  transportState: ToolEffectTransportState;
  effectState: ToolEffectState;
  verificationState: ToolEffectVerificationState;
}): boolean {
  if (
    params.transportState !== 'returned' &&
    params.effectState !== 'cancelled' &&
    params.effectState !== 'failed' &&
    params.effectState !== 'unknown'
  ) {
    return false;
  }

  switch (params.effectState) {
    case 'none':
      return params.transportState === 'returned' && params.verificationState === 'not_applicable';
    case 'accepted':
    case 'pending':
      return (
        params.verificationState === 'unverified' || params.verificationState === 'acknowledged'
      );
    case 'applied':
      return params.verificationState === 'acknowledged' || params.verificationState === 'verified';
    case 'handed_off':
    case 'cancelled':
    case 'failed':
    case 'unknown':
      return params.verificationState === 'unverified';
  }
}

function isToolExecutionStateCombinationValid(params: {
  transportState: ToolEffectTransportState;
  executionState?: ToolExecutionState;
}): boolean {
  switch (params.executionState) {
    case undefined:
    case 'unknown':
      return true;
    case 'completed':
    case 'failed':
    case 'timed_out':
      return params.transportState === 'returned';
    case 'cancelled':
      return params.transportState !== 'threw';
  }
}

export function decodeToolEffectReceipt(value: unknown): ToolEffectReceipt | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, RECEIPT_KEYS) || value.version !== 2) {
    return undefined;
  }

  const receiptId = boundedString(value.receiptId, 36);
  const toolCallId = boundedString(value.toolCallId, 256);
  const toolName = boundedString(value.toolName, 256);
  const contractIdentity = decodeContractIdentity(value.contractIdentity);
  const executionRunId = boundedString(value.executionRunId, 256);
  const dispatchRunId =
    value.dispatchRunId === undefined ? undefined : boundedString(value.dispatchRunId, 256);
  const transportState = enumValue(value.transportState, TOOL_EFFECT_TRANSPORT_STATES);
  const executionState =
    value.executionState === undefined
      ? undefined
      : enumValue(value.executionState, TOOL_EXECUTION_STATES);
  const effectKind = enumValue(value.effectKind, TOOL_EFFECT_KINDS);
  const effectState = enumValue(value.effectState, TOOL_EFFECT_STATES);
  const verificationState = enumValue(value.verificationState, TOOL_EFFECT_VERIFICATION_STATES);
  const requestDigest = boundedString(value.requestDigest, 71);
  const resultDigest = boundedString(value.resultDigest, 71);
  const recordedAt = value.recordedAt;

  if (
    !receiptId ||
    !RECEIPT_ID_PATTERN.test(receiptId) ||
    !toolCallId ||
    !toolName ||
    !contractIdentity ||
    contractIdentity.toolName !== toolName ||
    !executionRunId ||
    (value.dispatchRunId !== undefined && !dispatchRunId) ||
    !transportState ||
    (value.executionState !== undefined && !executionState) ||
    !effectKind ||
    !effectState ||
    !verificationState ||
    !requestDigest ||
    !SHA256_PATTERN.test(requestDigest) ||
    !resultDigest ||
    !SHA256_PATTERN.test(resultDigest) ||
    !Number.isSafeInteger(recordedAt) ||
    (recordedAt as number) < 0 ||
    !isToolEffectStateCombinationValid({ transportState, effectState, verificationState })
  ) {
    return undefined;
  }
  if (!isToolExecutionStateCombinationValid({ transportState, executionState })) {
    return undefined;
  }
  const resource =
    value.resource === undefined ? undefined : decodeResourceReference(value.resource);
  const operationHandle =
    value.operationHandle === undefined ? undefined : decodeOperationHandle(value.operationHandle);
  if (
    (value.resource !== undefined && !resource) ||
    (value.operationHandle !== undefined && !operationHandle)
  ) {
    return undefined;
  }
  if (
    contractIdentity.kind === 'runtime_external' &&
    (effectKind !== 'unknown' ||
      verificationState !== 'unverified' ||
      (transportState === 'rejected'
        ? effectState !== 'failed' && effectState !== 'cancelled'
        : effectState !== 'unknown') ||
      executionState !== undefined ||
      resource !== undefined ||
      operationHandle !== undefined)
  ) {
    return undefined;
  }

  return Object.freeze({
    version: 2,
    receiptId,
    toolCallId,
    toolName,
    contractIdentity,
    executionRunId,
    ...(dispatchRunId ? { dispatchRunId } : {}),
    transportState,
    ...(executionState ? { executionState } : {}),
    effectKind,
    effectState,
    verificationState,
    requestDigest: requestDigest as ToolEffectReceipt['requestDigest'],
    resultDigest: resultDigest as ToolEffectReceipt['resultDigest'],
    ...(resource ? { resource } : {}),
    ...(operationHandle ? { operationHandle } : {}),
    recordedAt: recordedAt as number,
  });
}

function receiptsMatchReplay(left: ToolEffectReceipt, right: ToolEffectReceipt): boolean {
  const identitiesMatch =
    left.contractIdentity.kind === right.contractIdentity.kind &&
    (left.contractIdentity.kind === 'code_owned' && right.contractIdentity.kind === 'code_owned'
      ? left.contractIdentity.version === right.contractIdentity.version &&
        left.contractIdentity.toolName === right.contractIdentity.toolName &&
        left.contractIdentity.schemaDigest === right.contractIdentity.schemaDigest &&
        left.contractIdentity.capabilityContractDigest ===
          right.contractIdentity.capabilityContractDigest &&
        left.contractIdentity.workflowContractDigest ===
          right.contractIdentity.workflowContractDigest &&
        left.contractIdentity.effectContractDigest ===
          right.contractIdentity.effectContractDigest &&
        left.contractIdentity.executionPolicyDigest === right.contractIdentity.executionPolicyDigest
      : left.contractIdentity.kind === 'runtime_external' &&
        right.contractIdentity.kind === 'runtime_external' &&
        left.contractIdentity.version === right.contractIdentity.version &&
        left.contractIdentity.toolName === right.contractIdentity.toolName &&
        left.contractIdentity.source === right.contractIdentity.source &&
        left.contractIdentity.namespace === right.contractIdentity.namespace &&
        left.contractIdentity.declarationDigest === right.contractIdentity.declarationDigest &&
        left.contractIdentity.executionBindingDigest ===
          right.contractIdentity.executionBindingDigest);
  return (
    left.version === right.version &&
    left.receiptId === right.receiptId &&
    left.toolCallId === right.toolCallId &&
    left.toolName === right.toolName &&
    identitiesMatch &&
    left.executionRunId === right.executionRunId &&
    left.dispatchRunId === right.dispatchRunId &&
    left.transportState === right.transportState &&
    left.executionState === right.executionState &&
    left.effectKind === right.effectKind &&
    left.effectState === right.effectState &&
    left.verificationState === right.verificationState &&
    left.requestDigest === right.requestDigest &&
    left.resultDigest === right.resultDigest &&
    left.resource?.kind === right.resource?.kind &&
    left.resource?.id === right.resource?.id &&
    left.resource?.digest === right.resource?.digest &&
    left.operationHandle?.kind === right.operationHandle?.kind &&
    left.operationHandle?.id === right.operationHandle?.id &&
    left.recordedAt === right.recordedAt
  );
}

export type ToolEffectReceiptParent = {
  toolCallId: string;
  toolName: string;
};

function receiptMatchesParent(
  receipt: ToolEffectReceipt,
  parent: ToolEffectReceiptParent,
): boolean {
  return receipt.toolCallId === parent.toolCallId && receipt.toolName === parent.toolName;
}

export function appendToolEffectReceipt(
  existing: ReadonlyArray<ToolEffectReceipt> | undefined,
  value: unknown,
  parent: ToolEffectReceiptParent,
): ReadonlyArray<ToolEffectReceipt> {
  const receipt = decodeToolEffectReceipt(value);
  if (!receipt || !receiptMatchesParent(receipt, parent)) {
    throw new TypeError('Invalid tool effect receipt.');
  }

  let previousRecordedAt = -1;
  const decodedExisting = (existing ?? []).map((candidate) => {
    const decoded = decodeToolEffectReceipt(candidate);
    if (!decoded || !receiptMatchesParent(decoded, parent)) {
      throw new TypeError('Existing tool effect receipt is invalid.');
    }
    if (decoded.recordedAt < previousRecordedAt) {
      throw new TypeError('Existing tool effect receipt history is out of order.');
    }
    previousRecordedAt = decoded.recordedAt;
    return decoded;
  });
  if (receipt.recordedAt < previousRecordedAt) {
    throw new TypeError('Tool effect receipt append is out of order.');
  }
  for (const decodedCandidate of decodedExisting) {
    if (decodedCandidate.receiptId !== receipt.receiptId) {
      continue;
    }
    if (!receiptsMatchReplay(decodedCandidate, receipt)) {
      throw new TypeError(`Conflicting tool effect receipt identity: ${receipt.receiptId}`);
    }
    return existing && Object.isFrozen(existing) ? existing : Object.freeze(decodedExisting);
  }

  return Object.freeze([...decodedExisting, receipt]);
}

export function sanitizeToolEffectReceipts(
  value: unknown,
  parent: ToolEffectReceiptParent,
): ReadonlyArray<ToolEffectReceipt> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  let receipts: ReadonlyArray<ToolEffectReceipt> = Object.freeze([]);
  let previousRecordedAt = -1;
  for (const candidate of value) {
    const decoded = decodeToolEffectReceipt(candidate);
    if (
      !decoded ||
      !receiptMatchesParent(decoded, parent) ||
      decoded.recordedAt < previousRecordedAt
    ) {
      return undefined;
    }
    try {
      receipts = appendToolEffectReceipt(receipts, decoded, parent);
    } catch {
      // Never salvage a successful suffix from a corrupt append-only history.
      return undefined;
    }
    previousRecordedAt = decoded.recordedAt;
  }
  return receipts.length > 0 ? receipts : undefined;
}
