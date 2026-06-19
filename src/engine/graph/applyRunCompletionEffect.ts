import type {
  AgentRun,
  AgentRunControlGraphState,
  AgentRunSummary,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import { reduceAgentControlGraph } from './agentControlGraph';
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
  getLatestConversation?: () => Conversation | undefined;
  runId: string;
}): void {
  const latestRun = params
    .getLatestConversation?.()
    ?.agentRuns?.find((candidate) => candidate.id === params.runId);
  if (latestRun?.status && latestRun.status !== 'running') {
    return;
  }

  if (latestRun?.controlGraph) {
    params.actions.updateAgentRunControlGraph(
      params.conversationId,
      reduceAgentControlGraph(latestRun.controlGraph, [
        buildAgentControlGraphTerminalEventForCompletion({
          status: params.effect.status,
          terminalReason: params.effect.terminalReason,
        }),
      ]),
      params.runId,
    );
  }

  params.actions.completeAgentRun(params.conversationId, params.effect, params.runId);
}
