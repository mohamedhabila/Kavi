import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import type { CronJob } from '../cron/types';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';
import { getRegisteredEventKeys } from '../events/bus';
import type { SchedulerExecutionResult } from './executionResult';
import { SchedulerCompletionCheckpointError } from './executionError';

export class ScheduledAttemptConversationCheckpointError extends Error {
  constructor(
    message: string,
    readonly conversationDurable: boolean,
  ) {
    super(message);
    this.name = 'ScheduledAttemptConversationCheckpointError';
  }
}

/**
 * Persist the transcript first, then its scheduler retry pointer. Effectful
 * dispatch cannot begin until both durability fences have completed.
 */
export async function checkpointScheduledAttemptConversation(
  job: CronJob,
  conversationId: string,
): Promise<void> {
  const attemptId = job.runningAttemptId;
  if (!attemptId || !job.runningEffectRisk) {
    throw new ScheduledAttemptConversationCheckpointError(
      'Scheduled execution is missing its durable attempt claim.',
      false,
    );
  }
  try {
    await flushChatStorePersistenceNow();
  } catch {
    throw new ScheduledAttemptConversationCheckpointError(
      'Scheduled conversation could not be persisted before execution.',
      false,
    );
  }
  if (
    !useSchedulerStore.getState().recordRunningAttemptConversation({
      id: job.id,
      attemptId,
      conversationId,
    })
  ) {
    throw new ScheduledAttemptConversationCheckpointError(
      'Scheduled attempt ownership was lost before execution.',
      true,
    );
  }
  try {
    await flushSchedulerStorePersistenceNow();
  } catch {
    throw new ScheduledAttemptConversationCheckpointError(
      'Scheduled retry identity could not be persisted before execution.',
      true,
    );
  }
}

export async function markScheduledAttemptEffectUnsafe(job: CronJob): Promise<void> {
  const attemptId = job.runningAttemptId;
  const store = useSchedulerStore.getState();
  const previousRisk = store.getJob(job.id)?.runningEffectRisk;
  if (!attemptId || !previousRisk || !store.markRunningAttemptEffectUnsafe(job.id, attemptId)) {
    throw new Error('Scheduled attempt ownership was lost before effect dispatch.');
  }
  try {
    await flushSchedulerStorePersistenceNow();
  } catch (error) {
    store.restoreRunningAttemptEffectRisk(job.id, attemptId, previousRisk);
    try {
      await flushSchedulerStorePersistenceNow();
    } catch {
      // Recovery remains fail-closed: no effect was dispatched and the caller
      // will reconcile the still-owned attempt before any replay.
    }
    throw error;
  }
}

export async function checkpointScheduledAttemptHooks(job: CronJob): Promise<void> {
  const hookEvents = ['agent', 'command', 'scheduler', 'session'];
  const hasUnjournaledHook = getRegisteredEventKeys().some((eventKey) =>
    hookEvents.some((eventType) => eventKey === eventType || eventKey.startsWith(`${eventType}:`)),
  );
  if (hasUnjournaledHook) await markScheduledAttemptEffectUnsafe(job);
}

export async function checkpointScheduledAttemptCompletion(
  job: CronJob,
  result: SchedulerExecutionResult,
): Promise<void> {
  const attemptId = job.runningAttemptId;
  if (
    !attemptId ||
    !useSchedulerStore.getState().recordRunningAttemptCompletion({
      id: job.id,
      attemptId,
      completion: {
        completedAtMs: Date.now(),
        output: result.output,
        conversationId: result.conversationId,
        conversationDurable: result.conversationDurable,
        warnings: result.warnings,
      },
    })
  ) {
    throw new SchedulerCompletionCheckpointError(
      new Error('Scheduled attempt ownership was lost before completion checkpoint.'),
      result.conversationId,
      result.conversationDurable !== false,
    );
  }
  try {
    await flushSchedulerStorePersistenceNow();
  } catch (error) {
    throw new SchedulerCompletionCheckpointError(
      error instanceof Error ? error : new Error(String(error)),
      result.conversationId,
      result.conversationDurable !== false,
    );
  }
}

export async function checkpointScheduledExecutionResult(params: {
  job: CronJob;
  output: string;
  conversationId: string;
  warnings?: string[];
  pendingVerifiedProcedureCommit?: SchedulerExecutionResult['pendingVerifiedProcedureCommit'];
}): Promise<SchedulerExecutionResult> {
  const warnings = params.warnings ?? [];
  const result: SchedulerExecutionResult = {
    output: params.output,
    conversationId: params.conversationId,
    ...(warnings.length > 0 ? { warnings, conversationDurable: false } : {}),
  };
  await checkpointScheduledAttemptCompletion(params.job, result);
  return params.pendingVerifiedProcedureCommit
    ? {
        ...result,
        pendingVerifiedProcedureCommit: params.pendingVerifiedProcedureCommit,
      }
    : result;
}

export async function flushScheduledConversationPersistence(
  outcome: 'failure' | 'result',
): Promise<string[]> {
  try {
    await flushChatStorePersistenceNow();
    return [];
  } catch (error) {
    const warning = `Conversation persistence failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.warn(`[scheduler] Scheduled ${outcome} persistence failed:`, error);
    return [warning];
  }
}
