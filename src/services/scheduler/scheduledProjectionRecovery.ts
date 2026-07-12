import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { capMessages } from '../../store/chatStoreHelpers';
import { mutateOwnedModelProjection } from '../../store/modelProjectionOwnership';
import { useChatStore } from '../../store/useChatStore';
import type { ModelProjectionOwner } from '../../types/conversation';
import type { Message } from '../../types/message';
import { generateId } from '../../utils/id';
import {
  buildAssistantMessageMetadata,
  hasCompleteFinalAssistantMetadata,
  hasSettledFinalAssistantMetadata,
} from '../../utils/assistantMessageMetadata';
import { hasActiveScheduledJobExecutions } from './executionLifecycle';
import { releaseScheduledProjection, type ScheduledProjectionLease } from './jobExecutorProjection';
import { useSchedulerStore } from './store';

function lastExecutionArtifact(messages: readonly Message[]): Message | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'tool' || (message.role === 'assistant' && !message.subAgentEvent),
    );
}

function matchingRunningJob(owner: ModelProjectionOwner) {
  return useSchedulerStore
    .getState()
    .jobs.find(
      (job) =>
        job.runningAttemptId && (job.runningOccurrenceId ?? job.runningAttemptId) === owner.runId,
    );
}

function settleRecoveredProjection(lease: ScheduledProjectionLease): boolean {
  const job = matchingRunningJob(lease.owner);
  if (job?.runningEffectRisk === 'safe' && !job.runningCompletion) return false;
  const mutation = mutateOwnedModelProjection({
    ...lease,
    mutate: (conversation) => {
      const requestIndex = conversation.messages.findIndex(
        (message) => message.id === lease.owner.requestMessageId && message.role === 'user',
      );
      const occurrenceMessages =
        requestIndex < 0 ? [] : conversation.messages.slice(requestIndex + 1);
      const terminalArtifact = lastExecutionArtifact(occurrenceMessages);
      const completion = job?.runningCompletion;
      const transcriptAlreadySettled = completion
        ? Boolean(
            terminalArtifact &&
            hasCompleteFinalAssistantMetadata(terminalArtifact) &&
            terminalArtifact.content === completion.output,
          )
        : Boolean(terminalArtifact && hasSettledFinalAssistantMetadata(terminalArtifact));
      if (transcriptAlreadySettled) {
        return { kind: 'applied', conversation, value: false };
      }
      const recoveredAssistant: Message = completion
        ? {
            id: generateId(),
            role: 'assistant',
            content: completion.output,
            timestamp: completion.completedAtMs,
            assistantMetadata: buildAssistantMessageMetadata('final', {
              completionStatus: 'complete',
              finishReason: 'scheduler_completion_recovered',
            }),
          }
        : {
            id: generateId(),
            role: 'assistant',
            content:
              'Scheduled execution was interrupted after a hook or effect claim; replay was suppressed.',
            timestamp: Date.now(),
            isError: true,
            assistantMetadata: buildAssistantMessageMetadata('final', {
              completionStatus: 'incomplete',
              finishReason: 'app_restarted',
            }),
          };
      return {
        kind: 'applied',
        conversation: {
          ...conversation,
          messages: capMessages([...conversation.messages, recoveredAssistant]),
          updatedAt: Math.max(conversation.updatedAt, recoveredAssistant.timestamp),
        },
        value: true,
      };
    },
  });
  if (mutation.kind !== 'applied') {
    throw new Error(`scheduled_projection_recovery_${mutation.kind}`);
  }
  return mutation.value;
}

/** Called only from the persisted startup/foreground recovery barrier. */
export async function releaseStaleScheduledProjectionOwners(): Promise<number> {
  if (hasActiveScheduledJobExecutions()) {
    throw new Error('scheduled_projection_recovery_active_execution');
  }
  const leases = useChatStore
    .getState()
    .conversations.flatMap((conversation) =>
      conversation.modelProjectionOwner?.surface === 'scheduler'
        ? [{ conversationId: conversation.id, owner: conversation.modelProjectionOwner }]
        : [],
    );
  for (const lease of leases) {
    if (settleRecoveredProjection(lease)) await flushChatStorePersistenceNow();
    await releaseScheduledProjection(lease);
  }
  return leases.length;
}
