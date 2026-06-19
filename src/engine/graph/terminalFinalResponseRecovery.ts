import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import {
  canRecoverAgentRunFinalResponse,
  collectAgentRunFinalizationEvidence,
} from '../../services/agents/lifecycle/finalizePhase';
import {
  buildAgentRunMessageScope,
  hasNewerRunningAgentRun,
  hasDeliveredFinalAssistantResponse,
} from '../../services/agents/lifecycle/agentRunStateMachine';

export interface TerminalFinalResponseRecoveryCandidate {
  conversationId: string;
  runId: string;
  status: Exclude<AgentRun['status'], 'running'>;
  timestamp: number;
}

export function selectTerminalConversationsWithFinalResponseGaps(
  conversations: ReadonlyArray<Conversation>,
): Conversation[] {
  return conversations.filter((conversation) =>
    (conversation.agentRuns ?? []).some(
      (run) =>
        run.status !== 'running' &&
        !hasNewerRunningAgentRun(conversation, run) &&
        !hasDeliveredFinalAssistantResponse(conversation.messages, buildAgentRunMessageScope(run)),
    ),
  );
}

export function selectTerminalFinalResponseRecoveryCandidates(params: {
  conversation: Conversation;
  hasProviderContext: boolean;
}): TerminalFinalResponseRecoveryCandidate[] {
  const candidates: TerminalFinalResponseRecoveryCandidate[] = [];

  for (const run of params.conversation.agentRuns ?? []) {
    if (run.status === 'running') {
      continue;
    }
    if (hasNewerRunningAgentRun(params.conversation, run)) {
      continue;
    }
    const runMessageScope = buildAgentRunMessageScope(run);

    if (hasDeliveredFinalAssistantResponse(params.conversation.messages, runMessageScope)) {
      continue;
    }

    const evidence = collectAgentRunFinalizationEvidence(
      params.conversation.messages,
      runMessageScope,
      run.summary.startedTools,
      { originalPromptOverride: run.goal },
    );
    if (
      !canRecoverAgentRunFinalResponse({
        evidence,
        hasProviderContext: params.hasProviderContext,
        status: run.status,
      })
    ) {
      continue;
    }

    candidates.push({
      conversationId: params.conversation.id,
      runId: run.id,
      status: run.status,
      timestamp: run.updatedAt,
    });
  }

  return candidates;
}
