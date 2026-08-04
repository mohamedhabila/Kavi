// ---------------------------------------------------------------------------
// Kavi — Foreground scenario composer send context
// ---------------------------------------------------------------------------
// Mirrors `useForegroundConversationActions` so acceptance scenarios submit turns
// through the same composer entry point the chat screen uses. Everything here has
// a chat-screen counterpart; the only deliberate omissions are the composer draft
// and scroll affordances, which have no acceptance-run equivalent.
// ---------------------------------------------------------------------------

import { executeForegroundConversationRun } from '../../engine/graph/foregroundRun/execution';
import type { ExecuteForegroundConversationRunParams } from '../../engine/graph/foregroundRun/executionTypes';
import type { ForegroundConversationSendContext } from '../../engine/graph/foregroundRun/sendExecution';
import { waitForPersistedAgentRecoveryReadiness } from '../../services/startupRecovery';
import { waitForModelProjectionAvailability } from '../../store/modelProjectionOwnership';
import { useChatStore } from '../../store/useChatStore';
import type { Conversation } from '../../types/conversation';
import { generateId } from '../../utils/id';

/** Surfaced when conversation-workspace attachment import fails during a scenario turn. */
export const E2E_ATTACHMENT_IMPORT_FAILED_MESSAGE =
  'Failed to import chat attachments into the conversation workspace.';

export type ForegroundScenarioSendContextFactory = (
  activeConversationId: string,
  overrides?: Partial<ForegroundConversationSendContext>,
) => ForegroundConversationSendContext;

export type CreateForegroundScenarioSendContextParams = {
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => void;
  context: ExecuteForegroundConversationRunParams['context'];
  defaultMode: Conversation['mode'];
  setChatError: (message: string | null) => void;
};

/**
 * Builds the factory the scenario driver uses to enter `executeForegroundConversationSend`.
 * Write reservations are shared across turns so a superseded turn is gated exactly as
 * the chat screen gates one.
 */
export function createForegroundScenarioSendContextFactory(
  params: CreateForegroundScenarioSendContextParams,
): ForegroundScenarioSendContextFactory {
  const pendingConversationWrites = new Set<string>();

  return (activeConversationId, overrides = {}) => ({
    addMessage: useChatStore.getState().addMessage,
    attachmentWorkspaceImportFailedMessage: E2E_ATTACHMENT_IMPORT_FAILED_MESSAGE,
    // No composer surface in acceptance runs; the chat screen clears its draft here.
    clearComposerDraft: () => {},
    defaultConversationMode: params.defaultMode,
    ensureCanonicalConversation: params.context.helpers.ensureCanonicalConversation,
    generateId,
    getLiveActiveConversationId: () => activeConversationId,
    isAgenticMode: params.defaultMode === 'agentic',
    // Scroll affordance is chat-screen only.
    markNextScrollForced: () => {},
    releaseConversationWrite: (conversationId) => {
      pendingConversationWrites.delete(conversationId);
    },
    reserveConversationWrite: (conversationId) => {
      if (pendingConversationWrites.has(conversationId)) return false;
      pendingConversationWrites.add(conversationId);
      return true;
    },
    runChat: (conversationId, options) =>
      executeForegroundConversationRun({ conversationId, context: params.context, options }),
    setChatError: params.setChatError,
    waitForConversationWriteAvailability: async (conversationId, reason) => {
      params.abortForegroundRequestForConversation(conversationId, reason);
      try {
        await waitForPersistedAgentRecoveryReadiness();
        await waitForModelProjectionAvailability({
          conversationId,
          signal: new AbortController().signal,
        });
        return true;
      } catch (error) {
        params.setChatError(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    ...overrides,
  });
}
