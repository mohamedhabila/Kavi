import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import { isPlaceholderTitle } from '../../utils/conversation';
import { createLogger } from '../../utils/logger';
import type { NotificationRouteData } from './service';

const logger = createLogger('RunCompletionNotifications');

/** What a person who left the app needs to know about a run that ended without them. */
export type RunCompletionNotice = 'answer_ready' | 'needs_input' | 'unfinished';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ForegroundRequestSource = {
  getActiveConversationIds: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
};

const NOTICE_TITLE_KEYS: Record<RunCompletionNotice, string> = {
  answer_ready: 'notifications.runAnswerReady',
  needs_input: 'notifications.runNeedsInput',
  unfinished: 'notifications.runUnfinished',
};

function latestFinalAssistant(messages: ReadonlyArray<Message>): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return undefined;
    if (message?.role === 'assistant' && message.assistantMetadata?.kind === 'final') {
      return message;
    }
  }
  return undefined;
}

/**
 * A run that handed its work to background operations (workers, async tools) stays
 * running after its request ends; it is delivered by the resumed request that follows.
 */
function isStillWorking(
  conversation: Pick<Conversation, 'activeAgentRunId' | 'agentRuns'>,
): boolean {
  const run = conversation.agentRuns?.find(
    (candidate) => candidate.id === conversation.activeAgentRunId,
  );
  return run?.status === 'running' && run.controlGraph?.status !== 'awaiting_user';
}

/**
 * Read how the conversation's latest turn ended from its final assistant message, or
 * null when there is nothing to deliver yet: the run continues in the background, or
 * it ended without a final message (a cancelled run).
 */
export function resolveRunCompletionNotice(
  conversation: Pick<Conversation, 'messages' | 'activeAgentRunId' | 'agentRuns'>,
): RunCompletionNotice | null {
  if (isStillWorking(conversation)) return null;
  const final = latestFinalAssistant(conversation.messages);
  if (!final?.assistantMetadata) return null;
  if (final.assistantMetadata.completionStatus !== 'complete') return 'unfinished';
  return final.assistantMetadata.finishReason === 'request_clarification'
    ? 'needs_input'
    : 'answer_ready';
}

/**
 * Tell the person when a conversation's run ends while the app is in the background —
 * an answer they waited for, or a question back to them — so a long task is delivered
 * even after they stopped watching. Only already-granted notification permission is
 * used; nothing is asked while the app is out of sight. Tapping the notice opens the
 * conversation.
 */
export function startRunCompletionNotifications(deps: {
  requests: ForegroundRequestSource;
  isAppInForeground: () => boolean;
  getConversation: (conversationId: string) => Conversation | undefined;
  canNotify: () => Promise<boolean>;
  notify: (notice: {
    identifier: string;
    title: string;
    body: string;
    data: NotificationRouteData;
  }) => Promise<unknown>;
  t: TranslationFn;
}): () => void {
  let active = new Set(deps.requests.getActiveConversationIds());

  const announce = async (conversationId: string): Promise<void> => {
    const conversation = deps.getConversation(conversationId);
    const notice = conversation ? resolveRunCompletionNotice(conversation) : null;
    if (!conversation || !notice || !(await deps.canNotify())) return;
    await deps.notify({
      // One notice per conversation: a newer run's notice replaces an unread older one.
      identifier: `chat-run-completed:${conversationId}`,
      title: deps.t(NOTICE_TITLE_KEYS[notice]),
      body:
        conversation.title.trim() && !isPlaceholderTitle(conversation.title)
          ? conversation.title.trim()
          : deps.t('notifications.runOpenConversation'),
      data: { screen: 'Chat', conversationId, source: 'chat_run_completed' },
    });
  };

  return deps.requests.subscribe(() => {
    const next = new Set(deps.requests.getActiveConversationIds());
    const ended = [...active].filter((conversationId) => !next.has(conversationId));
    active = next;
    if (ended.length === 0 || deps.isAppInForeground()) return;
    for (const conversationId of ended) {
      announce(conversationId).catch((error: unknown) => {
        logger.warn('Could not announce a finished run.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
}
