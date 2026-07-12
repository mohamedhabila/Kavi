import type { ModelProjectionOwner } from '../../../types/conversation';
import { terminalizeModelProjectionReservationConversation } from '../../../store/modelProjectionTerminalization';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';

type ProjectionDurability = ExecuteForegroundConversationRunParams['context']['durability'];

export function buildForegroundProjectionReservation(params: {
  runId: string;
  requestMessageId: string;
  assistantMessageId: string;
}): ModelProjectionOwner {
  return {
    surface: 'foreground',
    runId: params.runId,
    requestMessageId: params.requestMessageId,
    assistantMessageId: params.assistantMessageId,
    controlEpoch: 0,
  };
}

export async function claimForegroundProjectionReservation(params: {
  durability: ProjectionDurability;
  conversationId: string;
  owner: ModelProjectionOwner;
  insertAssistantPlaceholder: boolean;
}): Promise<void> {
  const claim = params.durability.claimModelProjection({
    conversationId: params.conversationId,
    owner: params.owner,
    ...(params.insertAssistantPlaceholder
      ? {
          assistantMessage: {
            id: params.owner.assistantMessageId,
            role: 'assistant' as const,
            content: '',
            timestamp: Date.now(),
          },
        }
      : {}),
  });
  if (claim !== 'claimed') throw new Error(`model_projection_${claim}`);
  await params.durability.flushChatState();
  if (!params.durability.ownsModelProjection(params.conversationId, params.owner)) {
    throw new Error('model_projection_ownership_changed');
  }
}

/** Persist a terminal placeholder while ownership is retained, then release it durably. */
export async function terminalizeAndReleaseForegroundProjectionReservation(params: {
  durability: ProjectionDurability;
  conversationId: string;
  owner: ModelProjectionOwner;
  detail: string;
}): Promise<void> {
  const timestamp = Date.now();
  const mutation = params.durability.mutateModelProjection<string>({
    conversationId: params.conversationId,
    owner: params.owner,
    mutate: (conversation) =>
      terminalizeModelProjectionReservationConversation({
        conversation,
        owner: params.owner,
        detail: params.detail,
        finishReason: 'interrupted_before_start',
        timestamp,
      }),
  });
  if (mutation.kind !== 'applied') {
    throw new Error(`model_projection_terminalize_${mutation.kind}`);
  }
  await params.durability.flushChatState();
  if (!params.durability.ownsModelProjection(params.conversationId, params.owner)) {
    throw new Error('model_projection_ownership_changed');
  }
  const release = params.durability.releaseModelProjection({
    conversationId: params.conversationId,
    owner: params.owner,
  });
  if (release !== 'released') throw new Error(`model_projection_${release}`);
  await params.durability.flushChatState();
}
