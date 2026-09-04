import type { Conversation, ModelProjectionOwner } from '../types/conversation';
import { i18n } from '../i18n/manager';
import {
  buildAssistantMessageMetadata,
  hasSettledFinalAssistantMetadata,
} from '../utils/assistantMessageMetadata';

function interruptedBeforeStartText(): string {
  return i18n.t('chat.responseInterruptedBeforeStart');
}
function appRestartedBeforeStartText(): string {
  return i18n.t('chat.responseInterruptedByAppRestartBeforeStart');
}
function cancelledBeforeStartText(): string {
  return i18n.t('chat.responseStoppedBeforeGenerated');
}

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
        ? cancelledBeforeStartText()
        : params.finishReason === 'app_restarted_before_start'
          ? appRestartedBeforeStartText()
          : interruptedBeforeStartText()),
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
            ? i18n.t('chat.responseStoppedBeforeGenerationTitle')
            : params.finishReason === 'app_restarted_before_start'
              ? i18n.t('chat.responseInterruptedByAppRestartTitle')
              : i18n.t('chat.responseInterruptedBeforeGenerationTitle'),
          detail: params.detail,
        },
      ].slice(-250),
    },
    value: 'terminalized',
  };
}
