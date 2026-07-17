import type { Conversation, ModelProjectionOwner } from '../../../types/conversation';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { scheduleMemoryIngestionDrainFromAppState } from '../../../services/memory/lifecycle';
import { semanticMemoryHandoffsEqual } from '../../../services/memory/semanticMemoryHandoff';
import { waitForSemanticMemoryHandoff } from '../../../services/memory/semanticMemoryHandoffConsistency';

const SEMANTIC_MEMORY_HANDOFF_ERROR =
  'Memory from the previous conversation is not ready yet. Please retry, or restate the detail you need.';

type SemanticMemoryHandoffGateResult = 'proceed' | 'stopped';

export async function enforceSemanticMemoryHandoffGate(params: {
  signal: AbortSignal;
  conversation: Conversation | undefined;
  conversationId: string;
  durability: ExecuteForegroundConversationRunParams['context']['durability'];
  owner: ModelProjectionOwner;
  closeReservationFailure: (detail: string) => Promise<void>;
  clearForegroundRequestIfCurrent: () => boolean;
  isCurrentRunInvocation: () => boolean;
  setChatError: (message: string | null) => void;
}): Promise<SemanticMemoryHandoffGateResult> {
  const handoff = params.conversation?.semanticMemoryHandoff;
  if (!handoff) return 'proceed';

  let consistency: Awaited<ReturnType<typeof waitForSemanticMemoryHandoff>>;
  try {
    scheduleMemoryIngestionDrainFromAppState();
    consistency = await waitForSemanticMemoryHandoff({
      handoff,
      signal: params.signal,
    });
  } catch {
    await params.closeReservationFailure('Semantic memory handoff synchronization failed.');
    params.clearForegroundRequestIfCurrent();
    params.setChatError(SEMANTIC_MEMORY_HANDOFF_ERROR);
    return 'stopped';
  }

  if (consistency.outcome === 'cancelled' || !params.isCurrentRunInvocation()) {
    await params.closeReservationFailure(
      'The request was superseded while synchronizing prior conversation memory.',
    );
    params.clearForegroundRequestIfCurrent();
    return 'stopped';
  }

  const consumableUnavailable =
    consistency.outcome === 'unavailable' &&
    (consistency.unavailableReason === 'terminal_job' ||
      consistency.unavailableReason === 'missing_job');
  if (
    consistency.outcome === 'ready' ||
    consistency.outcome === 'opt_out' ||
    consumableUnavailable
  ) {
    const consumed = params.durability.mutateModelProjection<boolean>({
      conversationId: params.conversationId,
      owner: params.owner,
      mutate: (conversation) => {
        if (!semanticMemoryHandoffsEqual(conversation.semanticMemoryHandoff, handoff)) {
          return { kind: 'rejected', value: false };
        }
        const { semanticMemoryHandoff: _semanticMemoryHandoff, ...conversationWithoutHandoff } =
          conversation;
        return {
          kind: 'applied',
          conversation: conversationWithoutHandoff,
          value: true,
        };
      },
    });
    if (consumed.kind !== 'applied') {
      await params.closeReservationFailure(
        `Semantic memory handoff changed during ${consumed.kind}.`,
      );
      params.clearForegroundRequestIfCurrent();
      params.setChatError(SEMANTIC_MEMORY_HANDOFF_ERROR);
      return 'stopped';
    }
    try {
      await params.durability.flushChatState();
    } catch {
      const restored = params.durability.mutateModelProjection<void>({
        conversationId: params.conversationId,
        owner: params.owner,
        mutate: (conversation) => {
          if (conversation.semanticMemoryHandoff) {
            return { kind: 'rejected', value: undefined };
          }
          return {
            kind: 'applied',
            conversation: { ...conversation, semanticMemoryHandoff: handoff },
            value: undefined,
          };
        },
      });
      if (restored.kind !== 'applied') {
        throw new Error(`semantic_memory_handoff_restore_${restored.kind}`);
      }
      await params.closeReservationFailure('Memory handoff persistence failed.');
      params.clearForegroundRequestIfCurrent();
      params.setChatError(SEMANTIC_MEMORY_HANDOFF_ERROR);
      return 'stopped';
    }
    if (!params.durability.ownsModelProjection(params.conversationId, params.owner)) {
      params.clearForegroundRequestIfCurrent();
      params.setChatError('Foreground response ownership changed.');
      return 'stopped';
    }

    // A terminal or missing enrichment job cannot become ready on a repeated
    // foreground turn. Once the stale handoff is durably consumed, continue
    // through the normal retrieval path in this same turn instead of making
    // the user resubmit an unrelated request for an identical outcome.
    if (consumableUnavailable) {
      return 'proceed';
    }
  }

  if (consistency.outcome !== 'ready' && consistency.outcome !== 'opt_out') {
    await params.closeReservationFailure(
      `Semantic memory handoff ended with ${consistency.outcome}.`,
    );
    params.clearForegroundRequestIfCurrent();
    params.setChatError(SEMANTIC_MEMORY_HANDOFF_ERROR);
    return 'stopped';
  }

  return 'proceed';
}
