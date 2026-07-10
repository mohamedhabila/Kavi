import {
  appendExecutionCheckpoint,
  createExecutionRun,
  planExecutionEffect,
  transitionExecutionEffect,
  transitionExecutionRun,
} from '../../src/services/executionJournal/mutations';
import type {
  ExecutionCheckpointRecord,
  ExecutionApprovalState,
  ExecutionEffectClass,
  ExecutionIdempotencyClass,
  ExecutionRetryPolicy,
  ExecutionRunRecord,
} from '../../src/services/executionJournal/types';

export const DIGEST_A = 'a'.repeat(64);
export const DIGEST_B = 'b'.repeat(64);
export const DIGEST_C = 'c'.repeat(64);
export const DIGEST_D = 'd'.repeat(64);

export function executionRunRecord(
  overrides: Partial<ExecutionRunRecord> = {},
): ExecutionRunRecord {
  return {
    id: 'run-1',
    conversationId: 'conversation-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    goalId: 'goal-1',
    requestMessageId: 'message-1',
    durabilityClass: 'user_initiated_continuable',
    requestedCapability: 'write',
    executionSurface: 'builtin_tool',
    status: 'queued',
    resumeStrategy: 'replay_safe',
    approvalState: 'not_required',
    permissionState: 'granted',
    inputDigest: DIGEST_A,
    modelConfigDigest: DIGEST_B,
    retryCount: 0,
    nextRetryPolicy: 'replay_safe',
    controlEpoch: 0,
    createdAt: 10,
    updatedAt: 10,
    terminalAt: null,
    ...overrides,
  };
}

export function executionCheckpointRecord(
  run: ExecutionRunRecord,
  overrides: Partial<ExecutionCheckpointRecord> = {},
): ExecutionCheckpointRecord {
  return {
    id: 'checkpoint-0',
    runId: run.id,
    sequence: 0,
    taskId: run.taskId,
    goalId: run.goalId,
    phase: 'system',
    boundary: 'run_created',
    stateRefId: 'state-0',
    stateDigest: DIGEST_C,
    resumeStrategy: run.resumeStrategy,
    approvalState: run.approvalState,
    permissionState: run.permissionState,
    controlEpoch: run.controlEpoch,
    createdAt: run.createdAt,
    ...overrides,
  };
}

export function seedExecutionRun(overrides: Partial<ExecutionRunRecord> = {}): ExecutionRunRecord {
  const run = executionRunRecord(overrides);
  createExecutionRun({ run, initialCheckpoint: executionCheckpointRecord(run) });
  return run;
}

export function startExecutionRun(
  runId = 'run-1',
  occurredAt = 11,
  nextControlEpoch = 0,
): ExecutionRunRecord {
  return transitionExecutionRun({
    runId,
    expectedStatus: 'queued',
    nextStatus: 'running',
    expectedControlEpoch: 0,
    nextControlEpoch,
    occurredAt,
  });
}

export function appendBeforeEffectCheckpoint(
  input: {
    runId?: string;
    id?: string;
    expectedControlEpoch?: number;
    createdAt?: number;
    approvalState?: ExecutionApprovalState;
    permissionState?: ExecutionApprovalState;
  } = {},
): ExecutionCheckpointRecord {
  return appendExecutionCheckpoint({
    id: input.id ?? 'checkpoint-effect',
    runId: input.runId ?? 'run-1',
    expectedControlEpoch: input.expectedControlEpoch ?? 0,
    taskId: 'task-1',
    goalId: 'goal-1',
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-effect',
    stateDigest: DIGEST_C,
    resumeStrategy: 'replay_safe',
    approvalState: input.approvalState ?? 'not_required',
    permissionState: input.permissionState ?? 'granted',
    createdAt: input.createdAt ?? 12,
  });
}

export function planFixtureEffect(
  input: {
    runId?: string;
    checkpointId?: string;
    id?: string;
    expectedControlEpoch?: number;
    createdAt?: number;
    effectClass?: ExecutionEffectClass;
    idempotencyClass?: ExecutionIdempotencyClass;
    retryPolicy?: ExecutionRetryPolicy;
  } = {},
) {
  return planExecutionEffect({
    id: input.id ?? 'effect-1',
    runId: input.runId ?? 'run-1',
    checkpointId: input.checkpointId ?? 'checkpoint-effect',
    expectedControlEpoch: input.expectedControlEpoch ?? 0,
    toolCallId: `tool-call-${input.id ?? '1'}`,
    toolNameDigest: DIGEST_A,
    effectClass: input.effectClass ?? 'external_run',
    idempotencyClass: input.idempotencyClass ?? 'declared_idempotent',
    idempotencyKeyDigest: DIGEST_D,
    requestDigest: DIGEST_B,
    retryPolicy: input.retryPolicy ?? 'reconcile_before_retry',
    attempt: 1,
    createdAt: input.createdAt ?? 13,
  });
}

export function seedPlannedFixtureEffect(): void {
  seedExecutionRun();
  startExecutionRun();
  appendBeforeEffectCheckpoint();
  planFixtureEffect();
}

export function startFixtureEffect(occurredAt = 14): void {
  appendBeforeEffectCheckpoint({ id: 'checkpoint-authority', createdAt: occurredAt });
  transitionExecutionEffect({
    runId: 'run-1',
    effectId: 'effect-1',
    expectedStatus: 'planned',
    nextStatus: 'started',
    expectedControlEpoch: 0,
    occurredAt,
    executionAuthorityCheckpointId: 'checkpoint-authority',
  });
}
