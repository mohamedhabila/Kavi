import type { ExecutionRunStatus } from './types';

export const FOREGROUND_MODEL_ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'blocked',
  'interrupted',
  'ambiguous',
] as const;

export type ForegroundModelTerminalStatus = Extract<
  ExecutionRunStatus,
  'succeeded' | 'failed' | 'cancelled'
>;

export interface ForegroundModelExecutionLease {
  runId: string;
  conversationId: string;
  requestMessageId: string;
  assistantMessageId: string;
  taskId: string | null;
  createdAt: number;
  expectedStatus: ExecutionRunStatus;
  controlEpoch: number;
  updatedAt: number;
  checkpointId: string;
  checkpointStateDigest: string;
}

export interface BeginForegroundModelExecutionInput {
  conversationId: string;
  requestMessageId: string;
  assistantMessageId: string;
  taskId?: string;
  requestState: unknown;
  modelState: unknown;
}

export interface CompleteForegroundModelExecutionInput {
  lease: ForegroundModelExecutionLease;
  status: ForegroundModelTerminalStatus;
  projectionMessageId: string;
  projectionState: unknown;
}

export interface ActivateForegroundModelExecutionInput {
  lease: ForegroundModelExecutionLease;
}

export interface ForegroundModelExecutionCursor {
  createdAt: number;
  runId: string;
}

export interface ListPendingForegroundModelExecutionsInput {
  limit?: number;
  after?: ForegroundModelExecutionCursor;
}

export type ForegroundModelExecutionLifecycle =
  | 'active'
  | 'terminal'
  | 'missing'
  | 'not_foreground_model';
