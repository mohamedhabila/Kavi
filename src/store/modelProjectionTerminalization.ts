import type { Conversation, ModelProjectionOwner } from '../types/conversation';
import {
  buildAssistantMessageMetadata,
  hasSettledFinalAssistantMetadata,
} from '../utils/assistantMessageMetadata';

const INTERRUPTED_BEFORE_START_TEXT =
  'Response interrupted before generation could start. Please retry when you are ready.';
const APP_RESTARTED_BEFORE_START_TEXT =
  'Response interrupted when the app restarted before generation could start. Please retry when you are ready.';
const CANCELLED_BEFORE_START_TEXT = 'Stopped before a response was generated.';

export type ProjectionReservationFinishReason =
  | 'app_restarted_before_start'
  | 'cancelled_before_start'
  | 'interrupted_before_start';

export function terminalizeModelProjectionReservationConversation(params: {
  conversation: Conversation;
  owner: ModelProjectionOwner;
  detail: string;
  finishReason: ProjectionReservationFinishReason;
  timestamp: number;
}):
  | { kind: 'applied'; conversation: Conversation; value: 'already_terminal' | 'terminalized' }
  | { kind: 'rejected'; value: 'projection_anchor_invalid' } {
  const requestIndex = params.conversation.messages.findIndex(
    (message) => message.id === params.owner.requestMessageId && message.role === 'user',
  );
  const assistantIndex = params.conversation.messages.findIndex(
    (message) => message.id === params.owner.assistantMessageId && message.role === 'assistant',
  );
  if (requestIndex < 0 || assistantIndex <= requestIndex) {
    return { kind: 'rejected', value: 'projection_anchor_invalid' };
  }
  const assistant = params.conversation.messages[assistantIndex];
  if (hasSettledFinalAssistantMetadata(assistant)) {
    return {
      kind: 'applied',
      conversation: params.conversation,
      value: 'already_terminal',
    };
  }
  const messages = [...params.conversation.messages];
  const wasCancelled = params.finishReason === 'cancelled_before_start';
  messages[assistantIndex] = {
    ...assistant,
    content:
      assistant.content.trim() ||
      (wasCancelled
        ? CANCELLED_BEFORE_START_TEXT
        : params.finishReason === 'app_restarted_before_start'
          ? APP_RESTARTED_BEFORE_START_TEXT
          : INTERRUPTED_BEFORE_START_TEXT),
    isError: !wasCancelled,
    assistantMetadata: buildAssistantMessageMetadata('final', {
      completionStatus: 'incomplete',
      finishReason: params.finishReason,
    }),
  };
  return {
    kind: 'applied',
    conversation: {
      ...params.conversation,
      messages,
      updatedAt: Math.max(params.conversation.updatedAt, params.timestamp),
      logs: [
        ...(params.conversation.logs ?? []).filter(
          (entry) => entry.id !== `projection-interrupted-${params.owner.runId}`,
        ),
        {
          id: `projection-interrupted-${params.owner.runId}`,
          timestamp: params.timestamp,
          level: wasCancelled ? ('info' as const) : ('warning' as const),
          kind: wasCancelled ? ('state' as const) : ('error' as const),
          title: wasCancelled
            ? 'Response stopped before generation'
            : params.finishReason === 'app_restarted_before_start'
              ? 'Response interrupted by app restart'
              : 'Response interrupted before generation',
          detail: params.detail,
        },
      ].slice(-250),
    },
    value: 'terminalized',
  };
}
