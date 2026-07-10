import {
  EXECUTION_APPROVAL_STATES,
  EXECUTION_CAPABILITIES,
  EXECUTION_CHECKPOINT_BOUNDARIES,
  EXECUTION_CHECKPOINT_PHASES,
  EXECUTION_DURABILITY_CLASSES,
  EXECUTION_EFFECT_CLASSES,
  EXECUTION_EFFECT_STATUSES,
  EXECUTION_EXTERNAL_HANDLE_KINDS,
  EXECUTION_EXTERNAL_HANDLE_STATUSES,
  EXECUTION_IDEMPOTENCY_CLASSES,
  EXECUTION_RESUME_STRATEGIES,
  EXECUTION_RETRY_POLICIES,
  EXECUTION_RUN_STATUSES,
  EXECUTION_SURFACES,
  RETENTION_DELETABLE_RUN_STATUSES,
  type ExecutionCheckpointRecord,
  type ExecutionEffectRecord,
  type ExecutionExternalHandleRecord,
  type ExecutionRunRecord,
} from './types';
import {
  qualifyExecutionExternalHandleLocator,
  type ExecutionExternalHandleLocator,
} from './externalLocators';

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`execution_journal_malformed_row:${label}`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  row: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(row).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`execution_journal_malformed_row:${label}:columns`);
  }
}

function requireId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`execution_journal_malformed_row:${label}`);
  }
  return value;
}

function nullableId(value: unknown, label: string): string | null {
  return value === null ? null : requireId(value, label);
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`execution_journal_malformed_row:${label}`);
  }
  return value;
}

function nullableDigest(value: unknown, label: string): string | null {
  return value === null ? null : requireDigest(value, label);
}

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`execution_journal_malformed_row:${label}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string, minimum = 0): number | null {
  return value === null ? null : requireInteger(value, label, minimum);
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`execution_journal_malformed_row:${label}`);
  }
  return value as T;
}

const RUN_COLUMNS = [
  'id',
  'conversation_id',
  'thread_id',
  'task_id',
  'goal_id',
  'request_message_id',
  'durability_class',
  'requested_capability',
  'execution_surface',
  'status',
  'resume_strategy',
  'approval_state',
  'permission_state',
  'input_digest',
  'model_config_digest',
  'retry_count',
  'next_retry_policy',
  'control_epoch',
  'created_at',
  'updated_at',
  'terminal_at',
] as const;

export function decodeExecutionRunRow(value: unknown): ExecutionRunRecord {
  const row = requireRecord(value, 'run');
  requireExactKeys(row, RUN_COLUMNS, 'run');
  const createdAt = requireInteger(row.created_at, 'run.created_at');
  const updatedAt = requireInteger(row.updated_at, 'run.updated_at');
  const terminalAt = nullableInteger(row.terminal_at, 'run.terminal_at');
  const status = requireEnum(row.status, EXECUTION_RUN_STATUSES, 'run.status');
  const isRetentionTerminal = (RETENTION_DELETABLE_RUN_STATUSES as readonly string[]).includes(
    status,
  );
  if (
    updatedAt < createdAt ||
    (isRetentionTerminal
      ? terminalAt === null || terminalAt < createdAt || terminalAt > updatedAt
      : terminalAt !== null)
  ) {
    throw new Error('execution_journal_malformed_row:run:timeline');
  }

  return {
    id: requireId(row.id, 'run.id'),
    conversationId: requireId(row.conversation_id, 'run.conversation_id'),
    threadId: requireId(row.thread_id, 'run.thread_id'),
    taskId: nullableId(row.task_id, 'run.task_id'),
    goalId: nullableId(row.goal_id, 'run.goal_id'),
    requestMessageId: requireId(row.request_message_id, 'run.request_message_id'),
    durabilityClass: requireEnum(
      row.durability_class,
      EXECUTION_DURABILITY_CLASSES,
      'run.durability_class',
    ),
    requestedCapability: requireEnum(
      row.requested_capability,
      EXECUTION_CAPABILITIES,
      'run.requested_capability',
    ),
    executionSurface: requireEnum(
      row.execution_surface,
      EXECUTION_SURFACES,
      'run.execution_surface',
    ),
    status,
    resumeStrategy: requireEnum(
      row.resume_strategy,
      EXECUTION_RESUME_STRATEGIES,
      'run.resume_strategy',
    ),
    approvalState: requireEnum(row.approval_state, EXECUTION_APPROVAL_STATES, 'run.approval_state'),
    permissionState: requireEnum(
      row.permission_state,
      EXECUTION_APPROVAL_STATES,
      'run.permission_state',
    ),
    inputDigest: requireDigest(row.input_digest, 'run.input_digest'),
    modelConfigDigest: requireDigest(row.model_config_digest, 'run.model_config_digest'),
    retryCount: requireInteger(row.retry_count, 'run.retry_count'),
    nextRetryPolicy: requireEnum(
      row.next_retry_policy,
      EXECUTION_RETRY_POLICIES,
      'run.next_retry_policy',
    ),
    controlEpoch: requireInteger(row.control_epoch, 'run.control_epoch'),
    createdAt,
    updatedAt,
    terminalAt,
  };
}

const CHECKPOINT_COLUMNS = [
  'id',
  'run_id',
  'sequence',
  'task_id',
  'goal_id',
  'phase',
  'boundary',
  'state_ref_id',
  'state_digest',
  'resume_strategy',
  'approval_state',
  'permission_state',
  'control_epoch',
  'created_at',
] as const;

export function decodeExecutionCheckpointRow(value: unknown): ExecutionCheckpointRecord {
  const row = requireRecord(value, 'checkpoint');
  requireExactKeys(row, CHECKPOINT_COLUMNS, 'checkpoint');
  return {
    id: requireId(row.id, 'checkpoint.id'),
    runId: requireId(row.run_id, 'checkpoint.run_id'),
    sequence: requireInteger(row.sequence, 'checkpoint.sequence'),
    taskId: nullableId(row.task_id, 'checkpoint.task_id'),
    goalId: nullableId(row.goal_id, 'checkpoint.goal_id'),
    phase: requireEnum(row.phase, EXECUTION_CHECKPOINT_PHASES, 'checkpoint.phase'),
    boundary: requireEnum(row.boundary, EXECUTION_CHECKPOINT_BOUNDARIES, 'checkpoint.boundary'),
    stateRefId: requireId(row.state_ref_id, 'checkpoint.state_ref_id'),
    stateDigest: requireDigest(row.state_digest, 'checkpoint.state_digest'),
    resumeStrategy: requireEnum(
      row.resume_strategy,
      EXECUTION_RESUME_STRATEGIES,
      'checkpoint.resume_strategy',
    ),
    approvalState: requireEnum(
      row.approval_state,
      EXECUTION_APPROVAL_STATES,
      'checkpoint.approval_state',
    ),
    permissionState: requireEnum(
      row.permission_state,
      EXECUTION_APPROVAL_STATES,
      'checkpoint.permission_state',
    ),
    controlEpoch: requireInteger(row.control_epoch, 'checkpoint.control_epoch'),
    createdAt: requireInteger(row.created_at, 'checkpoint.created_at'),
  };
}

const EFFECT_COLUMNS = [
  'id',
  'run_id',
  'checkpoint_id',
  'tool_call_id',
  'tool_name_digest',
  'effect_class',
  'idempotency_class',
  'idempotency_key_digest',
  'request_digest',
  'outcome_digest',
  'status',
  'retry_policy',
  'attempt',
  'created_at',
  'started_at',
  'completed_at',
  'updated_at',
] as const;

export function decodeExecutionEffectRow(value: unknown): ExecutionEffectRecord {
  const row = requireRecord(value, 'effect');
  requireExactKeys(row, EFFECT_COLUMNS, 'effect');
  const createdAt = requireInteger(row.created_at, 'effect.created_at');
  const startedAt = nullableInteger(row.started_at, 'effect.started_at');
  const completedAt = nullableInteger(row.completed_at, 'effect.completed_at');
  const updatedAt = requireInteger(row.updated_at, 'effect.updated_at');
  const status = requireEnum(row.status, EXECUTION_EFFECT_STATUSES, 'effect.status');
  const validTimeline =
    updatedAt >= createdAt &&
    (startedAt === null || (startedAt >= createdAt && startedAt <= updatedAt)) &&
    (completedAt === null ||
      (startedAt !== null && completedAt >= startedAt && completedAt <= updatedAt)) &&
    ((status === 'planned' && startedAt === null && completedAt === null) ||
      (status === 'started' && startedAt !== null && completedAt === null) ||
      (status === 'ambiguous' && startedAt !== null) ||
      (['applied', 'verified', 'failed', 'cancelled'].includes(status) &&
        startedAt !== null &&
        completedAt !== null));
  if (!validTimeline) {
    throw new Error('execution_journal_malformed_row:effect:timeline');
  }

  return {
    id: requireId(row.id, 'effect.id'),
    runId: requireId(row.run_id, 'effect.run_id'),
    checkpointId: nullableId(row.checkpoint_id, 'effect.checkpoint_id'),
    toolCallId: requireId(row.tool_call_id, 'effect.tool_call_id'),
    toolNameDigest: requireDigest(row.tool_name_digest, 'effect.tool_name_digest'),
    effectClass: requireEnum(row.effect_class, EXECUTION_EFFECT_CLASSES, 'effect.effect_class'),
    idempotencyClass: requireEnum(
      row.idempotency_class,
      EXECUTION_IDEMPOTENCY_CLASSES,
      'effect.idempotency_class',
    ),
    idempotencyKeyDigest: nullableDigest(
      row.idempotency_key_digest,
      'effect.idempotency_key_digest',
    ),
    requestDigest: requireDigest(row.request_digest, 'effect.request_digest'),
    outcomeDigest: nullableDigest(row.outcome_digest, 'effect.outcome_digest'),
    status,
    retryPolicy: requireEnum(row.retry_policy, EXECUTION_RETRY_POLICIES, 'effect.retry_policy'),
    attempt: requireInteger(row.attempt, 'effect.attempt', 1),
    createdAt,
    startedAt,
    completedAt,
    updatedAt,
  };
}

const HANDLE_COLUMNS = [
  'id',
  'run_id',
  'effect_id',
  'handle_kind',
  'locator_version',
  'expo_project_id',
  'github_repository',
  'workflow_run_id',
  'credential_ref',
  'source_tool_name_digest',
  'status',
  'created_at',
  'updated_at',
  'last_attempted_at',
  'last_verified_at',
] as const;

export function decodeExecutionExternalHandleRow(value: unknown): ExecutionExternalHandleRecord {
  const row = requireRecord(value, 'external_handle');
  requireExactKeys(row, HANDLE_COLUMNS, 'external_handle');
  const createdAt = requireInteger(row.created_at, 'external_handle.created_at');
  const updatedAt = requireInteger(row.updated_at, 'external_handle.updated_at');
  const lastAttemptedAt = requireInteger(
    row.last_attempted_at,
    'external_handle.last_attempted_at',
  );
  const lastVerifiedAt = nullableInteger(row.last_verified_at, 'external_handle.last_verified_at');
  if (
    updatedAt < createdAt ||
    lastAttemptedAt < createdAt ||
    lastAttemptedAt > updatedAt ||
    (lastVerifiedAt !== null && (lastVerifiedAt < createdAt || lastVerifiedAt > updatedAt))
  ) {
    throw new Error('execution_journal_malformed_row:external_handle:timeline');
  }
  const handleKind = requireEnum(
    row.handle_kind,
    EXECUTION_EXTERNAL_HANDLE_KINDS,
    'external_handle.handle_kind',
  );
  const locatorCandidate: unknown =
    handleKind === 'expo_workflow_run'
      ? {
          version: row.locator_version,
          kind: handleKind,
          projectId: row.expo_project_id,
          workflowRunId: row.workflow_run_id,
          credentialRef: row.credential_ref,
        }
      : {
          version: row.locator_version,
          kind: handleKind,
          repository: row.github_repository,
          workflowRunId: row.workflow_run_id,
          credentialRef: row.credential_ref,
        };
  const locator = qualifyExecutionExternalHandleLocator(locatorCandidate);
  if (
    !locator ||
    (locator.kind === 'github_workflow_run' && locator.repository !== row.github_repository)
  ) {
    throw new Error('execution_journal_malformed_row:external_handle:locator');
  }
  return {
    id: requireId(row.id, 'external_handle.id'),
    runId: requireId(row.run_id, 'external_handle.run_id'),
    effectId: requireId(row.effect_id, 'external_handle.effect_id'),
    locator: locator as ExecutionExternalHandleLocator,
    sourceToolNameDigest: requireDigest(
      row.source_tool_name_digest,
      'external_handle.source_tool_name_digest',
    ),
    status: requireEnum(row.status, EXECUTION_EXTERNAL_HANDLE_STATUSES, 'external_handle.status'),
    createdAt,
    updatedAt,
    lastAttemptedAt,
    lastVerifiedAt,
  };
}
