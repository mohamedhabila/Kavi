import type { ModelProjectionOwner } from '../../types/conversation';
import type { CronJob } from '../cron/types';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { ownsModelProjection, releaseModelProjection } from '../../store/modelProjectionOwnership';
import { tryClaimScheduledModelProjection } from '../../store/modelProjectionIntentCoordinator';
import { useChatStore } from '../../store/useChatStore';
import { unrefTimerIfSupported } from '../../utils/timers';
import { modelProjectionOwnersEqual } from '../../utils/modelProjectionOwner';
import {
  NonRetryableSchedulerExecutionError,
  SchedulerExecutionError,
  SchedulerProjectionBusyError,
  SchedulerProjectionReleaseError,
} from './executionError';
import { scheduledOccurrenceMessageIds } from './jobExecutorSetup';
import { useSchedulerStore } from './store';
import type { VerifiedProcedureMemoryLineage } from '../memory/verifiedProcedure/provenanceHash';
import type { PendingScheduledVerifiedProcedureCommit } from './executionResult';
import type { PendingVerifiedProcedureObservation } from '../memory/verifiedProcedure/executionSession';

export interface ScheduledProjectionLease {
  conversationId: string;
  owner: ModelProjectionOwner;
}

function scheduledProcedureLineage(
  job: CronJob,
  lease: ScheduledProjectionLease,
  sourceTurnId: string,
): VerifiedProcedureMemoryLineage {
  return {
    sourceMessageId: lease.owner.requestMessageId,
    sourceRunId: job.runningAttemptId ?? null,
    sourceTurnId,
    taskId: job.runningAttemptId ?? null,
  };
}

export function pendingScheduledProcedureCommit(
  observation: PendingVerifiedProcedureObservation,
  job: CronJob,
  lease: ScheduledProjectionLease,
  sourceTurnId: string,
): PendingScheduledVerifiedProcedureCommit {
  return {
    observation,
    memoryLineage: scheduledProcedureLineage(job, lease, sourceTurnId),
  };
}

const releaseRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduledProjectionOwner(job: CronJob): ModelProjectionOwner {
  const { occurrenceId, userMessageId, assistantMessageId } = scheduledOccurrenceMessageIds(job);
  return {
    surface: 'scheduler',
    runId: occurrenceId,
    requestMessageId: userMessageId,
    assistantMessageId,
    controlEpoch: 0,
  };
}

export function claimScheduledProjection(params: {
  job: CronJob;
  conversationId: string;
  prompt: string;
}): ScheduledProjectionLease {
  const owner = scheduledProjectionOwner(params.job);
  const timestamp = Date.now();
  const result = tryClaimScheduledModelProjection({
    conversationId: params.conversationId,
    owner,
    messagesBeforeAssistant: [
      {
        id: owner.requestMessageId,
        role: 'user',
        content: params.prompt,
        timestamp,
      },
    ],
    assistantMessage: {
      id: owner.assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp,
    },
  });
  if (result === 'claimed') return { conversationId: params.conversationId, owner };
  if (
    result === 'model_projection_intent' ||
    result === 'owner_conflict' ||
    result === 'unsettled_conversation_tail'
  ) {
    throw new SchedulerProjectionBusyError(result, params.conversationId);
  }
  throw new NonRetryableSchedulerExecutionError(
    new Error(`Scheduled projection claim failed (${result}).`),
    params.conversationId,
  );
}

export async function checkpointScheduledProjectionClaim(conversationId: string): Promise<void> {
  try {
    await flushChatStorePersistenceNow();
  } catch (error) {
    throw new SchedulerExecutionError(
      error instanceof Error ? error : new Error(String(error)),
      conversationId,
      [],
      false,
    );
  }
}

function releaseRecoveryKey(lease: ScheduledProjectionLease): string {
  return `${lease.conversationId}:${lease.owner.runId}`;
}

function scheduleReleaseRecovery(lease: ScheduledProjectionLease, retryCount = 0): void {
  const key = releaseRecoveryKey(lease);
  if (releaseRecoveryTimers.has(key)) return;
  const timer = setTimeout(
    () => {
      releaseRecoveryTimers.delete(key);
      void flushChatStorePersistenceNow().catch(() =>
        scheduleReleaseRecovery(lease, retryCount + 1),
      );
    },
    Math.min(1_000 * 2 ** retryCount, 60_000),
  );
  unrefTimerIfSupported(timer);
  releaseRecoveryTimers.set(key, timer);
}

export async function releaseScheduledProjection(lease: ScheduledProjectionLease): Promise<void> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === lease.conversationId);
  if (conversation?.modelProjectionOwner) {
    if (!ownsModelProjection(lease.conversationId, lease.owner)) {
      throw new Error('scheduled_model_projection_owner_changed');
    }
    const result = releaseModelProjection(lease);
    if (result !== 'released') throw new Error(`scheduled_model_projection_release_${result}`);
  }
  try {
    await flushChatStorePersistenceNow();
  } catch (error) {
    scheduleReleaseRecovery(lease);
    throw error;
  }
}

export function resetScheduledProjectionReleaseRecoveryForTests(): void {
  for (const timer of releaseRecoveryTimers.values()) clearTimeout(timer);
  releaseRecoveryTimers.clear();
}

export async function releaseScheduledProjectionForJob(job: CronJob): Promise<void> {
  if (!job.runningAttemptId) return;
  const owner = scheduledProjectionOwner(job);
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) =>
      modelProjectionOwnersEqual(candidate.modelProjectionOwner, owner),
    );
  if (!conversation) {
    await flushChatStorePersistenceNow();
    return;
  }
  await releaseScheduledProjection({ conversationId: conversation.id, owner });
}

export async function releaseScheduledProjectionAfterExecution(
  job: CronJob,
  lease: ScheduledProjectionLease | undefined,
): Promise<void> {
  if (!lease) return;
  try {
    await releaseScheduledProjection(lease);
  } catch (error) {
    const sourceError = error instanceof Error ? error : new Error(String(error));
    const completionPreserved = Boolean(
      useSchedulerStore.getState().getJob(job.id)?.runningCompletion,
    );
    throw new SchedulerProjectionReleaseError(
      sourceError,
      lease.conversationId,
      completionPreserved,
    );
  }
}
