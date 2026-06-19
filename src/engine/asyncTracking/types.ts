import type {
  AgentRunAsyncOperation,
  AgentRunAsyncOperationKind,
  AgentRunAsyncOperationStatus,
} from '../../types/agentRun';

export type AsyncOperationKind = AgentRunAsyncOperationKind;

export type AsyncOperationStatus = AgentRunAsyncOperationStatus;

export interface TrackedAsyncOperation extends AgentRunAsyncOperation {}

export const TERMINAL_OPERATION_STATUSES = new Set<AsyncOperationStatus>([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);
