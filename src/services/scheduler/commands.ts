import type {
  CronDelivery,
  CronFailureAlert,
  CronJob,
  CronPayload,
  CronSchedule,
  SessionTarget,
  WakeMode,
} from '../cron/types';
import { computeNextRunAtMs } from '../cron/schedule';
import type { ConversationMode } from '../../types/conversation';
import { withSchedulerOperationLock } from './operationLock';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { ensureSchedulerMaintenanceReady } from './runtimeReadiness';
import { useSchedulerStore } from './store';
import { cancelSchedulerJobWake, syncSchedulerWakeNotifications } from './wakeNotifications';
import { scheduleSchedulerStatePersistenceRecovery } from './statePersistenceRecovery';

export type CreateScheduledJobInput = {
  name: string;
  schedule: CronSchedule;
  prompt: string;
  mode?: ConversationMode;
  model?: string;
  providerId?: string;
  sessionTarget?: SessionTarget;
  wakeMode?: WakeMode;
  deliveryMode?: 'conversation' | 'notification' | 'both';
  failureAlert?: CronFailureAlert;
};

export type UpdateScheduledJobInput = Partial<{
  name: string;
  schedule: CronSchedule;
  payload: CronPayload;
  enabled: boolean;
  delivery: CronDelivery;
  failureAlert: CronFailureAlert;
}>;

export type SchedulerUpdateResult =
  | { status: 'updated'; warning?: string }
  | { status: 'not_found' };

export type CreateScheduledJobResult = { id: string; warning?: string };

function combineWakeWarnings(warnings: string[]): string | undefined {
  return warnings.length > 0 ? warnings.join(' ') : undefined;
}

export class SchedulerCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'SchedulerCommandError';
    this.code = code;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

function persistenceError(action: string, error: unknown): SchedulerCommandError {
  const detail = error instanceof Error ? error.message : String(error);
  return new SchedulerCommandError(
    'scheduler_persistence_failed',
    `Could not durably ${action} the scheduled job: ${detail}`,
    error,
  );
}

function validateSchedule(schedule: CronSchedule): void {
  try {
    if (computeNextRunAtMs(schedule, Date.now()) === undefined) {
      throw new Error('the schedule has no future run');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SchedulerCommandError(
      'invalid_scheduler_schedule',
      `Invalid scheduled job schedule: ${detail}`,
      error,
    );
  }
}

async function enforceFailClosedState(id: string, action: string): Promise<boolean> {
  const store = useSchedulerStore.getState();
  if (store.getJob(id)?.enabled !== false) store.disableJob(id);
  store.requestPersistence();
  let durable = true;
  try {
    await flushSchedulerStorePersistenceNow();
  } catch {
    durable = false;
    scheduleSchedulerStatePersistenceRecovery(`Fail-closed ${action} state`);
  }
  const disabledJob = store.getJob(id);
  if (disabledJob) {
    await cancelSchedulerJobWake(disabledJob).catch((wakeError) =>
      console.warn(`[scheduler] Failed to cancel wake after ${action} failure:`, wakeError),
    );
  }
  return durable;
}

async function syncWakeAfterCommand(successDescription: string): Promise<string | undefined> {
  try {
    const wakeResult = await syncSchedulerWakeNotifications({ force: true });
    return combineWakeWarnings(wakeResult.warnings);
  } catch (error) {
    return `${successDescription}, but wake notification maintenance failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

export async function createScheduledJob(
  input: CreateScheduledJobInput,
): Promise<CreateScheduledJobResult> {
  validateSchedule(input.schedule);
  await ensureSchedulerMaintenanceReady();
  const id = await withSchedulerOperationLock(async () => {
    const store = useSchedulerStore.getState();
    const createdId = store.addJob(input);
    try {
      await flushSchedulerStorePersistenceNow();
      return createdId;
    } catch (error) {
      store.removeJob(createdId);
      await flushSchedulerStorePersistenceNow().catch(() =>
        scheduleSchedulerStatePersistenceRecovery('Create rollback state'),
      );
      throw persistenceError('create', error);
    }
  });
  const warning = await syncWakeAfterCommand('The job was created');
  return { id, ...(warning ? { warning } : {}) };
}

export async function updateScheduledJob(
  id: string,
  updates: UpdateScheduledJobInput,
): Promise<SchedulerUpdateResult> {
  if (updates.schedule) validateSchedule(updates.schedule);
  await ensureSchedulerMaintenanceReady();
  const updated = await withSchedulerOperationLock(async () => {
    const store = useSchedulerStore.getState();
    if (!store.getJob(id)) return false;
    store.updateJob(id, updates);
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (error) {
      await enforceFailClosedState(id, 'update');
      throw persistenceError('update', error);
    }
    return true;
  });
  if (!updated) return { status: 'not_found' };
  const warning = await syncWakeAfterCommand('The job was updated');
  return { status: 'updated', ...(warning ? { warning } : {}) };
}

export async function setScheduledJobEnabled(
  id: string,
  enabled: boolean,
): Promise<SchedulerUpdateResult> {
  await ensureSchedulerMaintenanceReady();
  const updated = await withSchedulerOperationLock(async () => {
    const store = useSchedulerStore.getState();
    if (!store.getJob(id)) return false;
    if (enabled) store.enableJob(id);
    else store.disableJob(id);
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (error) {
      const action = enabled ? 'enable' : 'disable';
      const failClosedStateIsDurable = await enforceFailClosedState(id, action);
      if (!enabled && failClosedStateIsDurable) {
        return {
          found: true,
          warning: `The initial disable write failed but the disabled state was durably confirmed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      throw persistenceError(action, error);
    }
    return { found: true };
  });
  if (!updated) return { status: 'not_found' };
  const wakeWarning = await syncWakeAfterCommand(`The job was ${enabled ? 'enabled' : 'disabled'}`);
  const warning = [updated.warning, wakeWarning].filter(Boolean).join(' ') || undefined;
  return { status: 'updated', ...(warning ? { warning } : {}) };
}

export async function getScheduledJob(id: string): Promise<CronJob | undefined> {
  await ensureSchedulerMaintenanceReady();
  return useSchedulerStore.getState().getJob(id);
}

export async function listScheduledJobs(): Promise<CronJob[]> {
  await ensureSchedulerMaintenanceReady();
  return [...useSchedulerStore.getState().jobs];
}

export async function deleteScheduledJob(id: string): Promise<'deleted' | 'not_found' | 'busy'> {
  await ensureSchedulerMaintenanceReady();
  return withSchedulerOperationLock(async () => {
    const store = useSchedulerStore.getState();
    const job = store.getJob(id);
    if (!job) return 'not_found';
    if (job.runningAttemptId) return 'busy';

    store.disableJob(id);
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (error) {
      if (!(await enforceFailClosedState(id, 'disable before deleting'))) {
        throw persistenceError('disable before deleting', error);
      }
    }

    const disabledJob = store.getJob(id);
    if (!disabledJob) return 'not_found';
    try {
      await cancelSchedulerJobWake(disabledJob);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SchedulerCommandError(
        'scheduler_wake_cancel_failed',
        `The job was disabled but could not be deleted until its wake notification is cancelled: ${detail}`,
        error,
      );
    }

    const rollbackJob = store.getJob(id);
    if (!rollbackJob) return 'not_found';
    const rollbackReports = store.terminalReports.filter((report) => report.jobId === id);
    if (!store.removeJob(id)) return store.getJob(id)?.runningAttemptId ? 'busy' : 'not_found';
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (error) {
      useSchedulerStore.setState((state) => ({
        jobs: state.jobs.some((candidate) => candidate.id === id)
          ? state.jobs
          : [...state.jobs, rollbackJob],
        terminalReports: [
          ...state.terminalReports.filter((report) => report.jobId !== id),
          ...rollbackReports,
        ],
      }));
      await flushSchedulerStorePersistenceNow().catch(() =>
        scheduleSchedulerStatePersistenceRecovery('Delete rollback state'),
      );
      throw persistenceError('delete', error);
    }
    return 'deleted';
  });
}
