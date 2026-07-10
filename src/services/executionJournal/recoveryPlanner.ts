import type {
  ExecutionApprovalState,
  ExecutionCheckpointBoundary,
  ExecutionCheckpointRecord,
  ExecutionEffectRecord,
  ExecutionEffectStatus,
  ExecutionExternalHandleRecord,
  ExecutionExternalHandleStatus,
  ExecutionMonitorRecord,
  ExecutionRunRecord,
  ExecutionRunStatus,
} from './types';

export const EXECUTION_RECOVERY_BLOCK_REASONS = [
  'snapshot_invalid',
  'no_checkpoint',
  'stale_control_epoch',
  'run_blocked',
  'approval_pending',
  'approval_denied',
  'approval_expired',
  'approval_unknown',
  'permission_pending',
  'permission_denied',
  'permission_expired',
  'permission_unknown',
  'unresolved_effect_without_reconciliation',
  'missing_external_handle',
  'unresolved_terminal_run',
  'ambiguous_run_without_evidence',
  'missing_terminal_projection',
  'terminal_boundary_status_mismatch',
  'unsupported_boundary',
] as const;

export type ExecutionRecoveryBlockReason = (typeof EXECUTION_RECOVERY_BLOCK_REASONS)[number];

export interface ExecutionJournalSnapshot {
  run: ExecutionRunRecord;
  checkpoints: readonly ExecutionCheckpointRecord[];
  effects: readonly ExecutionEffectRecord[];
  externalHandles: readonly ExecutionExternalHandleRecord[];
  monitors: readonly ExecutionMonitorRecord[];
}

interface CheckpointRecoveryPointer {
  runId: string;
  checkpointId: string;
  controlEpoch: number;
  stateRefId: string;
  stateDigest: string;
}

export type ExecutionRecoveryCommand =
  | ({
      kind: 'resume_model_step';
    } & CheckpointRecoveryPointer)
  | ({
      kind: 'resume_persisted_tool_batch';
      plannedEffectIds: string[];
      replayEffectIds: string[];
      requiresExecutionAuthorityRevalidation: true;
    } & CheckpointRecoveryPointer)
  | ({
      kind: 'continue_after_tool_result';
      completedEffectIds: string[];
    } & CheckpointRecoveryPointer)
  | {
      kind: 'reconcile_external_handles';
      runId: string;
      controlEpoch: number;
      effectIds: string[];
      handleIds: string[];
    }
  | ({
      kind: 'resume_review';
    } & CheckpointRecoveryPointer)
  | ({
      kind: 'finalize_existing_terminal_projection';
      terminalStatus: Extract<ExecutionRunStatus, 'succeeded' | 'failed' | 'cancelled'>;
      terminalAt: number;
    } & CheckpointRecoveryPointer)
  | {
      kind: 'block';
      runId: string;
      controlEpoch: number;
      reason: ExecutionRecoveryBlockReason;
      checkpointId: string | null;
      effectIds: string[];
      handleIds: string[];
    };

const RUN_RECOVERY_CLASS = {
  queued: 'active',
  running: 'active',
  waiting: 'active',
  blocked: 'blocked',
  succeeded: 'terminal',
  failed: 'terminal',
  cancelled: 'terminal',
  interrupted: 'active',
  ambiguous: 'ambiguous',
} as const satisfies Record<ExecutionRunStatus, 'active' | 'blocked' | 'terminal' | 'ambiguous'>;

const EFFECT_RECOVERY_CLASS = {
  planned: 'planned',
  started: 'uncertain',
  applied: 'applied',
  verified: 'completed',
  failed: 'completed',
  cancelled: 'completed',
  ambiguous: 'uncertain',
} as const satisfies Record<
  ExecutionEffectStatus,
  'planned' | 'uncertain' | 'applied' | 'completed'
>;

const HANDLE_RECOVERY_CLASS = {
  unknown: 'unresolved',
  pending: 'unresolved',
  running: 'unresolved',
  succeeded: 'terminal',
  failed: 'terminal',
  cancelled: 'terminal',
} as const satisfies Record<ExecutionExternalHandleStatus, 'unresolved' | 'terminal'>;

const APPROVAL_BLOCK_REASON = {
  not_required: null,
  granted: null,
  pending: 'approval_pending',
  denied: 'approval_denied',
  expired: 'approval_expired',
  unknown: 'approval_unknown',
} as const satisfies Record<ExecutionApprovalState, ExecutionRecoveryBlockReason | null>;

const PERMISSION_BLOCK_REASON = {
  not_required: null,
  granted: null,
  pending: 'permission_pending',
  denied: 'permission_denied',
  expired: 'permission_expired',
  unknown: 'permission_unknown',
} as const satisfies Record<ExecutionApprovalState, ExecutionRecoveryBlockReason | null>;

const KNOWN_RECOVERY_BOUNDARIES = {
  run_created: true,
  before_model: true,
  after_model: true,
  before_effect: true,
  after_effect: true,
  waiting_approval: true,
  waiting_external: true,
  safe_yield: true,
  terminal: true,
} as const satisfies Record<ExecutionCheckpointBoundary, true>;
const SETTLED_EFFECT_BOUNDARIES = new Set([
  'run_created',
  'before_model',
  'after_effect',
  'safe_yield',
  'terminal',
]);

function sortedIds(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function block(
  snapshot: ExecutionJournalSnapshot,
  reason: ExecutionRecoveryBlockReason,
  checkpoint: ExecutionCheckpointRecord | null,
  effectIds: Iterable<string> = [],
  handleIds: Iterable<string> = [],
): ExecutionRecoveryCommand {
  return {
    kind: 'block',
    runId: snapshot.run.id,
    controlEpoch: snapshot.run.controlEpoch,
    reason,
    checkpointId: checkpoint?.id ?? null,
    effectIds: sortedIds(effectIds),
    handleIds: sortedIds(handleIds),
  };
}

function pointer(
  run: ExecutionRunRecord,
  checkpoint: ExecutionCheckpointRecord,
): CheckpointRecoveryPointer {
  return {
    runId: run.id,
    checkpointId: checkpoint.id,
    controlEpoch: run.controlEpoch,
    stateRefId: checkpoint.stateRefId,
    stateDigest: checkpoint.stateDigest,
  };
}

function isSnapshotStructurallyValid(snapshot: ExecutionJournalSnapshot): boolean {
  const { run, checkpoints, effects, externalHandles, monitors } = snapshot;
  const checkpointIds = new Set<string>();
  const effectIds = new Set<string>();
  const handleIds = new Set<string>();
  const monitorHandleIds = new Set<string>();
  const checkpointById = new Map<string, ExecutionCheckpointRecord>();
  const effectById = new Map<string, ExecutionEffectRecord>();
  const orderedCheckpoints = [...checkpoints].sort((left, right) => left.sequence - right.sequence);
  let previousControlEpoch = -1;
  let previousCheckpointAt = -1;

  const initial = orderedCheckpoints[0];
  if (
    initial &&
    (initial.boundary !== 'run_created' ||
      initial.phase !== 'system' ||
      initial.controlEpoch !== 0 ||
      initial.createdAt !== run.createdAt ||
      initial.taskId !== run.taskId ||
      initial.goalId !== run.goalId)
  ) {
    return false;
  }

  for (const [index, checkpoint] of orderedCheckpoints.entries()) {
    if (
      checkpointIds.has(checkpoint.id) ||
      !KNOWN_RECOVERY_BOUNDARIES[checkpoint.boundary] ||
      checkpoint.runId !== run.id ||
      checkpoint.sequence !== index ||
      checkpoint.controlEpoch > run.controlEpoch ||
      checkpoint.controlEpoch < previousControlEpoch ||
      checkpoint.createdAt < previousCheckpointAt ||
      checkpoint.createdAt > run.updatedAt
    ) {
      return false;
    }
    checkpointIds.add(checkpoint.id);
    checkpointById.set(checkpoint.id, checkpoint);
    previousControlEpoch = checkpoint.controlEpoch;
    previousCheckpointAt = checkpoint.createdAt;
  }

  const latest = orderedCheckpoints.at(-1);
  if (
    latest &&
    (latest.resumeStrategy !== run.resumeStrategy ||
      latest.approvalState !== run.approvalState ||
      latest.permissionState !== run.permissionState)
  ) {
    return false;
  }

  for (const effect of effects) {
    const checkpoint = effect.checkpointId ? checkpointById.get(effect.checkpointId) : undefined;
    if (
      effectIds.has(effect.id) ||
      effect.runId !== run.id ||
      !checkpoint ||
      checkpoint.boundary !== 'before_effect' ||
      effect.createdAt < checkpoint.createdAt ||
      effect.updatedAt > run.updatedAt
    ) {
      return false;
    }
    effectIds.add(effect.id);
    effectById.set(effect.id, effect);
  }

  for (const handle of externalHandles) {
    const effect = effectById.get(handle.effectId);
    if (
      handleIds.has(handle.id) ||
      handle.runId !== run.id ||
      !effect ||
      effect.startedAt === null ||
      handle.sourceToolNameDigest !== effect.toolNameDigest ||
      handle.createdAt < effect.startedAt ||
      handle.updatedAt > run.updatedAt
    ) {
      return false;
    }
    handleIds.add(handle.id);
  }
  const handleById = new Map(externalHandles.map((handle) => [handle.id, handle]));
  for (const monitor of monitors) {
    const handle = handleById.get(monitor.externalHandleId);
    if (
      monitor.runId !== run.id ||
      !handle ||
      monitorHandleIds.has(monitor.externalHandleId) ||
      monitor.lastObservedStatus !== handle.status ||
      monitor.createdAt !== handle.createdAt ||
      monitor.updatedAt > run.updatedAt ||
      (HANDLE_RECOVERY_CLASS[handle.status] === 'unresolved' &&
        !['armed', 'blocked'].includes(monitor.state)) ||
      (HANDLE_RECOVERY_CLASS[handle.status] === 'terminal' && monitor.state !== 'acted')
    ) {
      return false;
    }
    monitorHandleIds.add(monitor.externalHandleId);
  }
  if (
    externalHandles.length !== monitors.length ||
    externalHandles.some((handle) => !monitorHandleIds.has(handle.id))
  ) {
    return false;
  }
  return true;
}

function authorityBlockReason(
  checkpoint: ExecutionCheckpointRecord,
): ExecutionRecoveryBlockReason | null {
  return (
    APPROVAL_BLOCK_REASON[checkpoint.approvalState] ??
    PERMISSION_BLOCK_REASON[checkpoint.permissionState]
  );
}

function terminalCommand(
  snapshot: ExecutionJournalSnapshot,
  latest: ExecutionCheckpointRecord,
): ExecutionRecoveryCommand {
  const unresolvedEffects = snapshot.effects.filter((effect) =>
    ['planned', 'uncertain', 'applied'].includes(EFFECT_RECOVERY_CLASS[effect.status]),
  );
  const unresolvedHandles = snapshot.externalHandles.filter(
    (handle) => HANDLE_RECOVERY_CLASS[handle.status] === 'unresolved',
  );
  if (unresolvedEffects.length > 0 || unresolvedHandles.length > 0) {
    return block(
      snapshot,
      'unresolved_terminal_run',
      latest,
      unresolvedEffects.map((effect) => effect.id),
      unresolvedHandles.map((handle) => handle.id),
    );
  }
  if (latest.controlEpoch !== snapshot.run.controlEpoch) {
    return block(snapshot, 'stale_control_epoch', latest);
  }
  if (latest.boundary !== 'terminal' || snapshot.run.terminalAt === null) {
    return block(snapshot, 'missing_terminal_projection', latest);
  }
  return {
    kind: 'finalize_existing_terminal_projection',
    ...pointer(snapshot.run, latest),
    terminalStatus: snapshot.run.status as Extract<
      ExecutionRunStatus,
      'succeeded' | 'failed' | 'cancelled'
    >,
    terminalAt: snapshot.run.terminalAt,
  };
}

function resumeToolBatch(
  snapshot: ExecutionJournalSnapshot,
  latest: ExecutionCheckpointRecord,
  plannedEffectIds: string[],
  replayEffectIds: string[],
): ExecutionRecoveryCommand {
  const authorityReason = authorityBlockReason(latest);
  if (authorityReason) {
    return block(snapshot, authorityReason, latest, [...plannedEffectIds, ...replayEffectIds]);
  }
  return {
    kind: 'resume_persisted_tool_batch',
    ...pointer(snapshot.run, latest),
    plannedEffectIds: sortedIds(plannedEffectIds),
    replayEffectIds: sortedIds(replayEffectIds),
    requiresExecutionAuthorityRevalidation: true,
  };
}

export function planExecutionRecovery(
  snapshot: ExecutionJournalSnapshot,
): ExecutionRecoveryCommand {
  if (!isSnapshotStructurallyValid(snapshot)) {
    return block(snapshot, 'snapshot_invalid', null);
  }
  const checkpoints = [...snapshot.checkpoints].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const latest = checkpoints.at(-1) ?? null;
  if (!latest) {
    return block(snapshot, 'no_checkpoint', null);
  }

  if (RUN_RECOVERY_CLASS[snapshot.run.status] === 'terminal') {
    return terminalCommand(snapshot, latest);
  }
  if (latest.boundary === 'terminal') {
    return block(snapshot, 'terminal_boundary_status_mismatch', latest);
  }

  const checkpointById = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const lastSettledEffectSequence = checkpoints.reduce(
    (sequence, checkpoint) =>
      SETTLED_EFFECT_BOUNDARIES.has(checkpoint.boundary)
        ? Math.max(sequence, checkpoint.sequence)
        : sequence,
    -1,
  );
  const isEffectActive = (effect: ExecutionEffectRecord): boolean =>
    checkpointById.get(effect.checkpointId!)!.sequence > lastSettledEffectSequence;
  const handlesByEffect = new Map<string, ExecutionExternalHandleRecord[]>();
  for (const handle of snapshot.externalHandles) {
    const handles = handlesByEffect.get(handle.effectId) ?? [];
    handles.push(handle);
    handlesByEffect.set(handle.effectId, handles);
  }

  const replayEffectIds: string[] = [];
  const reconcileEffectIds = new Set<string>();
  const reconcileHandleIds = new Set<string>();
  for (const effect of snapshot.effects) {
    const effectCheckpoint = checkpointById.get(effect.checkpointId!);
    const active = isEffectActive(effect);
    const recoveryClass = EFFECT_RECOVERY_CLASS[effect.status];
    if (recoveryClass === 'planned' && !active) {
      return block(snapshot, 'snapshot_invalid', latest, [effect.id]);
    }
    if (recoveryClass === 'applied' && !active && latest.boundary !== 'after_effect') {
      return block(snapshot, 'snapshot_invalid', latest, [effect.id]);
    }
    if (
      recoveryClass === 'planned' &&
      effectCheckpoint?.controlEpoch !== snapshot.run.controlEpoch
    ) {
      return block(snapshot, 'stale_control_epoch', latest, [effect.id]);
    }
    if (recoveryClass !== 'uncertain') continue;

    const handles = handlesByEffect.get(effect.id) ?? [];
    if (handles.length > 0) {
      reconcileEffectIds.add(effect.id);
      for (const handle of handles) reconcileHandleIds.add(handle.id);
      continue;
    }
    if (effectCheckpoint?.controlEpoch !== snapshot.run.controlEpoch) {
      return block(snapshot, 'stale_control_epoch', latest, [effect.id]);
    }
    if (!active) {
      return block(snapshot, 'snapshot_invalid', latest, [effect.id]);
    }
    const replaySafe =
      effect.effectClass === 'none' &&
      effect.idempotencyClass === 'effect_free' &&
      effect.retryPolicy === 'replay_safe' &&
      effectCheckpoint?.controlEpoch === snapshot.run.controlEpoch;
    if (replaySafe) {
      replayEffectIds.push(effect.id);
      continue;
    }
    return block(snapshot, 'unresolved_effect_without_reconciliation', latest, [effect.id]);
  }

  for (const handle of snapshot.externalHandles) {
    if (HANDLE_RECOVERY_CLASS[handle.status] === 'unresolved') {
      reconcileEffectIds.add(handle.effectId);
      reconcileHandleIds.add(handle.id);
    }
  }
  if (reconcileHandleIds.size > 0) {
    return {
      kind: 'reconcile_external_handles',
      runId: snapshot.run.id,
      controlEpoch: snapshot.run.controlEpoch,
      effectIds: sortedIds(reconcileEffectIds),
      handleIds: sortedIds(reconcileHandleIds),
    };
  }

  if (latest.controlEpoch !== snapshot.run.controlEpoch) {
    return block(snapshot, 'stale_control_epoch', latest);
  }

  const completedEffectIds = snapshot.effects
    .filter((effect) => {
      const recoveryClass = EFFECT_RECOVERY_CLASS[effect.status];
      return (
        isEffectActive(effect) && (recoveryClass === 'applied' || recoveryClass === 'completed')
      );
    })
    .map((effect) => effect.id);
  if (completedEffectIds.length > 0) {
    return {
      kind: 'continue_after_tool_result',
      ...pointer(snapshot.run, latest),
      completedEffectIds: sortedIds(completedEffectIds),
    };
  }

  if (RUN_RECOVERY_CLASS[snapshot.run.status] === 'ambiguous' && replayEffectIds.length === 0) {
    return block(snapshot, 'ambiguous_run_without_evidence', latest);
  }
  const statusAuthorityReason = authorityBlockReason(latest);
  if (RUN_RECOVERY_CLASS[snapshot.run.status] === 'blocked') {
    return block(snapshot, statusAuthorityReason ?? 'run_blocked', latest);
  }

  const plannedEffectIds = snapshot.effects
    .filter(
      (effect) => isEffectActive(effect) && EFFECT_RECOVERY_CLASS[effect.status] === 'planned',
    )
    .map((effect) => effect.id);
  if (plannedEffectIds.length > 0 || replayEffectIds.length > 0) {
    return resumeToolBatch(snapshot, latest, plannedEffectIds, replayEffectIds);
  }

  if (
    latest.phase === 'review' &&
    (latest.boundary === 'safe_yield' || latest.boundary === 'after_model')
  ) {
    return { kind: 'resume_review', ...pointer(snapshot.run, latest) };
  }

  switch (latest.boundary) {
    case 'run_created':
    case 'before_model':
    case 'safe_yield':
      return { kind: 'resume_model_step', ...pointer(snapshot.run, latest) };
    case 'after_model':
    case 'before_effect':
    case 'waiting_approval':
      return resumeToolBatch(snapshot, latest, [], []);
    case 'after_effect':
      return {
        kind: 'continue_after_tool_result',
        ...pointer(snapshot.run, latest),
        completedEffectIds: [],
      };
    case 'waiting_external':
      return block(snapshot, 'missing_external_handle', latest);
    default:
      return block(snapshot, 'unsupported_boundary', latest);
  }
}
