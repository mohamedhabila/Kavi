import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import {
  mutateOwnedModelProjection,
  ownsModelProjection,
  releaseModelProjection,
} from '../../store/modelProjectionOwnership';
import { terminalizeModelProjectionReservationConversation } from '../../store/modelProjectionTerminalization';
import { useChatStore } from '../../store/useChatStore';
import { inspectForegroundModelExecutionLifecycle } from './foregroundModelExecutionQueries';

/** Release persisted owners whose journal generation is already terminal or retained away. */
export async function releaseStaleForegroundExecutionProjectionOwners(): Promise<number> {
  const owned = useChatStore.getState().conversations.flatMap((conversation) =>
    conversation.modelProjectionOwner
      ? [
          {
            conversationId: conversation.id,
            owner: conversation.modelProjectionOwner,
          },
        ]
      : [],
  );
  let released = 0;
  for (const candidate of owned) {
    if (candidate.owner.surface !== 'foreground') continue;
    const lifecycle = inspectForegroundModelExecutionLifecycle(candidate.owner.runId);
    if (lifecycle === 'active') continue;
    if (lifecycle === 'missing' || lifecycle === 'not_foreground_model') {
      const mutation = mutateOwnedModelProjection({
        ...candidate,
        mutate: (conversation) =>
          terminalizeModelProjectionReservationConversation({
            conversation,
            owner: candidate.owner,
            detail: 'The app restarted after reserving the response but before generation began.',
            finishReason: 'app_restarted_before_start',
            timestamp: Date.now(),
          }),
      });
      if (mutation.kind !== 'applied') {
        throw new Error(`foreground_execution_projection_cleanup_${mutation.kind}`);
      }
      await flushChatStorePersistenceNow();
      if (!ownsModelProjection(candidate.conversationId, candidate.owner)) {
        throw new Error('foreground_execution_projection_ownership_changed');
      }
    }
    if (releaseModelProjection(candidate) === 'released') {
      await flushChatStorePersistenceNow();
      released += 1;
    }
  }
  return released;
}
