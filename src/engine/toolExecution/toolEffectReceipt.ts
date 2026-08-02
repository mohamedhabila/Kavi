import {
  TOOL_EFFECT_KINDS,
  TOOL_EFFECT_STATES,
  TOOL_EFFECT_VERIFICATION_STATES,
  TOOL_EXECUTION_STATES,
  type ToolEffectKind,
  type ToolEffectDigest,
  type ToolEffectIdentitySelector,
  type ToolEffectResourceSelector,
  type ToolEffectOperationHandle,
  type ToolEffectReceipt,
  type ToolContractIdentity,
  type ToolEffectResourceRef,
  type ToolEffectResultContract,
  type ToolEffectResultOutcome,
  type ToolEffectState,
  type ToolEffectTransportState,
  type ToolEffectVerificationState,
  type ToolExecutionState,
} from '../../types/toolEffectReceipt';
import { sha256HexUtf8Async } from '../../utils/sha256Async';
import {
  decodeToolEffectReceipt,
  isToolEffectStateCombinationValid,
} from '../../utils/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from './toolEffectReceiptContracts';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import {
  buildCodeOwnedToolContractIdentity,
  buildToolContractIdentity,
  codeOwnedToolContractIdentitiesEqual,
  type RuntimeExternalToolEvidence,
} from './toolContractIdentity';
import { toolEffectResultConditionsMatch } from './toolEffectResultConditions';

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const CONTRACT_KEYS = new Set(['statusPath', 'outcomes', 'resource', 'operationHandle']);
const OUTCOME_KEYS = new Set(['effectKind', 'executionState', 'effectState', 'verificationState']);
const IDENTITY_SELECTOR_KEYS = new Set(['kind', 'source', 'path']);
const RESOURCE_SELECTOR_KEYS = new Set(['kind', 'source', 'path', 'digestPath']);
const SHA256_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/u;

type BuildToolEffectReceiptParams = {
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  resultText: string;
  transportState: ToolEffectTransportState;
  resultIsError?: boolean;
  terminalEffectState?: 'cancelled' | 'failed';
  executionRunId: string;
  dispatchRunId?: string;
  recordedAt?: number;
  runtimeExternalEvidence?: RuntimeExternalToolEvidence;
  preparedContractIdentity?: ToolContractIdentity;
};

type ResolvedEffectOutcome = {
  effectKind: ToolEffectKind;
  executionState?: ToolExecutionState;
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

function normalizeIdentitySelectorWithKeys(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): ToolEffectIdentitySelector | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, allowedKeys)) {
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

function normalizeIdentitySelector(value: unknown): ToolEffectIdentitySelector | undefined {
  return normalizeIdentitySelectorWithKeys(value, IDENTITY_SELECTOR_KEYS);
}

function normalizeResourceSelector(value: unknown): ToolEffectResourceSelector | undefined {
  const identity = normalizeIdentitySelectorWithKeys(value, RESOURCE_SELECTOR_KEYS);
  if (!identity || !isPlainRecord(value)) {
    return undefined;
  }
  const digestPath = value.digestPath === undefined ? undefined : normalizePath(value.digestPath);
  if (value.digestPath !== undefined && !digestPath) {
    return undefined;
  }
  return Object.freeze({
    ...identity,
    ...(digestPath ? { digestPath } : {}),
  });
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
  const executionState =
    value.executionState === undefined
      ? undefined
      : typeof value.executionState === 'string' &&
          TOOL_EXECUTION_STATES.includes(value.executionState as ToolExecutionState)
        ? (value.executionState as ToolExecutionState)
        : null;
  const verificationState =
    typeof value.verificationState === 'string' &&
    TOOL_EFFECT_VERIFICATION_STATES.includes(value.verificationState as ToolEffectVerificationState)
      ? (value.verificationState as ToolEffectVerificationState)
      : undefined;
  if (effectKind === null || executionState === null || !effectState || !verificationState) {
    return undefined;
  }
  const outcome = {
    ...(effectKind ? { effectKind } : {}),
    ...(executionState ? { executionState } : {}),
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
    value.resource === undefined ? undefined : normalizeResourceSelector(value.resource);
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

function normalizeResourceDigest(value: unknown): ToolEffectResourceRef['digest'] | undefined {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return undefined;
  }
  return (
    value.startsWith('sha256:') ? value : `sha256:${value}`
  ) as ToolEffectResourceRef['digest'];
}

function resolveResource(
  selector: ToolEffectResourceSelector | undefined,
  argumentsValue: Record<string, unknown> | undefined,
  resultValue: Record<string, unknown> | undefined,
): ToolEffectResourceRef | undefined {
  if (!selector) {
    return undefined;
  }
  const identity = resolveIdentity(selector, argumentsValue, resultValue);
  if (!identity) {
    return undefined;
  }
  const source = selector.source === 'arguments' ? argumentsValue : resultValue;
  const digest = selector.digestPath
    ? normalizeResourceDigest(readPath(source, selector.digestPath))
    : undefined;
  if (selector.digestPath && !digest) {
    return undefined;
  }
  return Object.freeze({
    ...identity,
    ...(digest ? { digest } : {}),
  });
}

function unknownResolvedOutcome(
  effectKind: ToolEffectKind,
  executionState?: ToolExecutionState,
): ResolvedEffectOutcome {
  return {
    effectKind,
    ...(executionState ? { executionState } : {}),
    effectState: 'unknown',
    verificationState: 'unverified',
  };
}

function resolveReturnedOutcome(params: BuildToolEffectReceiptParams): ResolvedEffectOutcome {
  const codeOwnedContract = getCodeOwnedToolEffectContract(params.toolName);
  const effectKind = codeOwnedContract?.effectKind ?? 'unknown';
  const unknownExecutionState = codeOwnedContract?.tracksExecution ? 'unknown' : undefined;

  if (codeOwnedContract?.effectMode === 'none') {
    if (params.resultIsError) {
      return unknownResolvedOutcome(effectKind, unknownExecutionState);
    }
    return { effectKind, effectState: 'none', verificationState: 'not_applicable' };
  }
  if (codeOwnedContract?.effectMode !== 'effectful') {
    return unknownResolvedOutcome('unknown');
  }

  const contract = normalizeResultContract(codeOwnedContract.result);
  const resultValue = parseJsonRecord(params.resultText);
  if (!contract || !resultValue) {
    return unknownResolvedOutcome(effectKind, unknownExecutionState);
  }
  const status = readPath(resultValue, contract.statusPath);
  if (typeof status !== 'string' || status !== status.trim()) {
    return unknownResolvedOutcome(effectKind, unknownExecutionState);
  }
  const outcome = contract.outcomes[status];
  if (!outcome) {
    return unknownResolvedOutcome(effectKind, unknownExecutionState);
  }
  const executionEffectFreeWhen = codeOwnedContract.completion?.executionEffectFreeWhen;
  const executionEffectFreeValue = executionEffectFreeWhen
    ? readPath(resultValue, executionEffectFreeWhen.resultPath)
    : undefined;
  const executionIsEffectFree =
    effectKind === 'compute.execute' &&
    outcome.effectState === 'unknown' &&
    typeof executionEffectFreeValue === 'string' &&
    executionEffectFreeWhen?.values.includes(executionEffectFreeValue) === true;
  const executionIsAcknowledged =
    effectKind === 'compute.execute' &&
    outcome.executionState === 'completed' &&
    outcome.effectState === 'unknown' &&
    toolEffectResultConditionsMatch(
      resultValue,
      codeOwnedContract.completion?.executionEffectAcknowledgedWhen,
    );
  if (params.resultIsError) {
    if (outcome.effectState === 'failed' || outcome.effectState === 'cancelled') {
      return {
        effectKind: outcome.effectKind ?? effectKind,
        ...outcome,
      };
    }
    if (
      (outcome.executionState === 'failed' || outcome.executionState === 'timed_out') &&
      executionIsEffectFree
    ) {
      return {
        effectKind: outcome.effectKind ?? effectKind,
        ...outcome,
        effectState: 'failed',
      };
    }
    const executionState =
      status === 'completed' && outcome.executionState === 'completed'
        ? unknownExecutionState
        : (outcome.executionState ?? unknownExecutionState);
    return unknownResolvedOutcome(outcome.effectKind ?? effectKind, executionState);
  }

  const argumentsValue = parseJsonRecord(params.argumentsText);
  const executionIsVerified = outcome.executionState === 'completed' && executionIsEffectFree;
  const resource = resolveResource(contract.resource, argumentsValue, resultValue);
  const operationHandle = resolveIdentity(contract.operationHandle, argumentsValue, resultValue);
  if ((contract.resource && !resource) || (contract.operationHandle && !operationHandle)) {
    return unknownResolvedOutcome(effectKind, outcome.executionState ?? unknownExecutionState);
  }
  return {
    effectKind: outcome.effectKind ?? effectKind,
    ...(executionIsVerified
      ? {
          ...outcome,
          effectState: 'applied' as const,
          verificationState: 'verified' as const,
        }
      : executionIsAcknowledged
        ? {
            ...outcome,
            effectState: 'applied' as const,
            verificationState: 'acknowledged' as const,
          }
        : outcome),
    ...(resource ? { resource } : {}),
    ...(operationHandle ? { operationHandle } : {}),
  };
}

export async function digestToolEffectText(value: string): Promise<`sha256:${string}`> {
  return `sha256:${await sha256HexUtf8Async(value)}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJsonValue(value[key])]),
    );
  }
  return value;
}

export function canonicalizeToolEffectArguments(argumentsText: string): string | null {
  const argumentsValue = parseJsonRecord(argumentsText);
  return argumentsValue ? JSON.stringify(canonicalizeJsonValue(argumentsValue)) : null;
}

export async function digestToolEffectRequest(argumentsText: string): Promise<`sha256:${string}`> {
  const canonical = canonicalizeToolEffectArguments(argumentsText);
  return digestToolEffectText(canonical ?? argumentsText);
}

async function finalizeToolEffectReceipt(params: {
  toolCallId: string;
  toolName: string;
  contractIdentity: ToolContractIdentity;
  executionRunId: string;
  dispatchRunId?: string;
  transportState: ToolEffectTransportState;
  effectOutcome: ResolvedEffectOutcome;
  requestDigest: ToolEffectDigest;
  resultDigest: ToolEffectDigest;
  recordedAt: number;
}): Promise<ToolEffectReceipt> {
  const identityDigest = await digestToolEffectText(
    JSON.stringify(
      canonicalizeJsonValue({
        domain: 'kavi.tool-effect-receipt.v2',
        executionRunId: params.executionRunId,
        dispatchRunId: params.dispatchRunId ?? null,
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        contractIdentity: params.contractIdentity,
        transportState: params.transportState,
        executionState: params.effectOutcome.executionState ?? null,
        effectKind: params.effectOutcome.effectKind,
        effectState: params.effectOutcome.effectState,
        verificationState: params.effectOutcome.verificationState,
        requestDigest: params.requestDigest,
        resultDigest: params.resultDigest,
        resource: params.effectOutcome.resource ?? null,
        operationHandle: params.effectOutcome.operationHandle ?? null,
        recordedAt: params.recordedAt,
      }),
    ),
  );
  const receipt = decodeToolEffectReceipt({
    version: 2,
    receiptId: `ter_${identityDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    contractIdentity: params.contractIdentity,
    executionRunId: params.executionRunId,
    ...(params.dispatchRunId ? { dispatchRunId: params.dispatchRunId } : {}),
    transportState: params.transportState,
    ...params.effectOutcome,
    requestDigest: params.requestDigest,
    resultDigest: params.resultDigest,
    recordedAt: params.recordedAt,
  });
  if (!receipt) {
    throw new TypeError('Tool effect receipt inputs did not satisfy the durable receipt contract.');
  }
  return receipt;
}

export async function buildToolEffectReceipt(
  params: BuildToolEffectReceiptParams,
): Promise<ToolEffectReceipt> {
  const recordedAt = params.recordedAt ?? Date.now();
  if (!Number.isSafeInteger(recordedAt) || recordedAt < 0) {
    throw new TypeError('Tool effect receipt timestamp must be a non-negative safe integer.');
  }

  const [contractIdentity, requestDigest, resultDigest] = await Promise.all([
    params.preparedContractIdentity
      ? Promise.resolve(params.preparedContractIdentity)
      : buildToolContractIdentity(params.toolName, params.runtimeExternalEvidence),
    digestToolEffectRequest(params.argumentsText),
    digestToolEffectText(params.resultText),
  ]);
  if (
    !contractIdentity ||
    contractIdentity.toolName !== resolveRegisteredToolName(params.toolName)
  ) {
    throw new TypeError(
      'Tool effect receipts require code-owned identity or live runtime-external evidence.',
    );
  }
  const toolName = contractIdentity.toolName;
  const normalizedParams = { ...params, toolName };
  const codeOwnedContract = getCodeOwnedToolEffectContract(toolName);
  const codeOwnedEffectKind = codeOwnedContract?.effectKind ?? 'unknown';
  const tracksExecution = codeOwnedContract?.tracksExecution === true;
  const runtimeExternalEffectFree =
    contractIdentity.kind === 'runtime_external' && contractIdentity.effectClass === 'none';
  const effectOutcome: ResolvedEffectOutcome =
    contractIdentity.kind === 'runtime_external'
      ? runtimeExternalEffectFree && params.transportState === 'returned'
        ? {
            effectKind: 'unknown',
            executionState: params.resultIsError ? ('failed' as const) : ('completed' as const),
            effectState: 'none',
            verificationState: 'not_applicable',
          }
        : {
            effectKind: 'unknown',
            ...(params.transportState === 'returned'
              ? {
                  executionState: params.resultIsError
                    ? ('failed' as const)
                    : ('completed' as const),
                }
              : {}),
            effectState:
              params.transportState === 'rejected'
                ? (params.terminalEffectState ?? 'failed')
                : 'unknown',
            verificationState: 'unverified',
          }
      : params.transportState === 'returned'
        ? resolveReturnedOutcome(normalizedParams)
        : params.transportState === 'rejected'
          ? {
              effectKind: codeOwnedEffectKind,
              ...(tracksExecution
                ? {
                    executionState:
                      params.terminalEffectState === 'cancelled' ? 'cancelled' : 'unknown',
                  }
                : {}),
              effectState: params.terminalEffectState ?? 'failed',
              verificationState: 'unverified',
            }
          : {
              effectKind: codeOwnedEffectKind,
              ...(tracksExecution ? { executionState: 'unknown' as const } : {}),
              effectState: 'unknown',
              verificationState: 'unverified',
            };
  return finalizeToolEffectReceipt({
    toolCallId: params.toolCallId,
    toolName,
    contractIdentity,
    executionRunId: params.executionRunId,
    ...(params.dispatchRunId ? { dispatchRunId: params.dispatchRunId } : {}),
    transportState: params.transportState,
    effectOutcome,
    requestDigest,
    resultDigest,
    recordedAt,
  });
}

/** Build a receipt from a validated, code-owned structured runtime observation. */
export async function buildStructuredToolEffectReceipt(params: {
  toolCallId: string;
  toolName: string;
  executionRunId: string;
  dispatchRunId?: string;
  executionState?: ToolExecutionState;
  effectKind: ToolEffectKind;
  effectState: ToolEffectState;
  verificationState: ToolEffectVerificationState;
  requestDigest: ToolEffectDigest;
  resultText: string;
  recordedAt: number;
}): Promise<ToolEffectReceipt> {
  if (!Number.isSafeInteger(params.recordedAt) || params.recordedAt < 0) {
    throw new TypeError('Tool effect receipt timestamp must be a non-negative safe integer.');
  }
  if (
    !isToolEffectStateCombinationValid({
      transportState: 'returned',
      effectState: params.effectState,
      verificationState: params.verificationState,
    })
  ) {
    throw new TypeError('Structured tool effect outcome is invalid.');
  }
  const contractIdentity = await buildToolContractIdentity(params.toolName);
  if (!contractIdentity || contractIdentity.kind !== 'code_owned') {
    throw new TypeError('Structured tool effect receipts require code-owned tool identity.');
  }
  const toolName = contractIdentity.toolName;
  if (params.executionState && getCodeOwnedToolEffectContract(toolName)?.tracksExecution !== true) {
    throw new TypeError('Structured tool effect execution state requires a tracked contract.');
  }
  return finalizeToolEffectReceipt({
    toolCallId: params.toolCallId,
    toolName,
    contractIdentity,
    executionRunId: params.executionRunId,
    ...(params.dispatchRunId ? { dispatchRunId: params.dispatchRunId } : {}),
    transportState: 'returned',
    effectOutcome: {
      ...(params.executionState ? { executionState: params.executionState } : {}),
      effectKind: params.effectKind,
      effectState: params.effectState,
      verificationState: params.verificationState,
    },
    requestDigest: params.requestDigest,
    resultDigest: await digestToolEffectText(params.resultText),
    recordedAt: params.recordedAt,
  });
}

async function rebuildToolEffectReceiptId(receipt: ToolEffectReceipt): Promise<string> {
  const identityDigest = await digestToolEffectText(
    JSON.stringify(
      canonicalizeJsonValue({
        domain: 'kavi.tool-effect-receipt.v2',
        executionRunId: receipt.executionRunId,
        dispatchRunId: receipt.dispatchRunId ?? null,
        toolCallId: receipt.toolCallId,
        toolName: receipt.toolName,
        contractIdentity: receipt.contractIdentity,
        transportState: receipt.transportState,
        executionState: receipt.executionState ?? null,
        effectKind: receipt.effectKind,
        effectState: receipt.effectState,
        verificationState: receipt.verificationState,
        requestDigest: receipt.requestDigest,
        resultDigest: receipt.resultDigest,
        resource: receipt.resource ?? null,
        operationHandle: receipt.operationHandle ?? null,
        recordedAt: receipt.recordedAt,
      }),
    ),
  );
  return `ter_${identityDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

/** Verifies both receipt-field integrity and exact agreement with current code-owned registries. */
export async function verifyToolEffectReceiptIntegrity(value: unknown): Promise<boolean> {
  const receipt = decodeToolEffectReceipt(value);
  if (!receipt) {
    return false;
  }
  if ((await rebuildToolEffectReceiptId(receipt)) !== receipt.receiptId) return false;
  if (receipt.contractIdentity.kind === 'runtime_external') return true;
  if (
    receipt.executionState &&
    getCodeOwnedToolEffectContract(receipt.toolName)?.tracksExecution !== true
  ) {
    return false;
  }
  const currentIdentity = await buildCodeOwnedToolContractIdentity(receipt.toolName);
  return Boolean(
    currentIdentity &&
    codeOwnedToolContractIdentitiesEqual(currentIdentity, receipt.contractIdentity),
  );
}
