import {
  isSchedulerExecutionError,
  NonRetryableSchedulerExecutionError,
  SchedulerAppBackgroundAbortError,
  SchedulerExecutionError,
} from './executionError';
import { ScheduledAppBackgroundAbortReason } from './executionLifecycle';
import {
  flushScheduledConversationPersistence,
  ScheduledAttemptConversationCheckpointError,
} from './jobExecutorPersistence';

export async function throwNormalizedScheduledJobExecutionError(
  error: unknown,
  conversationId: string | undefined,
): Promise<never> {
  const warnings = await flushScheduledConversationPersistence('failure');
  if (isSchedulerExecutionError(error)) {
    error.addWarnings(warnings);
    if (warnings.length > 0) error.markConversationNotDurable();
    throw error;
  }
  if (error instanceof ScheduledAppBackgroundAbortReason) {
    throw new SchedulerAppBackgroundAbortError(
      error,
      conversationId,
      warnings,
      warnings.length === 0,
    );
  }
  if (error instanceof ScheduledAttemptConversationCheckpointError) {
    throw new SchedulerExecutionError(
      error,
      conversationId,
      warnings,
      error.conversationDurable && warnings.length === 0,
    );
  }
  if (!conversationId) throw error;
  const sourceError = error instanceof Error ? error : new Error(String(error));
  throw new NonRetryableSchedulerExecutionError(
    sourceError,
    conversationId,
    warnings,
    warnings.length === 0,
  );
}
