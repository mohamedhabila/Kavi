import { isEffectDispatchIdentity } from '../../services/executionJournal/effectDispatchPolicy';
import type { EffectDispatchIdentity } from '../../services/executionJournal/effectDispatchPolicy';
import {
  TOOL_EFFECT_VERIFICATION_STATES,
  TOOL_EXECUTION_STATES,
  type ToolEffectDigest,
  type ToolExecutionState,
} from '../../types/toolEffectReceipt';
import { isToolEffectStateCombinationValid } from '../../utils/toolEffectReceipt';
import {
  MOBILE_CONTROLLER_ACTION_KINDS,
  MOBILE_CONTROLLER_CONTRACT_VERSION,
  MOBILE_CONTROLLER_ENVIRONMENT_CLASSES,
  MOBILE_CONTROLLER_OBSERVABLE_DELTAS,
  MOBILE_CONTROLLER_OBSERVATION_EVIDENCE,
  MOBILE_CONTROLLER_OUTCOME_DELIVERY_MODES,
  MOBILE_CONTROLLER_REASON_CODES,
  MOBILE_UI_ACTION_TOOL_NAME,
  type MobileControllerAction,
  type MobileControllerCapability,
  type MobileControllerCoordinateTarget,
  type MobileControllerElementTarget,
  type MobileControllerObservationRef,
  type MobileControllerOutcome,
  type MobileControllerOutcomeCorrelation,
  type MobileControllerPendingHandoff,
  type MobileControllerStabilizationEvidence,
  type MobileControllerTarget,
  type MobileControllerTerminalEffectState,
} from './contracts';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HANDOFF_ID_PATTERN = /^mch_[a-f0-9]{32}$/u;
const OUTCOME_ID_PATTERN = /^mco_[a-f0-9]{32}$/u;
const MAX_CAPABILITY_PAYLOAD_BYTES = 1_000_000;
const MAX_CONTROLLER_TIMEOUT_MS = 15 * 60 * 1_000;
const TERMINAL_EFFECT_STATES = ['applied', 'failed', 'cancelled', 'unknown'] as const;
const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

const CAPABILITY_KEYS = [
  'allowedAppIds',
  'capabilityDigest',
  'controllerContractVersion',
  'controllerId',
  'environmentClass',
  'maxPayloadBytes',
  'maxPendingActions',
  'normalizedCoordinateScale',
  'observationEvidence',
  'outcomeDeliveryModes',
  'policyAdmissionDigest',
  'supportedActionKinds',
  'timeoutMs',
  'version',
] as const;
const HANDOFF_KEYS = [
  'action',
  'actionDigest',
  'beforeObservation',
  'capabilityDigest',
  'claimedAt',
  'claimToken',
  'controllerContractVersion',
  'controllerId',
  'createdAt',
  'dispatchIdentity',
  'expiresAt',
  'handoffId',
  'version',
] as const;
const OUTCOME_KEYS = new Set([
  'afterObservation',
  'beforeObservationId',
  'capabilityDigest',
  'controllerId',
  'correlation',
  'effectState',
  'executionState',
  'handoffId',
  'observableDelta',
  'observedAt',
  'outcomeId',
  'reasonCode',
  'stabilization',
  'verificationState',
  'version',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const normalizedExpected = [...expected].sort();
  return (
    actual.length === normalizedExpected.length &&
    actual.every((key, index) => key === normalizedExpected[index])
  );
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function exactString(value: unknown, maximumLength: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : null;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? (value as number)
    : null;
}

function safeTimestamp(value: unknown): number | null {
  return safeInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

function digest(value: unknown): ToolEffectDigest | null {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
    ? (value as ToolEffectDigest)
    : null;
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : null;
}

function uniqueEnumArray<T extends string>(
  value: unknown,
  values: readonly T[],
): readonly T[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > values.length) return null;
  const normalized = value.map((item) => enumValue(item, values));
  if (normalized.some((item) => item === null)) return null;
  const result = normalized as T[];
  return new Set(result).size === result.length ? Object.freeze([...result]) : null;
}

function uniqueExactStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const normalized = value.map((item) => exactString(item, maximumLength));
  if (normalized.some((item) => item === null)) return null;
  const result = normalized as string[];
  return new Set(result).size === result.length ? Object.freeze([...result]) : null;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function qualifyMobileControllerCapability(
  candidate: unknown,
): MobileControllerCapability | null {
  if (
    !isPlainRecord(candidate) ||
    !hasExactKeys(candidate, CAPABILITY_KEYS) ||
    candidate.version !== MOBILE_CONTROLLER_CONTRACT_VERSION
  ) {
    return null;
  }

  const controllerId = exactString(candidate.controllerId, 200);
  const controllerContractVersion = safeInteger(candidate.controllerContractVersion, 1, 1_000_000);
  const capabilityDigest = digest(candidate.capabilityDigest);
  const policyAdmissionDigest = digest(candidate.policyAdmissionDigest);
  const environmentClass = enumValue(
    candidate.environmentClass,
    MOBILE_CONTROLLER_ENVIRONMENT_CLASSES,
  );
  const supportedActionKinds = uniqueEnumArray(
    candidate.supportedActionKinds,
    MOBILE_CONTROLLER_ACTION_KINDS,
  );
  const allowedAppIds = uniqueExactStrings(candidate.allowedAppIds, 128, 200);
  const observationEvidence = uniqueEnumArray(
    candidate.observationEvidence,
    MOBILE_CONTROLLER_OBSERVATION_EVIDENCE,
  );
  const outcomeDeliveryModes = uniqueEnumArray(
    candidate.outcomeDeliveryModes,
    MOBILE_CONTROLLER_OUTCOME_DELIVERY_MODES,
  );
  const normalizedCoordinateScale = safeInteger(candidate.normalizedCoordinateScale, 100, 10_000);
  const maxPayloadBytes = safeInteger(candidate.maxPayloadBytes, 1, MAX_CAPABILITY_PAYLOAD_BYTES);
  const timeoutMs = safeInteger(candidate.timeoutMs, 100, MAX_CONTROLLER_TIMEOUT_MS);

  if (
    !controllerId ||
    !controllerContractVersion ||
    !capabilityDigest ||
    !policyAdmissionDigest ||
    !environmentClass ||
    !supportedActionKinds ||
    !allowedAppIds ||
    !observationEvidence ||
    !outcomeDeliveryModes ||
    !normalizedCoordinateScale ||
    candidate.maxPendingActions !== 1 ||
    !maxPayloadBytes ||
    !timeoutMs ||
    (supportedActionKinds.includes('open_app') && allowedAppIds.length === 0)
  ) {
    return null;
  }

  return Object.freeze({
    version: MOBILE_CONTROLLER_CONTRACT_VERSION,
    controllerId,
    controllerContractVersion,
    capabilityDigest,
    policyAdmissionDigest,
    environmentClass,
    supportedActionKinds,
    allowedAppIds,
    observationEvidence,
    outcomeDeliveryModes,
    normalizedCoordinateScale,
    maxPendingActions: 1,
    maxPayloadBytes,
    timeoutMs,
  });
}

function qualifyTarget(
  candidate: unknown,
  capability: MobileControllerCapability,
): MobileControllerTarget | null {
  if (!isPlainRecord(candidate)) return null;
  if (candidate.kind === 'element') {
    if (!hasExactKeys(candidate, ['elementId', 'kind', 'observationId'])) return null;
    const observationId = exactString(candidate.observationId, 200);
    const elementId = exactString(candidate.elementId, 512);
    return observationId && elementId
      ? Object.freeze({
          kind: 'element',
          observationId,
          elementId,
        } satisfies MobileControllerElementTarget)
      : null;
  }
  if (candidate.kind === 'coordinate') {
    if (!hasExactKeys(candidate, ['kind', 'observationId', 'x', 'y'])) return null;
    const observationId = exactString(candidate.observationId, 200);
    const x = safeInteger(candidate.x, 0, capability.normalizedCoordinateScale);
    const y = safeInteger(candidate.y, 0, capability.normalizedCoordinateScale);
    return observationId && x !== null && y !== null
      ? Object.freeze({
          kind: 'coordinate',
          observationId,
          x,
          y,
        } satisfies MobileControllerCoordinateTarget)
      : null;
  }
  return null;
}

function actionFitsPayloadLimit(
  action: MobileControllerAction,
  capability: MobileControllerCapability,
): boolean {
  return utf8ByteLength(JSON.stringify(action)) <= capability.maxPayloadBytes;
}

export function qualifyMobileControllerAction(
  candidate: unknown,
  capabilityCandidate: unknown,
): MobileControllerAction | null {
  const capability = qualifyMobileControllerCapability(capabilityCandidate);
  if (!capability || !isPlainRecord(candidate)) return null;
  const kind = enumValue(candidate.kind, MOBILE_CONTROLLER_ACTION_KINDS);
  if (!kind || !capability.supportedActionKinds.includes(kind)) return null;

  let action: MobileControllerAction | null = null;
  if (kind === 'activate' || kind === 'double_tap' || kind === 'long_press') {
    const target = hasExactKeys(candidate, ['kind', 'target'])
      ? qualifyTarget(candidate.target, capability)
      : null;
    if (target) action = Object.freeze({ kind, target });
  } else if (kind === 'drag') {
    const start = hasExactKeys(candidate, ['end', 'kind', 'start'])
      ? qualifyTarget(candidate.start, capability)
      : null;
    const end = qualifyTarget(candidate.end, capability);
    if (
      start?.kind === 'coordinate' &&
      end?.kind === 'coordinate' &&
      start.observationId === end.observationId
    ) {
      action = Object.freeze({ kind, start, end });
    }
  } else if (kind === 'set_text') {
    if (hasExactKeys(candidate, ['kind', 'text']) && typeof candidate.text === 'string') {
      action = Object.freeze({ kind, text: candidate.text });
    }
  } else if (kind === 'keyboard_enter' || kind === 'back' || kind === 'home') {
    if (hasExactKeys(candidate, ['kind'])) action = Object.freeze({ kind });
  } else if (kind === 'open_app') {
    const appId = hasExactKeys(candidate, ['appId', 'kind'])
      ? exactString(candidate.appId, 200)
      : null;
    if (appId && capability.allowedAppIds.includes(appId)) {
      action = Object.freeze({ kind, appId });
    }
  } else if (kind === 'scroll') {
    const direction = hasExactKeys(candidate, ['direction', 'kind'])
      ? enumValue(candidate.direction, SCROLL_DIRECTIONS)
      : null;
    if (direction) action = Object.freeze({ kind, direction });
  } else if (kind === 'wait') {
    const durationMs = hasExactKeys(candidate, ['durationMs', 'kind'])
      ? safeInteger(candidate.durationMs, 100, Math.min(30_000, capability.timeoutMs))
      : null;
    if (durationMs) action = Object.freeze({ kind, durationMs });
  }

  return action && actionFitsPayloadLimit(action, capability) ? action : null;
}

export function qualifyMobileControllerObservationRef(
  candidate: unknown,
): MobileControllerObservationRef | null {
  if (!isPlainRecord(candidate)) return null;
  const allowedKeys = new Set(['appId', 'digest', 'observationId', 'windowId']);
  if (!hasOnlyKeys(candidate, allowedKeys)) return null;
  const observationId = exactString(candidate.observationId, 200);
  const observationDigest = digest(candidate.digest);
  const appId = candidate.appId === undefined ? undefined : exactString(candidate.appId, 200);
  const windowId =
    candidate.windowId === undefined ? undefined : exactString(candidate.windowId, 200);
  if (
    !observationId ||
    !observationDigest ||
    (candidate.appId !== undefined && !appId) ||
    (candidate.windowId !== undefined && !windowId)
  ) {
    return null;
  }
  return Object.freeze({
    observationId,
    digest: observationDigest,
    ...(appId ? { appId } : {}),
    ...(windowId ? { windowId } : {}),
  });
}

export function mobileControllerActionReferencesObservation(
  action: MobileControllerAction,
  observationId: string,
): boolean {
  if (action.kind === 'activate' || action.kind === 'double_tap' || action.kind === 'long_press') {
    return action.target.observationId === observationId;
  }
  if (action.kind === 'drag') {
    return (
      action.start.observationId === observationId && action.end.observationId === observationId
    );
  }
  return true;
}

function cloneDispatchIdentity(identity: EffectDispatchIdentity): Readonly<EffectDispatchIdentity> {
  return Object.freeze({
    ...identity,
    expectedResource: identity.expectedResource
      ? Object.freeze({ ...identity.expectedResource })
      : null,
  });
}

export function qualifyMobileControllerPendingHandoff(
  candidate: unknown,
  capabilityCandidate: unknown,
): MobileControllerPendingHandoff | null {
  const capability = qualifyMobileControllerCapability(capabilityCandidate);
  if (
    !capability ||
    !isPlainRecord(candidate) ||
    !hasExactKeys(candidate, HANDOFF_KEYS) ||
    candidate.version !== MOBILE_CONTROLLER_CONTRACT_VERSION ||
    !isEffectDispatchIdentity(candidate.dispatchIdentity)
  ) {
    return null;
  }
  const handoffId =
    typeof candidate.handoffId === 'string' && HANDOFF_ID_PATTERN.test(candidate.handoffId)
      ? candidate.handoffId
      : null;
  const claimToken = exactString(candidate.claimToken, 256);
  const controllerId = exactString(candidate.controllerId, 200);
  const controllerContractVersion = safeInteger(candidate.controllerContractVersion, 1, 1_000_000);
  const capabilityDigest = digest(candidate.capabilityDigest);
  const action = qualifyMobileControllerAction(candidate.action, capability);
  const actionDigest = digest(candidate.actionDigest);
  const beforeObservation = qualifyMobileControllerObservationRef(candidate.beforeObservation);
  const claimedAt = safeTimestamp(candidate.claimedAt);
  const createdAt = safeTimestamp(candidate.createdAt);
  const expiresAt = safeTimestamp(candidate.expiresAt);
  const dispatchIdentity = candidate.dispatchIdentity;

  if (
    !handoffId ||
    !claimToken ||
    controllerId !== capability.controllerId ||
    controllerContractVersion !== capability.controllerContractVersion ||
    capabilityDigest !== capability.capabilityDigest ||
    dispatchIdentity.toolName !== MOBILE_UI_ACTION_TOOL_NAME ||
    !action ||
    !actionDigest ||
    actionDigest !== `sha256:${dispatchIdentity.requestDigest}` ||
    !beforeObservation ||
    !mobileControllerActionReferencesObservation(action, beforeObservation.observationId) ||
    claimedAt === null ||
    createdAt === null ||
    expiresAt === null ||
    createdAt < claimedAt ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > capability.timeoutMs
  ) {
    return null;
  }

  return Object.freeze({
    version: MOBILE_CONTROLLER_CONTRACT_VERSION,
    handoffId,
    claimToken,
    dispatchIdentity: cloneDispatchIdentity(dispatchIdentity),
    controllerId,
    controllerContractVersion,
    capabilityDigest,
    action,
    actionDigest,
    beforeObservation,
    claimedAt,
    createdAt,
    expiresAt,
  });
}

function qualifyCorrelation(candidate: unknown): MobileControllerOutcomeCorrelation | null {
  if (
    !isPlainRecord(candidate) ||
    !hasExactKeys(candidate, ['effectId', 'executionRunId', 'runId', 'toolCallId'])
  ) {
    return null;
  }
  const runId = exactString(candidate.runId, 200);
  const effectId = exactString(candidate.effectId, 200);
  const executionRunId = exactString(candidate.executionRunId, 256);
  const toolCallId = exactString(candidate.toolCallId, 200);
  return runId && effectId && executionRunId && toolCallId
    ? Object.freeze({ runId, effectId, executionRunId, toolCallId })
    : null;
}

function qualifyStabilization(candidate: unknown): MobileControllerStabilizationEvidence | null {
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ['durationMs', 'sampleCount'])) {
    return null;
  }
  const durationMs = safeInteger(candidate.durationMs, 0, 120_000);
  const sampleCount = safeInteger(candidate.sampleCount, 1, 1_000);
  return durationMs !== null && sampleCount !== null
    ? Object.freeze({ durationMs, sampleCount })
    : null;
}

function executionMatchesEffect(
  executionState: ToolExecutionState,
  effectState: MobileControllerTerminalEffectState,
): boolean {
  switch (executionState) {
    case 'completed':
      return effectState === 'applied' || effectState === 'failed' || effectState === 'unknown';
    case 'failed':
    case 'timed_out':
      return effectState === 'failed' || effectState === 'unknown';
    case 'cancelled':
      return effectState === 'cancelled' || effectState === 'unknown';
    case 'unknown':
      return effectState === 'unknown';
  }
}

export function qualifyMobileControllerOutcome(candidate: unknown): MobileControllerOutcome | null {
  if (
    !isPlainRecord(candidate) ||
    !hasOnlyKeys(candidate, OUTCOME_KEYS) ||
    candidate.version !== MOBILE_CONTROLLER_CONTRACT_VERSION
  ) {
    return null;
  }
  const outcomeId =
    typeof candidate.outcomeId === 'string' && OUTCOME_ID_PATTERN.test(candidate.outcomeId)
      ? candidate.outcomeId
      : null;
  const handoffId =
    typeof candidate.handoffId === 'string' && HANDOFF_ID_PATTERN.test(candidate.handoffId)
      ? candidate.handoffId
      : null;
  const controllerId = exactString(candidate.controllerId, 200);
  const capabilityDigest = digest(candidate.capabilityDigest);
  const correlation = qualifyCorrelation(candidate.correlation);
  const executionState = enumValue(candidate.executionState, TOOL_EXECUTION_STATES);
  const effectState = enumValue(candidate.effectState, TERMINAL_EFFECT_STATES);
  const verificationState = enumValue(candidate.verificationState, TOOL_EFFECT_VERIFICATION_STATES);
  const observableDelta = enumValue(candidate.observableDelta, MOBILE_CONTROLLER_OBSERVABLE_DELTAS);
  const reasonCode =
    candidate.reasonCode === undefined
      ? undefined
      : enumValue(candidate.reasonCode, MOBILE_CONTROLLER_REASON_CODES);
  const beforeObservationId = exactString(candidate.beforeObservationId, 200);
  const afterObservation =
    candidate.afterObservation === undefined
      ? undefined
      : qualifyMobileControllerObservationRef(candidate.afterObservation);
  const stabilization =
    candidate.stabilization === undefined
      ? undefined
      : qualifyStabilization(candidate.stabilization);
  const observedAt = safeTimestamp(candidate.observedAt);

  if (
    !outcomeId ||
    !handoffId ||
    !controllerId ||
    !capabilityDigest ||
    !correlation ||
    !executionState ||
    !effectState ||
    !verificationState ||
    !observableDelta ||
    (candidate.reasonCode !== undefined && !reasonCode) ||
    !beforeObservationId ||
    (candidate.afterObservation !== undefined && !afterObservation) ||
    (candidate.stabilization !== undefined && !stabilization) ||
    observedAt === null ||
    (observableDelta !== 'unknown' && !afterObservation) ||
    !executionMatchesEffect(executionState, effectState) ||
    !isToolEffectStateCombinationValid({
      transportState: 'returned',
      effectState,
      verificationState,
    })
  ) {
    return null;
  }

  return Object.freeze({
    version: MOBILE_CONTROLLER_CONTRACT_VERSION,
    outcomeId,
    handoffId,
    controllerId,
    capabilityDigest,
    correlation,
    executionState,
    effectState,
    verificationState,
    observableDelta,
    ...(reasonCode ? { reasonCode } : {}),
    beforeObservationId,
    ...(afterObservation ? { afterObservation } : {}),
    ...(stabilization ? { stabilization } : {}),
    observedAt,
  });
}

export function mobileControllerOutcomesMatch(
  left: MobileControllerOutcome,
  right: MobileControllerOutcome,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
