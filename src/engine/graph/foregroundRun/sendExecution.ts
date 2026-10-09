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
import { createTurnLatencyTimeline } from '../../turnLatencyTimeline';
import { isRegisteredSlashCommand } from '../runTracking';
import type { RunChatOptions } from './contracts';
import type { ForegroundConversationRunHelpers } from './executionTypes';
import type { ForegroundRequestRegistry } from './requestRegistry';
import { settleSteering } from './steeringSettlement';
import type { SteeringQueue } from './steeringQueue';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;

/** Where a message sent during a run waits, and the registry that says which run is active. */
export type ForegroundSteeringBinding = {
  queue: Pick<SteeringQueue, 'enqueue' | 'take' | 'retarget'>;
  registry: Pick<ForegroundRequestRegistry, 'getRequestId' | 'subscribe'>;
};

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
  steering: ForegroundSteeringBinding;
  /** Shown when a message sent during a run cannot join the ones already waiting. */
  steeringQueueFullMessage: string;
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
 * A text message sent while a run of the conversation is working steers that run: it
 * waits in the queue for the run's next step instead of superseding the run. If no run
 * takes it before the conversation's runs end, it comes back here to be sent as the next
 * turn. Attachments and commands keep starting a turn of their own.
 */
async function steerActiveRun(params: {
  attachments?: Attachment[];
  context: ForegroundConversationSendContext;
  conversationId: string;
  text: string;
}): Promise<{ kind: 'sent_to_run' } | { kind: 'send_turn'; text: string }> {
  const { context, conversationId } = params;
  const runId = context.steering.registry.getRequestId(conversationId);
  if (!runId || params.attachments?.length || isRegisteredSlashCommand(params.text)) {
    return { kind: 'send_turn', text: params.text };
  }
  const queued = context.steering.queue.enqueue({
    id: context.generateId(),
    conversationId,
    targetRunId: runId,
    text: params.text,
    enqueuedAt: Date.now(),
  });
  if (queued.status === 'rejected') {
    if (queued.reason === 'queue_full') context.setChatError(context.steeringQueueFullMessage);
    return { kind: 'sent_to_run' };
  }
  context.clearComposerDraft(getComposerDraftKey(conversationId));
  const untaken = await settleSteering({
    conversationId,
    runId,
    queue: context.steering.queue,
    registry: context.steering.registry,
  });
  if (untaken.length === 0) return { kind: 'sent_to_run' };
  return { kind: 'send_turn', text: untaken.map((message) => message.text).join('\n\n') };
}

/**
 * Submit a composer turn exactly as the chat screen does: resolve or create the
 * canonical conversation, steer a run that is already working, or import attachments
 * into the conversation workspace, gate on write availability, append the user message,
 * then run the turn.
 */
export async function executeForegroundConversationSend(
  input: ForegroundConversationSendInput,
): Promise<void> {
  const { attachments, context, runOptions } = input;
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
  const steering = await steerActiveRun({
    attachments,
    context,
    conversationId,
    text: input.text,
  });
  if (steering.kind === 'sent_to_run') return;
  const text = steering.text;
  // Timed from here: a message that waited for a run counts from when it became a turn.
  const latencyTimeline = createTurnLatencyTimeline();
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

    if (
      !(await context.waitForConversationWriteAvailability(conversationId, SUPERSEDING_TURN_REASON))
    ) {
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

    latencyTimeline.mark('user_message_added');

    context.clearComposerDraft(getComposerDraftKey(conversationId));
    const execution = context.runChat(conversationId, { ...runOptions, latencyTimeline });
    writeIntent.release();
    writeIntent = undefined;
    context.releaseConversationWrite(conversationId);
    await execution;
  } finally {
    writeIntent?.release();
    context.releaseConversationWrite(conversationId);
  }
}
