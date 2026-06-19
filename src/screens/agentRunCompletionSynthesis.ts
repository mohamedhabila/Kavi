import { useChatStore } from '../store/useChatStore';
import { AgentRun } from '../types/agentRun';
import { Message } from '../types/message';
import { readGraphExpectedFinalResponse } from '../engine/graph/goalFinalResponse';
import {
  buildAgentRunCompletionFallbackOutput,
  buildMissingFinalResponseFallback,
  collectAgentRunFinalizationEvidence,
  hasVerifiedFinalizationEvidence,
  synthesizeAgentRunFinalAnswer,
} from '../services/agents/lifecycle/finalizePhase';
import { throwIfAbortSignalTriggered } from '../services/agents/agentRunCancellation';
import { getLiveSubAgentsForRun } from '../services/agents/subAgentRunTracking';
import { ResolvedFinalizationProviderContext } from '../engine/graph/foregroundRun/contracts';
import { buildAgentRunMessageScope } from '../services/agents/lifecycle/agentRunStateMachine';

type Conversation = ReturnType<typeof useChatStore.getState>['conversations'][number];

export type SynthesizedAgentRunCompletion = {
  output?: string;
  providerReplay?: Message['providerReplay'];
  source: 'graph' | 'synthesized' | 'fallback' | 'none';
};

export async function synthesizeAgentRunCompletion(params: {
  conversationId: string;
  run: AgentRun;
  status: Exclude<AgentRun['status'], 'running'>;
  providerContext?: ResolvedFinalizationProviderContext;
  resolveConversationFinalizationContext?: (
    conversation: Conversation,
  ) => Promise<ResolvedFinalizationProviderContext | undefined>;
  signal?: AbortSignal;
}): Promise<SynthesizedAgentRunCompletion> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);

  if (!conversation) {
    return {
      output: buildMissingFinalResponseFallback(params.status),
      source: 'fallback',
    };
  }

  throwIfAbortSignalTriggered(params.signal);

  // Graph-finalized runs deliver goal evidence directly; provider synthesis is recovery-only.
  const graphExpectedFinalResponse =
    params.status === 'completed' ? readGraphExpectedFinalResponse(params.run) : undefined;
  if (graphExpectedFinalResponse) {
    return {
      output: graphExpectedFinalResponse,
      source: 'graph',
    };
  }

  const liveSubAgentSnapshots = getLiveSubAgentsForRun(conversation, params.run.id);
  const evidence = collectAgentRunFinalizationEvidence(
    conversation.messages,
    buildAgentRunMessageScope(params.run),
    params.run.summary.startedTools,
    {
      liveSubAgentSnapshots,
      originalPromptOverride: params.run.goal,
    },
  );
  const fallbackOutput =
    buildAgentRunCompletionFallbackOutput({
      status: params.status,
      evidence,
    }) || buildMissingFinalResponseFallback(params.status);

  if (params.status !== 'completed') {
    return {
      output: fallbackOutput,
      source: 'fallback',
    };
  }

  const providerContext =
    params.providerContext ?? (await params.resolveConversationFinalizationContext?.(conversation));
  const canSynthesize =
    !evidence.hasIncompleteToolCalls &&
    (hasVerifiedFinalizationEvidence(evidence) ||
      evidence.lastNonEmptyAssistantContent.trim().length > 0);
  if (!providerContext || !canSynthesize) {
    return {
      output: fallbackOutput,
      source: fallbackOutput ? 'fallback' : 'none',
    };
  }

  throwIfAbortSignalTriggered(params.signal);

  // Recovery path only: graph did not finalize with goal evidence.
  const synthesized = await synthesizeAgentRunFinalAnswer({
    provider: providerContext.provider,
    model: providerContext.model,
    systemPrompt: providerContext.systemPromptText,
    evidence,
    signal: params.signal,
  });

  throwIfAbortSignalTriggered(params.signal);

  const synthesizedOutput = synthesized.output?.trim();
  if (synthesizedOutput) {
    return {
      output: synthesizedOutput,
      providerReplay: synthesized.providerReplay,
      source: 'synthesized',
    };
  }

  return {
    output: fallbackOutput,
    source: fallbackOutput ? 'fallback' : 'none',
  };
}
