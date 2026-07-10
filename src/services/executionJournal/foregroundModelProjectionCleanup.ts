import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import {
  releaseForegroundModelProjection,
} from '../../store/foregroundModelProjectionOwnership';
import { useChatStore } from '../../store/useChatStore';
import { inspectForegroundModelExecutionLifecycle } from './foregroundModelExecutionQueries';

/** Release persisted owners whose journal generation is already terminal or retained away. */
export async function releaseStaleForegroundModelProjectionOwners(): Promise<number> {
  const owned = useChatStore
    .getState()
    .conversations.flatMap((conversation) =>
      conversation.foregroundModelProjectionOwner
        ? [
            {
              conversationId: conversation.id,
              owner: conversation.foregroundModelProjectionOwner,
            },
          ]
        : [],
    );
  let released = 0;
  for (const candidate of owned) {
    const lifecycle = inspectForegroundModelExecutionLifecycle(candidate.owner.runId);
    if (lifecycle === 'active') continue;
    if (lifecycle === 'not_foreground_model') {
      throw new Error('foreground_model_projection_owner_run_type_mismatch');
    }
    if (releaseForegroundModelProjection(candidate) === 'released') {
      released += 1;
    }
  }
  if (released > 0) await flushChatStorePersistenceNow();
  return released;
}
