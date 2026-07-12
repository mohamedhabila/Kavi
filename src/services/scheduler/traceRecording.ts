import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';
import type { SchedulerTrigger } from '../cron/types';
import { flushExecutionTraceStorePersistenceNow } from './tracePersistence';
import { useExecutionTraceStore, type ExecutionTrace } from './traceStore';
import { buildHeadTailExcerpt } from '../../utils/headTailExcerpt';
import {
  MAX_SCHEDULER_REPORT_WARNING_CHARS,
  MAX_SCHEDULER_REPORT_WARNINGS,
  sanitizeSchedulerReportText,
} from './terminalReport';

const MAX_PERSISTENCE_RECOVERY_DELAY_MS = 60_000;

let persistenceRecoveryTimer: ReturnType<typeof setTimeout> | undefined;

export type ExecutionTraceInput = {
  id?: string;
  jobId: string;
  jobName: string;
  status: ExecutionTrace['status'];
  startedAt: number;
  completedAt: number;
  output?: string;
  error?: string;
  warnings?: string[];
  attempt?: number;
  trigger: SchedulerTrigger;
};

function scheduleTracePersistenceRecovery(retryCount = 0): void {
  if (persistenceRecoveryTimer) return;
  const delayMs = Math.min(1_000 * 2 ** retryCount, MAX_PERSISTENCE_RECOVERY_DELAY_MS);
  persistenceRecoveryTimer = setTimeout(() => {
    persistenceRecoveryTimer = undefined;
    useExecutionTraceStore.setState((state) => ({ traces: [...state.traces] }));
    void flushExecutionTraceStorePersistenceNow().catch((error) => {
      console.warn('[scheduler] Execution traces are still waiting for persistence:', error);
      scheduleTracePersistenceRecovery(retryCount + 1);
    });
  }, delayMs);
  unrefTimerIfSupported(persistenceRecoveryTimer);
}

export async function recordExecutionTrace(params: ExecutionTraceInput): Promise<void> {
  useExecutionTraceStore.getState().addTrace({
    id: params.id ?? `trace-${generateId()}`,
    jobId: params.jobId,
    jobName: params.jobName,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    durationMs: Math.max(0, params.completedAt - params.startedAt),
    status: params.status,
    output: params.output ? sanitizeSchedulerReportText(params.output) : undefined,
    error: params.error ? sanitizeSchedulerReportText(params.error) : undefined,
    warnings: params.warnings
      ?.slice(0, MAX_SCHEDULER_REPORT_WARNINGS)
      .map((warning) => buildHeadTailExcerpt(warning, MAX_SCHEDULER_REPORT_WARNING_CHARS)),
    attempt: params.attempt,
    trigger: params.trigger,
  });
  try {
    await flushExecutionTraceStorePersistenceNow();
  } catch (error) {
    scheduleTracePersistenceRecovery();
    throw error;
  }
}

export function resetTraceRecordingForTests(): void {
  if (persistenceRecoveryTimer) clearTimeout(persistenceRecoveryTimer);
  persistenceRecoveryTimer = undefined;
}
