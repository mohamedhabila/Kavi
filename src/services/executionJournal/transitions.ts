import type {
  ExecutionEffectStatus,
  ExecutionExternalHandleStatus,
  ExecutionRunStatus,
} from './types';

const RUN_TRANSITIONS = {
  queued: ['running', 'blocked', 'failed', 'cancelled', 'interrupted'],
  running: ['waiting', 'blocked', 'succeeded', 'failed', 'cancelled', 'interrupted', 'ambiguous'],
  waiting: ['running', 'blocked', 'succeeded', 'failed', 'cancelled', 'interrupted', 'ambiguous'],
  blocked: ['queued', 'running', 'failed', 'cancelled', 'interrupted'],
  succeeded: [],
  failed: [],
  cancelled: [],
  interrupted: [
    'queued',
    'running',
    'waiting',
    'blocked',
    'succeeded',
    'failed',
    'cancelled',
    'ambiguous',
  ],
  ambiguous: ['running', 'waiting', 'blocked', 'succeeded', 'failed', 'cancelled', 'interrupted'],
} as const satisfies Record<ExecutionRunStatus, readonly ExecutionRunStatus[]>;

const EFFECT_TRANSITIONS = {
  planned: ['started'],
  started: ['applied', 'failed', 'cancelled', 'ambiguous'],
  applied: ['verified', 'ambiguous'],
  verified: [],
  failed: [],
  cancelled: [],
  ambiguous: ['applied', 'verified', 'failed', 'cancelled'],
} as const satisfies Record<ExecutionEffectStatus, readonly ExecutionEffectStatus[]>;

const EXTERNAL_HANDLE_TRANSITIONS = {
  unknown: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
  pending: ['unknown', 'running', 'succeeded', 'failed', 'cancelled'],
  running: ['unknown', 'succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<
  ExecutionExternalHandleStatus,
  readonly ExecutionExternalHandleStatus[]
>;

export function canTransitionExecutionRun(
  from: ExecutionRunStatus,
  to: ExecutionRunStatus,
): boolean {
  return (RUN_TRANSITIONS[from] as readonly ExecutionRunStatus[]).includes(to);
}

export function canTransitionExecutionEffect(
  from: ExecutionEffectStatus,
  to: ExecutionEffectStatus,
): boolean {
  return (EFFECT_TRANSITIONS[from] as readonly ExecutionEffectStatus[]).includes(to);
}

export function canTransitionExecutionExternalHandle(
  from: ExecutionExternalHandleStatus,
  to: ExecutionExternalHandleStatus,
): boolean {
  return (EXTERNAL_HANDLE_TRANSITIONS[from] as readonly ExecutionExternalHandleStatus[]).includes(
    to,
  );
}
