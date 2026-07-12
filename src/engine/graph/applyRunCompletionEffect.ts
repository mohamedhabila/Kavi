import type {
  AgentRun,
  AgentRunControlGraphState,
  AgentRunSummary,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import { reduceAgentControlGraph } from './agentControlGraph';
import { buildAgentControlGraphAfterPersistedFinalDelivery } from './persistedFinalDelivery';
import { buildAgentControlGraphTerminalEventForCompletion } from './runCompletion';

export type ConversationRunCompletionEffect = {
  status: Exclude<AgentRun['status'], 'running'>;
  latestSummary?: string;
  summary?: Partial<AgentRunSummary>;
  checkpointTitle?: string;
  checkpointDetail?: string;
  checkpointKind?: AgentRun['checkpoints'][number]['kind'];
  terminalReason?: AgentRunTerminalReason;
  timestamp?: number;
};

export type ConversationRunCompletionActions = {
  completeAgentRun: (
    conversationId: string,
    params?: ConversationRunCompletionEffect,
    runId?: string,
  ) => void;
  updateAgentRunControlGraph: (
    conversationId: string,
    controlGraph: AgentRunControlGraphState | undefined,
    runId?: string,
  ) => void;
};

export function applyConversationRunCompletionEffect(params: {
  actions: ConversationRunCompletionActions;
  conversationId: string;
  effect: ConversationRunCompletionEffect;
  getLatestConversation: () => Conversation | undefined;
  prepareControlGraph?: (
    controlGraph: AgentRunControlGraphState,
  ) => AgentRunControlGraphState | undefined;
  runId: string;
}): boolean {
  const latestConversation = params.getLatestConversation();
  const latestRun = latestConversation?.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );
  if (!latestConversation || !latestRun || latestRun.status !== 'running') {
    return false;
  }

  let completionBaseGraph = latestRun.controlGraph;
  if (params.prepareControlGraph) {
    if (!completionBaseGraph) return false;
    completionBaseGraph = params.prepareControlGraph(completionBaseGraph);
    if (!completionBaseGraph) return false;
  }

  let completedGraph: AgentRunControlGraphState | undefined;
  if (params.effect.status === 'completed') {
    if (!completionBaseGraph) return false;
    completedGraph = buildAgentControlGraphAfterPersistedFinalDelivery({
      messages: latestConversation.messages,
      run: { ...latestRun, controlGraph: completionBaseGraph },
      terminalReason: params.effect.terminalReason,
    });
    if (!completedGraph) return false;
  }

  if (completionBaseGraph) {
    params.actions.updateAgentRunControlGraph(
      params.conversationId,
      completedGraph ??
        reduceAgentControlGraph(completionBaseGraph, [
          buildAgentControlGraphTerminalEventForCompletion({
            status: params.effect.status,
            terminalReason: params.effect.terminalReason,
          }),
        ]),
      params.runId,
    );
  }

  params.actions.completeAgentRun(params.conversationId, params.effect, params.runId);
  return true;
}
