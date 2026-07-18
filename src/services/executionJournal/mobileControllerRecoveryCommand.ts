import { qualifyAgentRunMobileControllerHandoffRef } from '../agents/mobileControllerAsyncOperation';
import type { ExecutionRecoveryCommand } from './recoveryPlanner';

export type MobileControllerRecoveryCommand = Extract<
  ExecutionRecoveryCommand,
  { kind: 'await_mobile_controller_handoff' }
>;

const COMMAND_KEYS = [
  'agentRunId',
  'checkpointId',
  'controlEpoch',
  'conversationId',
  'externalStatus',
  'foregroundControlEpoch',
  'foregroundExecutionRunId',
  'foregroundUpdatedAt',
  'handoff',
  'kind',
  'requestMessageId',
  'runId',
  'stateDigest',
  'stateRefId',
  'updatedAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === COMMAND_KEYS.length &&
    actual.every((key, index) => key === COMMAND_KEYS[index])
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function qualifyMobileControllerRecoveryCommand(
  candidate: unknown,
): MobileControllerRecoveryCommand | null {
  if (
    !isRecord(candidate) ||
    candidate.kind !== 'await_mobile_controller_handoff' ||
    !hasExactKeys(candidate)
  ) {
    return null;
  }
  const handoff = qualifyAgentRunMobileControllerHandoffRef(candidate.handoff);
  if (
    !validId(candidate.runId) ||
    !validId(candidate.checkpointId) ||
    !validInteger(candidate.controlEpoch) ||
    !validId(candidate.stateRefId) ||
    !validDigest(candidate.stateDigest) ||
    !validId(candidate.conversationId) ||
    !validId(candidate.foregroundExecutionRunId) ||
    !validInteger(candidate.foregroundControlEpoch) ||
    !validInteger(candidate.foregroundUpdatedAt) ||
    !validId(candidate.agentRunId) ||
    !validId(candidate.requestMessageId) ||
    !['unknown', 'pending', 'running'].includes(candidate.externalStatus as string) ||
    !validInteger(candidate.updatedAt) ||
    !handoff ||
    handoff.effectRunId !== candidate.runId ||
    handoff.executionRunId !== candidate.foregroundExecutionRunId ||
    handoff.controlEpoch !== candidate.controlEpoch
  ) {
    return null;
  }
  return {
    kind: 'await_mobile_controller_handoff',
    runId: candidate.runId,
    checkpointId: candidate.checkpointId,
    controlEpoch: candidate.controlEpoch,
    stateRefId: candidate.stateRefId,
    stateDigest: candidate.stateDigest,
    conversationId: candidate.conversationId,
    foregroundExecutionRunId: candidate.foregroundExecutionRunId,
    foregroundControlEpoch: candidate.foregroundControlEpoch,
    foregroundUpdatedAt: candidate.foregroundUpdatedAt,
    agentRunId: candidate.agentRunId,
    requestMessageId: candidate.requestMessageId,
    externalStatus: candidate.externalStatus as MobileControllerRecoveryCommand['externalStatus'],
    updatedAt: candidate.updatedAt,
    handoff,
  };
}

export function canonicalMobileControllerRecoveryCommand(
  command: MobileControllerRecoveryCommand,
): string {
  return JSON.stringify([
    command.kind,
    command.runId,
    command.checkpointId,
    command.controlEpoch,
    command.stateRefId,
    command.stateDigest,
    command.conversationId,
    command.foregroundExecutionRunId,
    command.foregroundControlEpoch,
    command.foregroundUpdatedAt,
    command.agentRunId,
    command.requestMessageId,
    command.externalStatus,
    command.updatedAt,
    command.handoff,
  ]);
}
