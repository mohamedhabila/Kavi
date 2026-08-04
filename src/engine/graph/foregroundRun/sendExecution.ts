// ---------------------------------------------------------------------------
// Kavi — Foreground conversation send execution
// ---------------------------------------------------------------------------
// The chat composer entry point, extracted from `useForegroundConversationActions`
// so the exact code path the chat screen runs is callable without React. The hook
// is a thin wrapper over this function, and acceptance harnesses call it directly
// instead of re-implementing turn submission. This mirrors how
// `executeForegroundConversationRun` was extracted from
// `useForegroundConversationRunner`.
// ---------------------------------------------------------------------------

import { SUPER_AGENT_PERSONA_ID } from '../../../services/agents/personas';
import { importConversationWorkspaceAttachment } from '../../../services/conversationWorkspace/attachments';
import { getComposerDraftKey } from '../../../screens/chatComposerDrafts';
import { beginModelProjectionIntent } from '../../../store/modelProjectionIntentCoordinator';
import { useChatStore } from '../../../store/useChatStore';
import type { Attachment } from '../../../types/attachment';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import type { RunChatOptions } from './contracts';
import type { ForegroundConversationRunHelpers } from './executionTypes';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;

/** Everything the composer send path needs, supplied by the hook or a harness. */
export type ForegroundConversationSendContext = {
  addMessage: ChatStoreState['addMessage'];
  attachmentWorkspaceImportFailedMessage: string;
  clearComposerDraft: (draftKey: string) => void;
  defaultConversationMode: Conversation['mode'];
  ensureCanonicalConversation: ForegroundConversationRunHelpers['ensureCanonicalConversation'];
  generateId: () => string;
  getLiveActiveConversationId: () => string | null;
  isAgenticMode: boolean;
  /** Chat screen scroll affordance; harnesses supply a no-op. */
  markNextScrollForced: () => void;
  releaseConversationWrite: (conversationId: string) => void;
  reserveConversationWrite: (conversationId: string) => boolean;
  runChat: (conversationId: string, options?: RunChatOptions) => Promise<void>;
  setChatError: (message: string | null) => void;
  waitForConversationWriteAvailability: (
    conversationId: string,
    reason: string,
  ) => Promise<boolean>;
};

export type ForegroundConversationSendInput = {
  attachments?: Attachment[];
  context: ForegroundConversationSendContext;
  runOptions?: RunChatOptions;
  text: string;
};

const SUPERSEDING_TURN_REASON = 'Superseded by a new user turn.';

/**
 * Submit a composer turn exactly as the chat screen does: resolve or create the
 * canonical conversation, import attachments into the conversation workspace,
 * gate on write availability, append the user message, then run the turn.
 */
export async function executeForegroundConversationSend(
  input: ForegroundConversationSendInput,
): Promise<void> {
  const { attachments, context, runOptions, text } = input;
  context.setChatError(null);

  const resolvedConversationId =
    context.getLiveActiveConversationId() ??
    context.ensureCanonicalConversation({
      personaId: context.isAgenticMode ? SUPER_AGENT_PERSONA_ID : undefined,
      mode: context.defaultConversationMode,
      reportMissingProvider: true,
    });
  if (!resolvedConversationId) return;

  const conversationId = resolvedConversationId;
  if (!context.reserveConversationWrite(conversationId)) return;

  let writeIntent: ReturnType<typeof beginModelProjectionIntent> | undefined;
  try {
    let preparedAttachments = attachments;
    if (attachments?.length) {
      try {
        preparedAttachments = await Promise.all(
          attachments.map(
            async (attachment) =>
              (await importConversationWorkspaceAttachment(conversationId, attachment)).attachment,
          ),
        );
      } catch (error) {
        console.warn('Failed to import chat attachments into the conversation workspace.', error);
        context.setChatError(context.attachmentWorkspaceImportFailedMessage);
        return;
      }
    }

    if (!(await context.waitForConversationWriteAvailability(conversationId, SUPERSEDING_TURN_REASON))) {
      return;
    }

    writeIntent = beginModelProjectionIntent(conversationId, 'conversation-write');
    context.markNextScrollForced();
    context.addMessage(conversationId, {
      id: context.generateId(),
      role: 'user',
      content: text,
      attachments: preparedAttachments,
    } as Partial<Message> & Pick<Message, 'content' | 'id' | 'role'>);

    context.clearComposerDraft(getComposerDraftKey(conversationId));
    const execution = runOptions
      ? context.runChat(conversationId, runOptions)
      : context.runChat(conversationId);
    writeIntent.release();
    writeIntent = undefined;
    context.releaseConversationWrite(conversationId);
    await execution;
  } finally {
    writeIntent?.release();
    context.releaseConversationWrite(conversationId);
  }
}
