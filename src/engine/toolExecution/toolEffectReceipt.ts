import * as Crypto from 'expo-crypto';
import {
  TOOL_EFFECT_KINDS,
  TOOL_EFFECT_STATES,
  TOOL_EFFECT_VERIFICATION_STATES,
  type ToolEffectKind,
  type ToolEffectIdentitySelector,
  type ToolEffectOperationHandle,
  type ToolEffectReceipt,
  type ToolEffectResourceRef,
  type ToolEffectResultContract,
  type ToolEffectResultOutcome,
  type ToolEffectState,
  type ToolEffectTransportState,
  type ToolEffectVerificationState,
} from '../../types/toolEffectReceipt';
import {
  decodeToolEffectReceipt,
  isToolEffectStateCombinationValid,
} from '../../utils/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from './toolEffectReceiptContracts';

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const CONTRACT_KEYS = new Set(['statusPath', 'outcomes', 'resource', 'operationHandle']);
const OUTCOME_KEYS = new Set(['effectKind', 'effectState', 'verificationState']);
const SELECTOR_KEYS = new Set(['kind', 'source', 'path']);

type BuildToolEffectReceiptParams = {
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  resultText: string;
  transportState: ToolEffectTransportState;
  resultIsError?: boolean;
  terminalEffectState?: 'cancelled' | 'failed';
  runId?: string;
  recordedAt?: number;
};

type ResolvedEffectOutcome = {
  effectKind: ToolEffectKind;
  effectState: ToolEffectState;
  verificationState: ToolEffectVerificationState;
  resource?: ToolEffectResourceRef;
  operationHandle?: ToolEffectOperationHandle;
};

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

function normalizePath(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 8 ||
    value.some((segment) => typeof segment !== 'string' || !PATH_SEGMENT_PATTERN.test(segment))
  ) {
    return undefined;
  }
  return Object.freeze([...value]) as readonly string[];
}

function normalizeIdentitySelector(value: unknown): ToolEffectIdentitySelector | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, SELECTOR_KEYS)) {
    return undefined;
  }
  const kind =
    typeof value.kind === 'string' &&
    value.kind.length > 0 &&
    value.kind.length <= 128 &&
    value.kind === value.kind.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value.kind)
      ? value.kind
      : undefined;
  const source =
    value.source === 'arguments' || value.source === 'result' ? value.source : undefined;
  const path = normalizePath(value.path);
  if (!kind || !source || !path) {
    return undefined;
  }
  return Object.freeze({ kind, source, path });
}

function isOutcomeStateValid(outcome: ToolEffectResultOutcome): boolean {
  return isToolEffectStateCombinationValid({
    transportState: 'returned',
    effectState: outcome.effectState,
    verificationState: outcome.verificationState,
  });
}

function normalizeOutcome(value: unknown): ToolEffectResultOutcome | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, OUTCOME_KEYS)) {
    return undefined;
  }
  const effectKind =
    value.effectKind === undefined
      ? undefined
      : typeof value.effectKind === 'string' &&
          TOOL_EFFECT_KINDS.includes(value.effectKind as ToolEffectKind)
        ? (value.effectKind as ToolEffectKind)
        : null;
  const effectState =
    typeof value.effectState === 'string' &&
    TOOL_EFFECT_STATES.includes(value.effectState as ToolEffectState)
      ? (value.effectState as ToolEffectState)
      : undefined;
  const verificationState =
    typeof value.verificationState === 'string' &&
    TOOL_EFFECT_VERIFICATION_STATES.includes(
      value.verificationState as ToolEffectVerificationState,
    )
      ? (value.verificationState as ToolEffectVerificationState)
      : undefined;
  if (effectKind === null || !effectState || !verificationState) {
    return undefined;
  }
  const outcome = {
    ...(effectKind ? { effectKind } : {}),
    effectState,
    verificationState,
  };
  return isOutcomeStateValid(outcome) ? Object.freeze(outcome) : undefined;
}

function normalizeResultContract(value: unknown): ToolEffectResultContract | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, CONTRACT_KEYS)) {
    return undefined;
  }
  const statusPath = normalizePath(value.statusPath);
  if (!statusPath || !isPlainRecord(value.outcomes)) {
    return undefined;
  }
  const outcomeEntries = Object.entries(value.outcomes);
  if (outcomeEntries.length === 0 || outcomeEntries.length > 64) {
    return undefined;
  }
  const outcomes: Record<string, ToolEffectResultOutcome> = {};
  for (const [status, candidate] of outcomeEntries) {
    if (
      status.length === 0 ||
      status.length > 128 ||
      status !== status.trim() ||
      CONTROL_CHARACTER_PATTERN.test(status)
    ) {
      return undefined;
    }
    const outcome = normalizeOutcome(candidate);
    if (!outcome) {
      return undefined;
    }
    outcomes[status] = outcome;
  }

  const resource =
    value.resource === undefined ? undefined : normalizeIdentitySelector(value.resource);
  const operationHandle =
    value.operationHandle === undefined
      ? undefined
      : normalizeIdentitySelector(value.operationHandle);
  if (
    (value.resource !== undefined && !resource) ||
    (value.operationHandle !== undefined && !operationHandle)
  ) {
    return undefined;
  }
  return Object.freeze({
    statusPath,
    outcomes: Object.freeze(outcomes),
    ...(resource ? { resource } : {}),
    ...(operationHandle ? { operationHandle } : {}),
  });
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readPath(root: Record<string, unknown> | undefined, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isPlainRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function normalizeIdentityValue(value: unknown): string | undefined {
  const normalized =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : undefined;
  if (
    !normalized ||
    normalized.length > 1024 ||
    normalized !== normalized.trim() ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function resolveIdentity(
  selector: ToolEffectIdentitySelector | undefined,
  argumentsValue: Record<string, unknown> | undefined,
  resultValue: Record<string, unknown> | undefined,
): { kind: string; id: string } | undefined {
  if (!selector) {
    return undefined;
  }
  const source = selector.source === 'arguments' ? argumentsValue : resultValue;
  const id = normalizeIdentityValue(readPath(source, selector.path));
  return id ? Object.freeze({ kind: selector.kind, id }) : undefined;
}

function resolveReturnedOutcome(params: BuildToolEffectReceiptParams): ResolvedEffectOutcome {
  const codeOwnedContract = getCodeOwnedToolEffectContract(params.toolName);
  const effectKind = codeOwnedContract?.effectKind ?? 'unknown';
  if (params.resultIsError) {
    return { effectKind, effectState: 'unknown', verificationState: 'unverified' };
  }

  if (codeOwnedContract?.effectMode === 'none') {
    return { effectKind, effectState: 'none', verificationState: 'not_applicable' };
  }
  if (codeOwnedContract?.effectMode !== 'effectful') {
    return { effectKind: 'unknown', effectState: 'unknown', verificationState: 'unverified' };
  }

  const contract = normalizeResultContract(codeOwnedContract.result);
  const resultValue = parseJsonRecord(params.resultText);
  if (!contract || !resultValue) {
    return { effectKind, effectState: 'unknown', verificationState: 'unverified' };
  }
  const status = readPath(resultValue, contract.statusPath);
  if (typeof status !== 'string' || status !== status.trim()) {
    return { effectKind, effectState: 'unknown', verificationState: 'unverified' };
  }
  const outcome = contract.outcomes[status];
  if (!outcome) {
    return { effectKind, effectState: 'unknown', verificationState: 'unverified' };
  }

  const argumentsValue = parseJsonRecord(params.argumentsText);
  const resource = resolveIdentity(contract.resource, argumentsValue, resultValue);
  const operationHandle = resolveIdentity(
    contract.operationHandle,
    argumentsValue,
    resultValue,
  );
  if (
    (contract.resource && !resource) ||
    (contract.operationHandle && !operationHandle)
  ) {
    return { effectKind, effectState: 'unknown', verificationState: 'unverified' };
  }
  return {
    effectKind: outcome.effectKind ?? effectKind,
    ...outcome,
    ...(resource ? { resource } : {}),
    ...(operationHandle ? { operationHandle } : {}),
  };
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  return `sha256:${digest.toLowerCase()}`;
}

export async function buildToolEffectReceipt(
  params: BuildToolEffectReceiptParams,
): Promise<ToolEffectReceipt> {
  const recordedAt = params.recordedAt ?? Date.now();
  if (!Number.isSafeInteger(recordedAt) || recordedAt < 0) {
    throw new TypeError('Tool effect receipt timestamp must be a non-negative safe integer.');
  }

  const [requestDigest, resultDigest] = await Promise.all([
    sha256(params.argumentsText),
    sha256(params.resultText),
  ]);
  const codeOwnedEffectKind =
    getCodeOwnedToolEffectContract(params.toolName)?.effectKind ?? 'unknown';
  const effectOutcome: ResolvedEffectOutcome =
    params.transportState === 'returned'
      ? resolveReturnedOutcome(params)
      : params.transportState === 'rejected'
        ? {
            effectKind: codeOwnedEffectKind,
            effectState: params.terminalEffectState ?? 'failed',
            verificationState: 'unverified',
          }
      : {
          effectKind: codeOwnedEffectKind,
          effectState: 'unknown',
          verificationState: 'unverified',
        };
  const identityDigest = await sha256(
    [
      'tool-effect-receipt-v1',
      params.runId ?? '',
      params.toolCallId,
      params.toolName,
      params.transportState,
      effectOutcome.effectKind,
      requestDigest,
      resultDigest,
    ].join('\u0000'),
  );
  const receipt = decodeToolEffectReceipt({
    version: 1,
    receiptId: `ter_${identityDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    ...(params.runId ? { runId: params.runId } : {}),
    transportState: params.transportState,
    ...effectOutcome,
    requestDigest,
    resultDigest,
    recordedAt,
  });
  if (!receipt) {
    throw new TypeError('Tool effect receipt inputs did not satisfy the durable receipt contract.');
  }
  return receipt;
}
