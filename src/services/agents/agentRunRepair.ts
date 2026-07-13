import { useChatStore } from '../../store/useChatStore';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useSettingsStore } from '../../store/useSettingsStore';
import { generateId } from '../../utils/id';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { listActiveSubAgents } from './subAgent';
import { resolveConversationProviderContext } from '../llm/support/providerSupport';
import {
  buildAgentRunCompletionFallbackOutput,
  buildMissingFinalResponseFallback,
  collectAgentRunFinalizationEvidence,
  synthesizeAgentRunFinalAnswer,
} from './lifecycle/finalizePhase';
import { AGENT_RUN_FINALIZATION_SYNTHESIS_TIMEOUT_MS } from './agentRunFinalizationSynthesis';
import { getSubAgentsForAgentRun } from './lifecycle/stateMachine';
import {
  buildAgentRunMessageScope,
  getAgentRunMessageSlice,
  hasNewerRunningAgentRun,
  hasDeliveredFinalAssistantResponse,
} from './lifecycle/agentRunStateMachine';
import { readPendingGoalUserConstraintDelivery } from '../../engine/goals/userConstraintFinalDelivery';
import { buildAgentControlGraphAfterPersistedFinalDelivery } from '../../engine/graph/persistedFinalDelivery';
import { canWriteLongTermMemory } from '../memory/policy';

const FINAL_RESPONSE_CHECKPOINT_TITLE = 'Final response delivered';
const MAX_LOG_DETAIL_CHARS = 320;
export const AGENT_RUN_REPAIR_SYNTHESIS_SWEEP_BUDGET_MS =
  AGENT_RUN_FINALIZATION_SYNTHESIS_TIMEOUT_MS;

type ResolvedFinalizationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
};

type ProviderContextResolution = Promise<ResolvedFinalizationProviderContext | undefined>;

function truncateLogDetail(value?: string, maxLength = MAX_LOG_DETAIL_CHARS): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function isPlainAgentRunAssistantMessage(message: Message): boolean {
  return (
    message.role === 'assistant' && !message.subAgentEvent && (message.toolCalls?.length ?? 0) === 0
  );
}

function findAgentRunReplaceableAssistantMessageId(
  messages: Message[],
  runScope: Parameters<typeof getAgentRunMessageSlice>[1],
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, runScope);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (message.role === 'tool') {
      continue;
    }

    if (isPlainAgentRunAssistantMessage(message)) {
      return message.id;
    }

    return undefined;
  }

  return undefined;
}

async function resolveConversationFinalizationContext(
  conversation: Conversation,
): Promise<ResolvedFinalizationProviderContext | undefined> {
  const settings = useSettingsStore.getState();
  const providerContext = await resolveConversationProviderContext({
    activeModel: settings.activeModel,
    activeProviderId: settings.activeProviderId,
    conversation,
    providers: settings.providers,
    systemPrompt: settings.systemPrompt,
  });
  if (!providerContext) {
    return undefined;
  }

  return {
    provider: providerContext.provider,
    model: providerContext.model,
    systemPromptText: providerContext.systemPromptText,
  };
}

async function resolveConversationFinalizationContextBeforeDeadline(params: {
  cache: Map<string, ProviderContextResolution>;
  conversation: Conversation;
  deadlineAt: number;
}): Promise<ResolvedFinalizationProviderContext | undefined> {
  const remainingMs = params.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    return undefined;
  }

  let resolution = params.cache.get(params.conversation.id);
  if (!resolution) {
    resolution = resolveConversationFinalizationContext(params.conversation).catch(() => undefined);
    params.cache.set(params.conversation.id, resolution);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => resolve(undefined), remainingMs);
  });
  try {
    return await Promise.race([resolution, deadline]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function synthesizeRecoveredAgentRunCompletion(params: {
  conversation: Conversation;
  run: AgentRun & { status: Exclude<AgentRun['status'], 'running'> };
  providerContextCache: Map<string, ProviderContextResolution>;
  liveSubAgentSnapshots: ReadonlyArray<SubAgentSnapshot>;
  synthesisDeadlineAt: number;
}): Promise<{
  output?: string;
  providerReplay?: Message['providerReplay'];
  source: 'synthesized' | 'fallback' | 'none';
}> {
  const pendingConstraintDelivery = readPendingGoalUserConstraintDelivery(
    params.run.controlGraph?.goals,
  );
  const requiresConstraintAwareSynthesis =
    params.run.status === 'completed' && pendingConstraintDelivery.state === 'canonical';
  if (params.run.status === 'completed' && pendingConstraintDelivery.state === 'conflict') {
    return { source: 'none' };
  }

  const evidence = collectAgentRunFinalizationEvidence(
    params.conversation.messages,
    buildAgentRunMessageScope(params.run),
    params.run.summary.startedTools,
    {
      liveSubAgentSnapshots: params.liveSubAgentSnapshots,
      originalPromptOverride: params.run.goal,
    },
  );
  const fallbackOutput =
    buildAgentRunCompletionFallbackOutput({
      status: params.run.status,
      evidence,
    }) || buildMissingFinalResponseFallback(params.run.status);

  if (params.run.status !== 'completed') {
    return {
      output: fallbackOutput,
      source: 'fallback',
    };
  }

  const hasRecoverableEvidence =
    !evidence.hasIncompleteToolCalls &&
    (evidence.lastNonEmptyAssistantContent.trim().length > 0 ||
      evidence.resultPreviews.length > 0 ||
      evidence.lastSubstantiveResult.trim().length > 0);
  if (!hasRecoverableEvidence) {
    if (requiresConstraintAwareSynthesis) return { source: 'none' };
    return {
      output: fallbackOutput,
      source: 'fallback',
    };
  }

  if (Date.now() >= params.synthesisDeadlineAt) {
    if (requiresConstraintAwareSynthesis) return { source: 'none' };
    return {
      output: fallbackOutput,
      source: fallbackOutput ? 'fallback' : 'none',
    };
  }

  const providerContext = await resolveConversationFinalizationContextBeforeDeadline({
    cache: params.providerContextCache,
    conversation: params.conversation,
    deadlineAt: params.synthesisDeadlineAt,
  });
  const remainingSynthesisBudgetMs = params.synthesisDeadlineAt - Date.now();
  if (!providerContext || remainingSynthesisBudgetMs <= 0) {
    if (requiresConstraintAwareSynthesis) return { source: 'none' };
    return {
      output: fallbackOutput,
      source: fallbackOutput ? 'fallback' : 'none',
    };
  }

  // Terminal repair recovery: graph did not supply a final response.
  const synthesized = await synthesizeAgentRunFinalAnswer({
    provider: providerContext.provider,
    model: providerContext.model,
    systemPrompt: providerContext.systemPromptText,
    evidence,
    ...(pendingConstraintDelivery.state === 'canonical'
      ? { pendingUserConstraints: pendingConstraintDelivery.entries }
      : {}),
    timeoutMs: remainingSynthesisBudgetMs,
  });

  const synthesizedOutput = synthesized.output?.trim();
  if (synthesizedOutput) {
    return {
      output: synthesizedOutput,
      providerReplay: synthesized.providerReplay,
      source: 'synthesized',
    };
  }

  return {
    ...(requiresConstraintAwareSynthesis ? {} : { output: fallbackOutput }),
    source: requiresConstraintAwareSynthesis ? 'none' : fallbackOutput ? 'fallback' : 'none',
  };
}

function reconcilePersistedCompletedRunGraph(params: {
  conversationId: string;
  runId: string;
}): boolean {
  const store = useChatStore.getState();
  const conversation = store.conversations.find(
    (candidate) => candidate.id === params.conversationId,
  );
  const run = conversation?.agentRuns?.find((candidate) => candidate.id === params.runId);
  if (!conversation || !run || run.status !== 'completed' || !run.controlGraph) {
    return false;
  }
  const reconciledGraph = buildAgentControlGraphAfterPersistedFinalDelivery({
    messages: conversation.messages,
    run,
    terminalReason: run.controlGraph.terminalReason,
  });
  if (!reconciledGraph || reconciledGraph === run.controlGraph) return false;

  store.updateAgentRunControlGraph(params.conversationId, reconciledGraph, params.runId);
  const updatedRun = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId)
    ?.agentRuns?.find((candidate) => candidate.id === params.runId);
  return (
    updatedRun?.status === 'completed' &&
    updatedRun.controlGraph?.status === 'finalized' &&
    readPendingGoalUserConstraintDelivery(updatedRun.controlGraph.goals).state === 'absent'
  );
}

function initializeRepairedFinalMemoryPublication(params: {
  conversation: Conversation;
  finalMessageId: string;
}): void {
  const disposition = !canWriteLongTermMemory()
    ? 'opt_out'
    : params.conversation.isSideThread
      ? 'ephemeral_thread'
      : null;
  const transition = useChatStore
    .getState()
    .transitionMessageMemoryPublication(params.conversation.id, params.finalMessageId, disposition);
  if (transition.status !== 'applied' || transition.publication.disposition !== disposition) {
    const reason = transition.status === 'rejected' ? transition.reason : 'disposition_mismatch';
    throw new Error(`agent_run_repair_memory_publication_${reason}`);
  }
}

export async function repairTerminalAgentRunsMissingFinalResponses(params?: {
  activeSubAgents?: ReadonlyArray<SubAgentSnapshot>;
  synthesisSweepBudgetMs?: number;
}): Promise<string[]> {
  const repairedRunIds: string[] = [];
  let repairedConstraintDelivery = false;
  const activeSubAgents = params?.activeSubAgents ?? listActiveSubAgents();
  const providerContextCache = new Map<string, ProviderContextResolution>();
  const configuredSynthesisSweepBudgetMs = params?.synthesisSweepBudgetMs;
  const synthesisSweepBudgetMs =
    typeof configuredSynthesisSweepBudgetMs === 'number' &&
    Number.isFinite(configuredSynthesisSweepBudgetMs)
      ? Math.max(0, Math.floor(configuredSynthesisSweepBudgetMs))
      : AGENT_RUN_REPAIR_SYNTHESIS_SWEEP_BUDGET_MS;
  const synthesisDeadlineAt = Date.now() + synthesisSweepBudgetMs;

  const initialConversations = useChatStore.getState().conversations;
  for (const initialConversation of initialConversations) {
    const runIds = (initialConversation.agentRuns ?? []).map((run) => run.id);

    for (const runId of runIds) {
      const store = useChatStore.getState();
      const conversation = store.conversations.find(
        (candidate) => candidate.id === initialConversation.id,
      );
      const run = conversation?.agentRuns?.find((candidate) => candidate.id === runId);
      if (!conversation || !run || run.status === 'running') {
        continue;
      }
      const terminalRun = run as AgentRun & { status: Exclude<AgentRun['status'], 'running'> };
      if (hasNewerRunningAgentRun(conversation, terminalRun)) {
        continue;
      }

      const terminalRunMessageScope = buildAgentRunMessageScope(terminalRun);
      if (hasDeliveredFinalAssistantResponse(conversation.messages, terminalRunMessageScope)) {
        repairedConstraintDelivery =
          reconcilePersistedCompletedRunGraph({
            conversationId: conversation.id,
            runId: terminalRun.id,
          }) || repairedConstraintDelivery;
        continue;
      }

      const synthesized = await synthesizeRecoveredAgentRunCompletion({
        conversation,
        run: terminalRun,
        providerContextCache,
        liveSubAgentSnapshots: getSubAgentsForAgentRun(
          conversation,
          terminalRun.id,
          activeSubAgents,
        ),
        synthesisDeadlineAt,
      });
      const output = synthesized.output?.trim();
      if (!output) {
        continue;
      }

      const latestStore = useChatStore.getState();
      const latestConversation = latestStore.conversations.find(
        (candidate) => candidate.id === conversation.id,
      );
      const latestRun = latestConversation?.agentRuns?.find(
        (candidate) => candidate.id === terminalRun.id,
      );
      if (!latestConversation || !latestRun || latestRun.status === 'running') {
        continue;
      }
      if (hasNewerRunningAgentRun(latestConversation, latestRun)) {
        continue;
      }

      const latestRunMessageScope = buildAgentRunMessageScope(latestRun);
      if (hasDeliveredFinalAssistantResponse(latestConversation.messages, latestRunMessageScope)) {
        continue;
      }

      const targetMessageId = findAgentRunReplaceableAssistantMessageId(
        latestConversation.messages,
        latestRunMessageScope,
      );
      const finalAssistantMetadata = buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason:
          synthesized.source === 'synthesized'
            ? 'synthesized_from_evidence'
            : 'fallback_from_evidence',
      });

      const finalMessageId = targetMessageId ?? generateId();
      if (targetMessageId) {
        latestStore.updateMessage(conversation.id, targetMessageId, output);
        latestStore.updateMessageAssistantMetadata(
          conversation.id,
          targetMessageId,
          finalAssistantMetadata,
        );
        if (synthesized.source === 'synthesized' && synthesized.providerReplay) {
          latestStore.updateMessageProviderReplay(
            conversation.id,
            targetMessageId,
            synthesized.providerReplay,
          );
        } else {
          latestStore.updateMessageProviderReplay(conversation.id, targetMessageId, undefined);
        }
      } else {
        latestStore.addMessage(conversation.id, {
          id: finalMessageId,
          role: 'assistant',
          content: output,
          providerReplay:
            synthesized.source === 'synthesized' ? synthesized.providerReplay : undefined,
          assistantMetadata: finalAssistantMetadata,
        });
      }

      initializeRepairedFinalMemoryPublication({
        conversation: latestConversation,
        finalMessageId,
      });

      // The recovered final and its publication intent form one durability
      // boundary. Startup recovery settles the open receipt after hydration.
      await flushChatStorePersistenceNow();

      const requiresConstraintDeliveryAcknowledgement =
        latestRun.status === 'completed' &&
        readPendingGoalUserConstraintDelivery(latestRun.controlGraph?.goals).state === 'canonical';
      const persistedConversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversation.id);
      const persistedRun = persistedConversation?.agentRuns?.find(
        (candidate) => candidate.id === latestRun.id,
      );
      if (
        !persistedConversation ||
        !persistedRun ||
        !hasDeliveredFinalAssistantResponse(
          persistedConversation.messages,
          buildAgentRunMessageScope(persistedRun),
        )
      ) {
        continue;
      }
      if (requiresConstraintDeliveryAcknowledgement) {
        repairedConstraintDelivery =
          reconcilePersistedCompletedRunGraph({
            conversationId: conversation.id,
            runId: latestRun.id,
          }) || repairedConstraintDelivery;
      }

      const deliveredTimestamp = Date.now();
      const preview = truncateLogDetail(output) || output;
      latestStore.appendAgentRunCheckpoint(
        conversation.id,
        {
          kind: 'run',
          title: FINAL_RESPONSE_CHECKPOINT_TITLE,
          detail: preview,
          timestamp: deliveredTimestamp,
        },
        latestRun.id,
      );
      latestStore.updateAgentRunSummary(
        conversation.id,
        {
          latestSummary: preview,
          timestamp: deliveredTimestamp,
        },
        latestRun.id,
      );
      latestStore.addConversationLog(conversation.id, {
        kind: 'state',
        level:
          latestRun.status === 'completed'
            ? 'success'
            : latestRun.status === 'cancelled'
              ? 'warning'
              : 'error',
        title: FINAL_RESPONSE_CHECKPOINT_TITLE,
        detail: preview,
        timestamp: deliveredTimestamp,
      });
      repairedRunIds.push(latestRun.id);
    }
  }

  if (repairedRunIds.length > 0 || repairedConstraintDelivery) {
    await flushChatStorePersistenceNow();
  }

  return repairedRunIds;
}
