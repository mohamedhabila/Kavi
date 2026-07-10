import type * as SQLite from 'expo-sqlite';
import { decodeExecutionMonitorRow } from './decoders';
import { insertMonitor, monitorRow } from './mutationStore';
import type {
  ExecutionExternalHandleRecord,
  ExecutionExternalHandleStatus,
  ExecutionMonitorRecord,
} from './types';

const TERMINAL_EXTERNAL_STATUSES = new Set<ExecutionExternalHandleStatus>([
  'succeeded',
  'failed',
  'cancelled',
]);
const MAX_MONITOR_SCHEDULE_EVIDENCE = 100;

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export interface ExecutionMonitorScheduleEvidence {
  monitorCount: number;
  observationCount: number;
  nextLegalCheckAt: number;
}

export type ExecutionExternalHandleMonitorReadiness =
  | { kind: 'ready' }
  | { kind: 'not_due' }
  | { kind: 'unavailable' };

export function buildExternalHandleMonitor(params: {
  id: string;
  handle: ExecutionExternalHandleRecord;
}): ExecutionMonitorRecord {
  const terminal = TERMINAL_EXTERNAL_STATUSES.has(params.handle.status);
  return decodeExecutionMonitorRow(
    monitorRow({
      id: params.id,
      runId: params.handle.runId,
      externalHandleId: params.handle.id,
      baselineStatus: params.handle.status,
      condition: 'external_handle_terminal',
      action: 'reconcile_external_handle',
      state: terminal ? 'acted' : 'armed',
      nextLegalCheckAt: terminal ? null : params.handle.createdAt,
      lastObservedStatus: params.handle.status,
      observationCount: 1,
      lastObservedAt: params.handle.createdAt,
      conditionMetAt: terminal ? params.handle.createdAt : null,
      actedAt: terminal ? params.handle.createdAt : null,
      createdAt: params.handle.createdAt,
      updatedAt: params.handle.createdAt,
    }),
  );
}

export function insertExternalHandleMonitor(
  database: SQLite.SQLiteDatabase,
  params: { id: string; handle: ExecutionExternalHandleRecord },
): ExecutionMonitorRecord {
  const monitor = buildExternalHandleMonitor(params);
  insertMonitor(database, monitor);
  return monitor;
}

export function readExternalHandleMonitor(
  database: SQLite.SQLiteDatabase,
  runId: string,
  externalHandleId: string,
): ExecutionMonitorRecord {
  const row = database.getFirstSync<unknown>(
    `SELECT * FROM execution_monitors
     WHERE run_id = ? AND external_handle_id = ?`,
    runId,
    externalHandleId,
  );
  if (!row) throw new Error('execution_journal_monitor_not_found');
  return decodeExecutionMonitorRow(row);
}

export function assessExternalHandleMonitorReadiness(
  database: SQLite.SQLiteDatabase,
  runId: string,
  handles: readonly ExecutionExternalHandleRecord[],
  now: number,
): ExecutionExternalHandleMonitorReadiness {
  let monitors: ExecutionMonitorRecord[];
  try {
    monitors = handles.map((handle) => readExternalHandleMonitor(database, runId, handle.id));
  } catch {
    return { kind: 'unavailable' };
  }
  if (
    monitors.some(
      (monitor, index) =>
        monitor.state !== 'armed' || monitor.lastObservedStatus !== handles[index]?.status,
    )
  ) {
    return { kind: 'unavailable' };
  }
  return monitors.some((monitor) => monitor.nextLegalCheckAt! > now)
    ? { kind: 'not_due' }
    : { kind: 'ready' };
}

/** Returns a fixed-size schedule projection and refuses unbounded or mixed monitor sets. */
export function readExecutionMonitorSchedule(
  database: SQLite.SQLiteDatabase,
  runId: string,
  externalHandleIds: ReadonlyArray<string>,
): ExecutionMonitorScheduleEvidence {
  const ids = [...new Set(externalHandleIds)].sort();
  if (
    !validId(runId) ||
    !externalHandleIds.every(validId) ||
    ids.length === 0 ||
    ids.length !== externalHandleIds.length ||
    ids.length > MAX_MONITOR_SCHEDULE_EVIDENCE
  ) {
    throw new Error('execution_journal_monitor_schedule_invalid');
  }
  const placeholders = ids.map(() => '?').join(', ');
  const monitors = database
    .getAllSync<unknown>(
      `SELECT * FROM execution_monitors
       WHERE run_id = ? AND external_handle_id IN (${placeholders})
       ORDER BY external_handle_id ASC`,
      runId,
      ...ids,
    )
    .map(decodeExecutionMonitorRow);
  if (
    monitors.length !== ids.length ||
    monitors.some(
      (monitor, index) =>
        monitor.externalHandleId !== ids[index] ||
        monitor.state !== 'armed' ||
        monitor.nextLegalCheckAt === null,
    )
  ) {
    throw new Error('execution_journal_monitor_schedule_unavailable');
  }
  let observationCount = 0;
  let nextLegalCheckAt = 0;
  for (const monitor of monitors) {
    observationCount += monitor.observationCount;
    nextLegalCheckAt = Math.max(nextLegalCheckAt, monitor.nextLegalCheckAt!);
    if (!Number.isSafeInteger(observationCount)) {
      throw new Error('execution_journal_monitor_schedule_invalid');
    }
  }
  return { monitorCount: monitors.length, observationCount, nextLegalCheckAt };
}

export function advanceExternalHandleMonitor(
  database: SQLite.SQLiteDatabase,
  input: {
    runId: string;
    externalHandleId: string;
    observedStatus: ExecutionExternalHandleStatus | null;
    outcome: 'pending' | 'acted' | 'blocked';
    nextLegalCheckAt: number | null;
    occurredAt: number;
  },
): ExecutionMonitorRecord {
  const current = readExternalHandleMonitor(database, input.runId, input.externalHandleId);
  if (current.state !== 'armed') {
    throw new Error('execution_journal_monitor_not_armed');
  }
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < current.updatedAt) {
    throw new Error('execution_journal_monitor_non_monotonic_time');
  }
  const observedStatus = input.observedStatus ?? current.lastObservedStatus;
  const observedAt = input.observedStatus === null ? current.lastObservedAt : input.occurredAt;
  const observationCount =
    input.observedStatus === null ? current.observationCount : current.observationCount + 1;
  if (!Number.isSafeInteger(observationCount)) {
    throw new Error('execution_journal_monitor_observation_count_exhausted');
  }
  const terminal = TERMINAL_EXTERNAL_STATUSES.has(observedStatus);
  if (
    (input.outcome === 'acted' && (!terminal || input.nextLegalCheckAt !== null)) ||
    (input.outcome === 'pending' &&
      (terminal ||
        input.nextLegalCheckAt === null ||
        !Number.isSafeInteger(input.nextLegalCheckAt) ||
        input.nextLegalCheckAt < input.occurredAt)) ||
    (input.outcome === 'blocked' && input.nextLegalCheckAt !== null)
  ) {
    throw new Error('execution_journal_monitor_transition_invalid');
  }
  const next = decodeExecutionMonitorRow(
    monitorRow({
      ...current,
      state: input.outcome === 'pending' ? 'armed' : input.outcome,
      nextLegalCheckAt: input.nextLegalCheckAt,
      lastObservedStatus: observedStatus,
      observationCount,
      lastObservedAt: observedAt,
      conditionMetAt: input.outcome === 'acted' ? input.occurredAt : null,
      actedAt: input.outcome === 'acted' ? input.occurredAt : null,
      updatedAt: input.occurredAt,
    }),
  );
  const result = database.runSync(
    `UPDATE execution_monitors
     SET state = ?, next_legal_check_at = ?, last_observed_status = ?,
         observation_count = ?, last_observed_at = ?, condition_met_at = ?,
         acted_at = ?, updated_at = ?
     WHERE run_id = ? AND id = ? AND state = 'armed' AND updated_at = ?
       AND observation_count = ?`,
    next.state,
    next.nextLegalCheckAt,
    next.lastObservedStatus,
    next.observationCount,
    next.lastObservedAt,
    next.conditionMetAt,
    next.actedAt,
    next.updatedAt,
    current.runId,
    current.id,
    current.updatedAt,
    current.observationCount,
  );
  if (result.changes !== 1) {
    throw new Error('execution_journal_concurrent_monitor_mutation');
  }
  return readExternalHandleMonitor(database, current.runId, current.externalHandleId);
}

export function recordExternalHandleMonitorObservation(
  database: SQLite.SQLiteDatabase,
  input: {
    handle: ExecutionExternalHandleRecord;
    observedStatus: ExecutionExternalHandleStatus | null;
    disposition: 'completed' | 'pending' | 'blocked';
    retryAt: number | null;
    occurredAt: number;
  },
): ExecutionMonitorRecord {
  const terminalObservation =
    input.observedStatus !== null && TERMINAL_EXTERNAL_STATUSES.has(input.observedStatus);
  const outcome = terminalObservation
    ? 'acted'
    : input.disposition === 'blocked'
      ? 'blocked'
      : 'pending';
  return advanceExternalHandleMonitor(database, {
    runId: input.handle.runId,
    externalHandleId: input.handle.id,
    observedStatus: input.observedStatus,
    outcome,
    nextLegalCheckAt: outcome === 'pending' ? input.retryAt : null,
    occurredAt: input.occurredAt,
  });
}
