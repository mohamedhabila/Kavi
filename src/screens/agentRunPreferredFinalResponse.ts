import { useChatStore } from '../store/useChatStore';
import { AgentRun } from '../types/agentRun';
import {
  buildAssistantMessageMetadata,
  isAssistantFinalResponsePlaceholder,
} from '../utils/assistantMessageMetadata';
import {
  type FinalResponseDeliveryEffects,
  recordAgentRunFinalResponseDelivery,
} from './agentRunFinalResponseDelivery';
import { truncateLogDetail } from './chatFormatting';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export function tryDeliverPreferredFinalResponse(params: {
  assertNotAborted: () => void;
  conversation: ChatStore['conversations'][number];
  conversationId: string;
  preferredAssistantMessageId?: string;
  run: AgentRun;
  runId: string;
  status: Exclude<AgentRun['status'], 'running'>;
  effects: Pick<
    FinalResponseDeliveryEffects,
    | 'appendAgentRunCheckpoint'
    | 'appendConversationLog'
    | 'updateAgentRunSummary'
    | 'updateMessageAssistantMetadata'
  >;
}): string | undefined {
  const preferredAssistantMessageId = params.preferredAssistantMessageId?.trim();
  if (!preferredAssistantMessageId) {
    return undefined;
  }

  const preferredAssistantMessage = params.conversation.messages.find(
    (message) => message.id === preferredAssistantMessageId,
  );
  const preferredContent =
    preferredAssistantMessage?.role === 'assistant' &&
    !preferredAssistantMessage.subAgentEvent &&
    (preferredAssistantMessage.toolCalls?.length ?? 0) === 0 &&
    !isAssistantFinalResponsePlaceholder(preferredAssistantMessage)
      ? preferredAssistantMessage.content.trim()
      : '';

  if (!preferredContent) {
    return undefined;
  }

  params.assertNotAborted();
  params.effects.updateMessageAssistantMetadata(
    params.conversationId,
    preferredAssistantMessageId,
    buildAssistantMessageMetadata('final', {
      completionStatus: 'complete',
      finishReason: 'graph_finalized',
      ...(params.run.terminalReason ? { terminalReason: params.run.terminalReason } : {}),
    }),
  );

  const preview = truncateLogDetail(preferredContent) || preferredContent;
  recordAgentRunFinalResponseDelivery({
    conversationId: params.conversationId,
    run: params.run,
    runId: params.runId,
    status: params.status,
    preview,
    effects: {
      appendAgentRunCheckpoint: params.effects.appendAgentRunCheckpoint,
      appendConversationLog: params.effects.appendConversationLog,
      updateAgentRunSummary: params.effects.updateAgentRunSummary,
    },
  });

  return preview;
}
