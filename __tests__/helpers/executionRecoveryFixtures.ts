import type {
  ExecutionCheckpointBoundary,
  ExecutionCheckpointPhase,
  ExecutionCheckpointRecord,
  ExecutionEffectRecord,
  ExecutionEffectStatus,
  ExecutionExternalHandleRecord,
  ExecutionExternalHandleStatus,
  ExecutionMonitorRecord,
  ExecutionRunRecord,
} from '../../src/services/executionJournal/types';
import type { ExecutionJournalSnapshot } from '../../src/services/executionJournal/recoveryPlanner';
import type { ExecutionRecoveryForegroundOwner } from '../../src/services/executionJournal/recoveryPlanner';

export const RECOVERY_DIGEST_A = 'a'.repeat(64);
export const RECOVERY_DIGEST_B = 'b'.repeat(64);
export const RECOVERY_DIGEST_C = 'c'.repeat(64);
export const RECOVERY_DIGEST_D = 'd'.repeat(64);

export function recoveryRun(overrides: Partial<ExecutionRunRecord> = {}): ExecutionRunRecord {
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
    status: 'running',
    resumeStrategy: 'reconcile_first',
    approvalState: 'not_required',
    permissionState: 'granted',
    inputDigest: RECOVERY_DIGEST_A,
    modelConfigDigest: RECOVERY_DIGEST_B,
    retryCount: 0,
    nextRetryPolicy: 'reconcile_before_retry',
    controlEpoch: 0,
    createdAt: 10,
    updatedAt: 100,
    terminalAt: null,
    ...overrides,
  };
}

export function recoveryCheckpoint(
  overrides: Partial<ExecutionCheckpointRecord> & {
    boundary?: ExecutionCheckpointBoundary;
    phase?: ExecutionCheckpointPhase;
  } = {},
): ExecutionCheckpointRecord {
  return {
    id: 'checkpoint-1',
    runId: 'run-1',
    sequence: 1,
    taskId: 'task-1',
    goalId: 'goal-1',
    phase: 'work',
    boundary: 'before_model',
    stateRefId: 'state-0',
    stateDigest: RECOVERY_DIGEST_C,
    resumeStrategy: 'reconcile_first',
    approvalState: 'not_required',
    permissionState: 'granted',
    controlEpoch: 0,
    createdAt: 20,
    ...overrides,
  };
}

export function recoveryInitialCheckpoint(
  overrides: Partial<ExecutionCheckpointRecord> = {},
): ExecutionCheckpointRecord {
  return recoveryCheckpoint({
    id: 'checkpoint-0',
    sequence: 0,
    phase: 'system',
    boundary: 'run_created',
    stateRefId: 'state-initial',
    createdAt: 10,
    ...overrides,
  });
}

export function recoveryCheckpointHistory(
  overrides: Partial<ExecutionCheckpointRecord> & {
    boundary?: ExecutionCheckpointBoundary;
    phase?: ExecutionCheckpointPhase;
  } = {},
): ExecutionCheckpointRecord[] {
  if (overrides.boundary === 'run_created') {
    return [recoveryInitialCheckpoint(overrides)];
  }
  return [recoveryInitialCheckpoint(), recoveryCheckpoint(overrides)];
}

export function recoverySettledEffectHistory(
  overrides: Partial<ExecutionCheckpointRecord> & {
    boundary?: ExecutionCheckpointBoundary;
    phase?: ExecutionCheckpointPhase;
  } = {},
): ExecutionCheckpointRecord[] {
  return [
    recoveryInitialCheckpoint(),
    recoveryCheckpoint({ boundary: 'before_effect' }),
    recoveryCheckpoint({
      id: 'checkpoint-2',
      sequence: 2,
      boundary: 'before_model',
      createdAt: 50,
      ...overrides,
    }),
  ];
}

export function recoveryEffect(
  status: ExecutionEffectStatus = 'planned',
  overrides: Partial<ExecutionEffectRecord> = {},
): ExecutionEffectRecord {
  const started = status !== 'planned';
  const completed = ['applied', 'verified', 'failed', 'cancelled'].includes(status);
  return {
    id: 'effect-1',
    runId: 'run-1',
    checkpointId: 'checkpoint-1',
    toolCallId: 'tool-call-1',
    toolNameDigest: RECOVERY_DIGEST_A,
    toolContractIdentityDigest: null,
    effectClass: 'external_run',
    idempotencyClass: 'declared_idempotent',
    idempotencyKeyDigest: RECOVERY_DIGEST_D,
    requestDigest: RECOVERY_DIGEST_B,
    modelAuthorityValidUntil: null,
    outcomeDigest: completed ? RECOVERY_DIGEST_C : null,
    status,
    retryPolicy: 'reconcile_before_retry',
    attempt: 1,
    createdAt: 30,
    startedAt: started ? 31 : null,
    completedAt: completed ? 32 : null,
    updatedAt: completed ? 32 : started ? 31 : 30,
    ...overrides,
  };
}

export function recoveryHandle(
  status: ExecutionExternalHandleStatus = 'pending',
  overrides: Partial<ExecutionExternalHandleRecord> = {},
): ExecutionExternalHandleRecord {
  return {
    id: 'handle-1',
    runId: 'run-1',
    effectId: 'effect-1',
    locator: {
      version: 1,
      kind: 'expo_workflow_run',
      projectId: 'project-1',
      workflowRunId: 'workflow-run-1',
      credentialRef: 'EXPO_TOKEN',
    },
    sourceToolNameDigest: RECOVERY_DIGEST_A,
    status,
    createdAt: 40,
    updatedAt: 40,
    lastAttemptedAt: 40,
    lastVerifiedAt: 40,
    ...overrides,
  };
}

export function recoveryMonitor(
  handle: ExecutionExternalHandleRecord = recoveryHandle(),
  overrides: Partial<ExecutionMonitorRecord> = {},
): ExecutionMonitorRecord {
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(handle.status);
  return {
    id: `monitor-${handle.id}`,
    runId: handle.runId,
    externalHandleId: handle.id,
    baselineStatus: handle.status,
    condition: 'external_handle_terminal',
    action: 'reconcile_external_handle',
    state: terminal ? 'acted' : 'armed',
    nextLegalCheckAt: terminal ? null : handle.updatedAt,
    lastObservedStatus: handle.status,
    observationCount: 1,
    lastObservedAt: handle.updatedAt,
    conditionMetAt: terminal ? handle.updatedAt : null,
    actedAt: terminal ? handle.updatedAt : null,
    createdAt: handle.createdAt,
    updatedAt: handle.updatedAt,
    ...overrides,
  };
}

export function recoverySnapshot(
  input: {
    run?: ExecutionRunRecord;
    foregroundOwner?: ExecutionRecoveryForegroundOwner;
    checkpoints?: ExecutionCheckpointRecord[];
    effects?: ExecutionEffectRecord[];
    handles?: ExecutionExternalHandleRecord[];
    monitors?: ExecutionMonitorRecord[];
  } = {},
): ExecutionJournalSnapshot {
  const checkpoints = input.checkpoints ?? recoveryCheckpointHistory();
  const latest = [...checkpoints].sort((left, right) => left.sequence - right.sequence).at(-1);
  const baseRun = input.run ?? recoveryRun();
  const handles = input.handles ?? [];
  return {
    run: latest
      ? {
          ...baseRun,
          resumeStrategy: latest.resumeStrategy,
          approvalState: latest.approvalState,
          permissionState: latest.permissionState,
        }
      : baseRun,
    ...(input.foregroundOwner ? { foregroundOwner: input.foregroundOwner } : {}),
    checkpoints,
    effects: input.effects ?? [],
    externalHandles: handles,
    monitors: input.monitors ?? handles.map((handle) => recoveryMonitor(handle)),
  };
}
