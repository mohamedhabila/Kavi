import { useChatStore } from '../store/useChatStore';
import { AgentRun } from '../types/agentRun';
import { buildAssistantMessageMetadata } from '../utils/assistantMessageMetadata';
import { generateId } from '../utils/id';
import { getAgentControlGraphFinalReportTitle } from '../engine/graph/finalDelivery';
import { findAgentRunReplaceableAssistantMessageId } from '../engine/graph/foregroundRun/assistantMessages';
import { truncateLogDetail } from './chatFormatting';
import { SynthesizedAgentRunCompletion } from './agentRunCompletionSynthesis';
import { buildAgentRunMessageScope } from '../services/agents/lifecycle/agentRunStateMachine';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export type FinalResponseDeliveryEffects = {
  appendAgentRunCheckpoint: ChatStore['appendAgentRunCheckpoint'];
  appendConversationLog: (
    conversationId: string,
    entry: Parameters<ChatStore['addConversationLog']>[1],
  ) => void;
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessage: ChatStore['updateMessage'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
  updateMessageProviderReplay: ChatStore['updateMessageProviderReplay'];
};

export function recordAgentRunFinalResponseDelivery(params: {
  conversationId: string;
  run: AgentRun;
  runId: string;
  status: Exclude<AgentRun['status'], 'running'>;
  preview: string;
  timestamp?: number;
  effects: Pick<
    FinalResponseDeliveryEffects,
    'appendAgentRunCheckpoint' | 'appendConversationLog' | 'updateAgentRunSummary'
  >;
}): void {
  const deliveredTimestamp = params.timestamp ?? Date.now();
  const finalReportTitle = getAgentControlGraphFinalReportTitle(
    params.status,
    params.run.terminalReason,
  );
  params.effects.appendAgentRunCheckpoint(
    params.conversationId,
    {
      kind: 'run',
      title: finalReportTitle,
      detail: params.preview,
      timestamp: deliveredTimestamp,
    },
    params.runId,
  );
  params.effects.updateAgentRunSummary(
    params.conversationId,
    {
      latestSummary: params.preview,
      timestamp: deliveredTimestamp,
    },
    params.runId,
  );
  params.effects.appendConversationLog(params.conversationId, {
    kind: 'state',
    level:
      params.status === 'completed'
        ? 'success'
        : params.status === 'cancelled'
          ? 'warning'
          : 'error',
    title: finalReportTitle,
    detail: params.preview,
    timestamp: deliveredTimestamp,
  });
}

export function writeSynthesizedFinalResponse(params: {
  conversation: ChatStore['conversations'][number];
  conversationId: string;
  run: AgentRun;
  status: Exclude<AgentRun['status'], 'running'>;
  synthesized: SynthesizedAgentRunCompletion;
  effects: Pick<
    FinalResponseDeliveryEffects,
    'updateMessage' | 'updateMessageAssistantMetadata' | 'updateMessageProviderReplay'
  >;
}): string | undefined {
  const output = params.synthesized.output?.trim();
  if (!output) {
    return undefined;
  }

  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const runMessageScope = buildAgentRunMessageScope(params.run);
  const targetMessageId = latestConversation
    ? findAgentRunReplaceableAssistantMessageId(latestConversation.messages, runMessageScope)
    : undefined;
  const finalOutput = output;
  const finalAssistantMetadata = buildAssistantMessageMetadata('final', {
    completionStatus: 'complete',
    finishReason:
      params.synthesized.source === 'synthesized'
        ? 'synthesized_from_evidence'
        : params.synthesized.source === 'graph'
          ? 'graph_expected_output'
          : 'fallback_from_evidence',
    ...(params.run.terminalReason ? { terminalReason: params.run.terminalReason } : {}),
  });

  if (targetMessageId) {
    params.effects.updateMessage(params.conversationId, targetMessageId, finalOutput);
    params.effects.updateMessageAssistantMetadata(
      params.conversationId,
      targetMessageId,
      finalAssistantMetadata,
    );
    params.effects.updateMessageProviderReplay(
      params.conversationId,
      targetMessageId,
      params.synthesized.source === 'synthesized' ? params.synthesized.providerReplay : undefined,
    );
  } else {
    useChatStore.getState().addMessage(params.conversationId, {
      id: generateId(),
      role: 'assistant',
      content: finalOutput,
      providerReplay:
        params.synthesized.source === 'synthesized' ? params.synthesized.providerReplay : undefined,
      assistantMetadata: finalAssistantMetadata,
    });
  }

  return truncateLogDetail(finalOutput) || finalOutput;
}
