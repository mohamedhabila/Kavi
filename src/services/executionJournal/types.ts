export const EXECUTION_DURABILITY_CLASSES = [
  'foreground_interactive',
  'user_initiated_continuable',
  'deferrable_maintenance',
  'event_driven_monitor',
  'external_durable_operation',
] as const;

export const EXECUTION_RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'blocked',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'ambiguous',
] as const;

export const RETENTION_DELETABLE_RUN_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

export const EXECUTION_RESUME_STRATEGIES = [
  'replay_safe',
  'reconcile_first',
  'monitor_only',
  'not_resumable',
] as const;

export const EXECUTION_RETRY_POLICIES = [
  'none',
  'replay_safe',
  'reconcile_before_retry',
  'monitor_only',
  'manual',
] as const;

export const EXECUTION_APPROVAL_STATES = [
  'not_required',
  'pending',
  'granted',
  'denied',
  'expired',
  'unknown',
] as const;

export const EXECUTION_CAPABILITIES = [
  'discover',
  'read',
  'write',
  'commit',
  'push',
  'deploy',
  'monitor',
  'wait',
  'verify',
  'coordinate',
  'compute',
] as const;

export const EXECUTION_SURFACES = [
  'direct_answer',
  'model',
  'builtin_tool',
  'native_tool',
  'mcp',
  'browser',
  'ssh',
  'delegated_worker',
  'external_api',
] as const;

export const EXECUTION_CHECKPOINT_PHASES = [
  'system',
  'assess',
  'plan',
  'work',
  'review',
  'pilot',
  'deliver',
] as const;

export const EXECUTION_CHECKPOINT_BOUNDARIES = [
  'run_created',
  'before_model',
  'after_model',
  'before_effect',
  'after_effect',
  'waiting_approval',
  'waiting_external',
  'safe_yield',
  'terminal',
] as const;

/** Hard per-run history bound. Recovery rejects missing history instead of silently truncating it. */
export const MAX_EXECUTION_CHECKPOINTS_PER_RUN = 256;

export const EXECUTION_EFFECT_CLASSES = [
  'none',
  'local_artifact',
  'remote_mutation',
  'external_run',
  'destructive',
  'unknown',
] as const;

export const EXECUTION_IDEMPOTENCY_CLASSES = [
  'effect_free',
  'declared_idempotent',
  'not_declared',
  'unknown',
] as const;

export const EXECUTION_EFFECT_STATUSES = [
  'planned',
  'started',
  'applied',
  'verified',
  'failed',
  'cancelled',
  'ambiguous',
] as const;

export const EXECUTION_EXTERNAL_HANDLE_KINDS = [
  'expo_workflow_run',
  'github_workflow_run',
] as const;

export const EXECUTION_EXTERNAL_HANDLE_STATUSES = [
  'unknown',
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const EXECUTION_MONITOR_CONDITIONS = ['external_handle_terminal'] as const;
export const EXECUTION_MONITOR_ACTIONS = ['reconcile_external_handle'] as const;
export const EXECUTION_MONITOR_STATES = ['armed', 'acted', 'blocked'] as const;

export type ExecutionDurabilityClass = (typeof EXECUTION_DURABILITY_CLASSES)[number];
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];
export type ExecutionResumeStrategy = (typeof EXECUTION_RESUME_STRATEGIES)[number];
export type ExecutionRetryPolicy = (typeof EXECUTION_RETRY_POLICIES)[number];
export type ExecutionApprovalState = (typeof EXECUTION_APPROVAL_STATES)[number];
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];
export type ExecutionSurface = (typeof EXECUTION_SURFACES)[number];
export type ExecutionCheckpointPhase = (typeof EXECUTION_CHECKPOINT_PHASES)[number];
export type ExecutionCheckpointBoundary = (typeof EXECUTION_CHECKPOINT_BOUNDARIES)[number];
export type ExecutionEffectClass = (typeof EXECUTION_EFFECT_CLASSES)[number];
export type ExecutionIdempotencyClass = (typeof EXECUTION_IDEMPOTENCY_CLASSES)[number];
export type ExecutionEffectStatus = (typeof EXECUTION_EFFECT_STATUSES)[number];
export type ExecutionExternalHandleKind = (typeof EXECUTION_EXTERNAL_HANDLE_KINDS)[number];
export type ExecutionExternalHandleStatus = (typeof EXECUTION_EXTERNAL_HANDLE_STATUSES)[number];
export type ExecutionMonitorCondition = (typeof EXECUTION_MONITOR_CONDITIONS)[number];
export type ExecutionMonitorAction = (typeof EXECUTION_MONITOR_ACTIONS)[number];
export type ExecutionMonitorState = (typeof EXECUTION_MONITOR_STATES)[number];

export interface ExecutionRunRecord {
  id: string;
  conversationId: string;
  threadId: string;
  taskId: string | null;
  goalId: string | null;
  requestMessageId: string;
  durabilityClass: ExecutionDurabilityClass;
  requestedCapability: ExecutionCapability;
  executionSurface: ExecutionSurface;
  status: ExecutionRunStatus;
  resumeStrategy: ExecutionResumeStrategy;
  approvalState: ExecutionApprovalState;
  permissionState: ExecutionApprovalState;
  inputDigest: string;
  modelConfigDigest: string;
  retryCount: number;
  nextRetryPolicy: ExecutionRetryPolicy;
  controlEpoch: number;
  createdAt: number;
  updatedAt: number;
  terminalAt: number | null;
}

export interface ExecutionCheckpointRecord {
  id: string;
  runId: string;
  sequence: number;
  taskId: string | null;
  goalId: string | null;
  phase: ExecutionCheckpointPhase;
  boundary: ExecutionCheckpointBoundary;
  stateRefId: string;
  stateDigest: string;
  resumeStrategy: ExecutionResumeStrategy;
  approvalState: ExecutionApprovalState;
  permissionState: ExecutionApprovalState;
  controlEpoch: number;
  createdAt: number;
}

export interface ExecutionEffectRecord {
  id: string;
  runId: string;
  checkpointId: string | null;
  toolCallId: string;
  toolNameDigest: string;
  toolContractIdentityDigest: string | null;
  effectClass: ExecutionEffectClass;
  idempotencyClass: ExecutionIdempotencyClass;
  idempotencyKeyDigest: string | null;
  requestDigest: string;
  modelAuthorityValidUntil: number | null;
  outcomeDigest: string | null;
  status: ExecutionEffectStatus;
  retryPolicy: ExecutionRetryPolicy;
  attempt: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface ExecutionExternalHandleRecord {
  id: string;
  runId: string;
  effectId: string;
  locator: ExecutionExternalHandleLocator;
  sourceToolNameDigest: string;
  status: ExecutionExternalHandleStatus;
  createdAt: number;
  updatedAt: number;
  lastAttemptedAt: number;
  lastVerifiedAt: number | null;
}

export interface ExecutionMonitorRecord {
  id: string;
  runId: string;
  externalHandleId: string;
  baselineStatus: ExecutionExternalHandleStatus;
  condition: ExecutionMonitorCondition;
  action: ExecutionMonitorAction;
  state: ExecutionMonitorState;
  nextLegalCheckAt: number | null;
  lastObservedStatus: ExecutionExternalHandleStatus;
  observationCount: number;
  lastObservedAt: number;
  conditionMetAt: number | null;
  actedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
import type { ExecutionExternalHandleLocator } from './externalLocators';
