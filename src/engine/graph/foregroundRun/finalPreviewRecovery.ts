import { throwIfAbortSignalTriggered } from '../../../services/agents/agentRunCancellation';
import {
  canRecoverAgentRunFinalResponse,
  collectAgentRunFinalizationEvidence,
} from '../../../services/agents/lifecycle/finalizePhase';
import {
  buildAgentRunMessageScope,
  getLatestFinalAssistantResponsePreview,
} from '../../../services/agents/lifecycle/agentRunStateMachine';
import { useChatStore } from '../../../store/useChatStore';
import { AgentRun } from '../../../types/agentRun';
import { truncateLogDetail } from '../../../utils/logDetail';
import { EnsureAgentRunFinalResponse, ResolvedFinalizationProviderContext } from './contracts';

export async function recoverForegroundAgentRunFinalPreview(params: {
  conversationId: string;
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  finalizationProviderContext: ResolvedFinalizationProviderContext;
  preferredAssistantMessageId?: string;
  runId?: string;
  signal?: AbortSignal;
  status: Exclude<AgentRun['status'], 'running'>;
  timestamp?: number;
}): Promise<{ preview?: string; recovered: boolean }> {
  if (!params.runId) {
    return { recovered: false };
  }

  throwIfAbortSignalTriggered(params.signal);

  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const targetRun = latestConversation?.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );
  if (!latestConversation || !targetRun) {
    return { recovered: false };
  }
  const runMessageScope = buildAgentRunMessageScope(targetRun);

  const existingPreview = getLatestFinalAssistantResponsePreview(
    latestConversation.messages,
    runMessageScope,
  );
  if (existingPreview) {
    return {
      preview: truncateLogDetail(existingPreview) || existingPreview,
      recovered: false,
    };
  }

  const evidence = collectAgentRunFinalizationEvidence(
    latestConversation.messages,
    runMessageScope,
    targetRun.summary.startedTools,
    { originalPromptOverride: targetRun.goal },
  );
  if (
    !canRecoverAgentRunFinalResponse({
      evidence,
      hasProviderContext: true,
      status: params.status,
    })
  ) {
    return { recovered: false };
  }

  const finalResponsePreview = await params.ensureAgentRunFinalResponse({
    conversationId: params.conversationId,
    runId: params.runId,
    status: params.status,
    providerContext: params.finalizationProviderContext,
    timestamp: params.timestamp,
    preferredAssistantMessageId: params.preferredAssistantMessageId,
    signal: params.signal,
  });

  throwIfAbortSignalTriggered(params.signal);

  return {
    preview: finalResponsePreview,
    recovered: !!finalResponsePreview,
  };
}
