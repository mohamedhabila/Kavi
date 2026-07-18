import { MOBILE_UI_ACTION_TOOL_NAME } from '../../engine/mobileController/contracts';
import type {
  AgentRunAsyncOperation,
  AgentRunMobileControllerHandoffRef,
} from '../../types/agentRun';

const HANDOFF_REF_KEYS = [
  'actionDigest',
  'beforeObservationDigest',
  'beforeObservationId',
  'capabilityDigest',
  'controlEpoch',
  'controllerContractVersion',
  'controllerId',
  'effectId',
  'executionRunId',
  'expiresAt',
  'externalHandleId',
  'handoffId',
  'toolCallId',
  'version',
] as const;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const HANDOFF_ID_PATTERN = /^mch_[a-f0-9]{32}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function exactId(value: unknown, maximumLength = 200): string | null {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : null;
}

function safeInteger(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? (value as number)
    : null;
}

function toolEffectDigest(value: unknown): `sha256:${string}` | null {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
    ? (value as `sha256:${string}`)
    : null;
}

export function qualifyAgentRunMobileControllerHandoffRef(
  candidate: unknown,
): AgentRunMobileControllerHandoffRef | null {
  if (
    !isPlainRecord(candidate) ||
    !hasExactKeys(candidate, HANDOFF_REF_KEYS) ||
    candidate.version !== 1
  ) {
    return null;
  }
  const executionRunId = exactId(candidate.executionRunId);
  const effectId = exactId(candidate.effectId);
  const externalHandleId = exactId(candidate.externalHandleId);
  const toolCallId = exactId(candidate.toolCallId);
  const controlEpoch = safeInteger(candidate.controlEpoch);
  const handoffId =
    typeof candidate.handoffId === 'string' && HANDOFF_ID_PATTERN.test(candidate.handoffId)
      ? candidate.handoffId
      : null;
  const controllerId = exactId(candidate.controllerId);
  const controllerContractVersion = safeInteger(candidate.controllerContractVersion, 1, 1_000_000);
  const capabilityDigest = toolEffectDigest(candidate.capabilityDigest);
  const actionDigest = toolEffectDigest(candidate.actionDigest);
  const beforeObservationId = exactId(candidate.beforeObservationId);
  const beforeObservationDigest = toolEffectDigest(candidate.beforeObservationDigest);
  const expiresAt = safeInteger(candidate.expiresAt);
  if (
    !executionRunId ||
    !effectId ||
    !externalHandleId ||
    !toolCallId ||
    controlEpoch === null ||
    !handoffId ||
    !controllerId ||
    controllerContractVersion === null ||
    !capabilityDigest ||
    !actionDigest ||
    !beforeObservationId ||
    !beforeObservationDigest ||
    expiresAt === null
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    executionRunId,
    effectId,
    externalHandleId,
    toolCallId,
    controlEpoch,
    handoffId,
    controllerId,
    controllerContractVersion,
    capabilityDigest,
    actionDigest,
    beforeObservationId,
    beforeObservationDigest,
    expiresAt,
  });
}

export function buildAgentRunMobileControllerAsyncOperation(input: {
  handoff: AgentRunMobileControllerHandoffRef;
  status?: 'running' | 'cancel_requested';
  updatedAt: number;
}): AgentRunAsyncOperation | null {
  const handoff = qualifyAgentRunMobileControllerHandoffRef(input.handoff);
  const updatedAt = safeInteger(input.updatedAt);
  const status = input.status ?? 'running';
  if (!handoff || updatedAt === null || !['running', 'cancel_requested'].includes(status)) {
    return null;
  }
  return Object.freeze({
    key: `mobile-controller-handoff:${handoff.handoffId}`,
    kind: 'mobile-controller-handoff',
    resourceId: handoff.handoffId,
    displayName: 'Mobile action',
    status,
    blocksFinalization: true,
    lastUpdatedByTool: MOBILE_UI_ACTION_TOOL_NAME,
    updatedAt,
    monitorToolNames: [],
    mobileControllerHandoff: handoff,
  });
}
