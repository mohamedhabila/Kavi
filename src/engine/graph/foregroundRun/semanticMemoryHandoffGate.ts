import type { Conversation, ModelProjectionOwner } from '../../../types/conversation';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { scheduleMemoryIngestionDrainFromAppState } from '../../../services/memory/lifecycle';
import { semanticMemoryHandoffsEqual } from '../../../services/memory/semanticMemoryHandoff';
import { waitForSemanticMemoryHandoff } from '../../../services/memory/semanticMemoryHandoffConsistency';
import { createLogger } from '../../../utils/logger';
import { i18n } from '../../../i18n/manager';

const logger = createLogger('memory.semanticMemoryHandoffGate');

/**
 * How long a foreground turn waits for the previous conversation's consolidation before
 * proceeding with the memory that is already current. The consistency helper's own
 * default (35 s) is sized for background work; a person waiting on the first message of
 * a new chat must never see that stall. Recall picks up a late consolidation next turn.
 */
export const FOREGROUND_SEMANTIC_MEMORY_HANDOFF_BUDGET_MS = 750;

/** User-visible chat error for the rare paths that still stop the turn; localized at call time. */
function semanticMemoryHandoffErrorText(): string {
  return i18n.t('chat.memoryHandoffNotReady');
}

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
      budgetMs: FOREGROUND_SEMANTIC_MEMORY_HANDOFF_BUDGET_MS,
    });
  } catch (error) {
    logger.warn('semantic_memory_handoff_terminalized reason=wait_threw', {
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    await params.closeReservationFailure('Semantic memory handoff synchronization failed.');
    params.clearForegroundRequestIfCurrent();
    params.setChatError(semanticMemoryHandoffErrorText());
    return 'stopped';
  }

  if (consistency.outcome === 'cancelled' || !params.isCurrentRunInvocation()) {
    logger.warn('semantic_memory_handoff_terminalized reason=superseded', {
      conversationId: params.conversationId,
      outcome: consistency.outcome,
    });
    await params.closeReservationFailure(
      'The request was superseded while synchronizing prior conversation memory.',
    );
    params.clearForegroundRequestIfCurrent();
    return 'stopped';
  }

  // Every remaining outcome is safe to proceed on rather than refuse. 'ready' and
  // 'opt_out' mean the prior conversation's consolidation is verified consistent (or
  // long-term memory is intentionally off). 'unavailable' (for any reason) and
  // 'timed_out' mean the *other* conversation's background consolidation job cannot
  // be confirmed complete within a user-tolerable wait -- but this gate never itself
  // performs a memory read; the orchestrator's own recall step re-checks the live
  // memory policy at read time. So the worst case here is recall that is one turn
  // stale, which self-heals as soon as the source job finishes. Refusing (or waiting
  // indefinitely for) a brand-new conversation's very first turn because some other
  // conversation's background job hasn't finished holds no safety property this app
  // needs, and is strictly worse for the user than proceeding.
  const degraded = consistency.outcome !== 'ready' && consistency.outcome !== 'opt_out';
  if (degraded) {
    logger.warn('semantic_memory_handoff_degraded_proceed', {
      conversationId: params.conversationId,
      outcome: consistency.outcome,
      unavailableReason: consistency.unavailableReason,
      finalJobStatus: consistency.finalJobStatus,
    });
  }

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
    logger.warn('semantic_memory_handoff_terminalized reason=handoff_changed', {
      conversationId: params.conversationId,
      mutationResult: consumed.kind,
    });
    await params.closeReservationFailure(
      `Semantic memory handoff changed during ${consumed.kind}.`,
    );
    params.clearForegroundRequestIfCurrent();
    params.setChatError(semanticMemoryHandoffErrorText());
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
    logger.warn('semantic_memory_handoff_terminalized reason=flush_failed', {
      conversationId: params.conversationId,
    });
    await params.closeReservationFailure('Memory handoff persistence failed.');
    params.clearForegroundRequestIfCurrent();
    params.setChatError(semanticMemoryHandoffErrorText());
    return 'stopped';
  }
  if (!params.durability.ownsModelProjection(params.conversationId, params.owner)) {
    logger.warn('semantic_memory_handoff_terminalized reason=ownership_changed', {
      conversationId: params.conversationId,
    });
    params.clearForegroundRequestIfCurrent();
    params.setChatError('Foreground response ownership changed.');
    return 'stopped';
  }

  return 'proceed';
}
