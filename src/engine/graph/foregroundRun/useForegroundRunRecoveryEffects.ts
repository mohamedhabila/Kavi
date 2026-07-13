import { useEffect } from 'react';
import { selectTerminalBackgroundReviewCandidates } from '../terminalBackgroundReviewEligibility';
import {
  selectTerminalConversationsWithFinalResponseGaps,
  selectTerminalFinalResponseRecoveryCandidates,
  type TerminalFinalResponseRecoveryCandidate,
} from '../terminalFinalResponseRecovery';
import type { EnsureAgentRunFinalResponse, ResolvedFinalizationProviderContext } from './contracts';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
} from '../../../services/agents/lifecycle/agentRunStateMachine';
import { getReviewableSubAgentsForRun } from '../../../services/agents/subAgentRunTracking';
import { canWriteLongTermMemory } from '../../../services/memory/policy';
import {
  settleMessageMemoryPublication,
  type MessageMemoryPublicationSettlementResult,
} from '../../../services/memory/messageMemoryPublicationSettlement';
import { flushChatStorePersistenceNow } from '../../../store/chatStorePersistence';
import type { ChatState } from '../../../store/chatStoreTypes';
import { useChatStore } from '../../../store/useChatStore';
import type { Conversation } from '../../../types/conversation';
import type { Message, MessageMemoryPublicationDisposition } from '../../../types/message';
import type { LlmProviderConfig } from '../../../types/provider';
import { normalizeMessageMemoryPublication } from '../../../utils/messageMemoryPublication';

type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

type QueueTerminalBackgroundReview = (params: {
  conversationId: string;
  runId: string;
  timestamp?: number;
}) => Promise<void>;

type SettleRecoveredMessageMemoryPublication = (params: {
  conversationId: string;
  sourceEndMessageId: string;
  sourceRunId: string;
  activeChatProvider?: LlmProviderConfig;
}) => Promise<MessageMemoryPublicationSettlementResult>;

type TerminalFinalResponseRecoveryDependencies = {
  flushChatState: () => Promise<void>;
  getConversations: () => Conversation[];
  isMemoryEnabled: () => boolean;
  settleMemoryPublication: SettleRecoveredMessageMemoryPublication;
  transitionMessageMemoryPublication: ChatState['transitionMessageMemoryPublication'];
};

const DEFAULT_RECOVERY_DEPENDENCIES: TerminalFinalResponseRecoveryDependencies = {
  flushChatState: flushChatStorePersistenceNow,
  getConversations: () => useChatStore.getState().conversations,
  isMemoryEnabled: canWriteLongTermMemory,
  settleMemoryPublication: settleMessageMemoryPublication,
  transitionMessageMemoryPublication: (conversationId, sourceEndMessageId, disposition) =>
    useChatStore
      .getState()
      .transitionMessageMemoryPublication(conversationId, sourceEndMessageId, disposition),
};

function fail(code: string): never {
  throw new Error(code);
}

function resolveCandidateRunState(
  candidate: TerminalFinalResponseRecoveryCandidate,
  dependencies: TerminalFinalResponseRecoveryDependencies,
): { conversation: Conversation; final: Message | undefined } | undefined {
  const conversations = dependencies
    .getConversations()
    .filter((conversation) => conversation.id === candidate.conversationId);
  if (conversations.length > 1) {
    return fail('terminal_final_recovery_conversation_identity_invalid');
  }
  const conversation = conversations[0];
  if (!conversation) return undefined;

  const runs = (conversation.agentRuns ?? []).filter((run) => run.id === candidate.runId);
  if (runs.length > 1) return fail('terminal_final_recovery_run_identity_invalid');
  const run = runs[0];
  if (!run) return undefined;

  return {
    conversation,
    final: getLatestAssistantProjectionFinalResponse(
      conversation.messages,
      buildAgentRunMessageScope(run),
    ),
  };
}

function readPublicationDisposition(
  message: Message,
): MessageMemoryPublicationDisposition | undefined {
  const publication = normalizeMessageMemoryPublication(message.memoryPublication);
  if (message.memoryPublication !== undefined && publication === undefined) {
    return fail('terminal_final_recovery_memory_publication_invalid');
  }
  return publication?.disposition;
}

function initializeRecoveredFinalPublication(params: {
  candidate: TerminalFinalResponseRecoveryCandidate;
  conversation: Conversation;
  dependencies: TerminalFinalResponseRecoveryDependencies;
  final: Message;
}): MessageMemoryPublicationDisposition {
  const existingDisposition = readPublicationDisposition(params.final);
  if (existingDisposition !== undefined) return existingDisposition;

  const disposition: MessageMemoryPublicationDisposition = !params.dependencies.isMemoryEnabled()
    ? 'opt_out'
    : params.conversation.isSideThread
      ? 'ephemeral_thread'
      : null;
  const transition = params.dependencies.transitionMessageMemoryPublication(
    params.candidate.conversationId,
    params.final.id,
    disposition,
  );
  if (transition.status !== 'applied') {
    return fail(`terminal_final_recovery_memory_publication_${transition.reason}`);
  }
  return transition.publication.disposition;
}

function resolveActiveChatProvider(
  providerContext: ResolvedFinalizationProviderContext | undefined,
): LlmProviderConfig | undefined {
  return providerContext
    ? { ...providerContext.provider, model: providerContext.model }
    : undefined;
}

async function flushAndSettleRecoveredFinal(params: {
  candidate: TerminalFinalResponseRecoveryCandidate;
  dependencies: TerminalFinalResponseRecoveryDependencies;
  finalId: string;
  providerContext: ResolvedFinalizationProviderContext | undefined;
}): Promise<void> {
  await params.dependencies.flushChatState();

  const current = resolveCandidateRunState(params.candidate, params.dependencies);
  if (current?.final?.id !== params.finalId) {
    return fail('terminal_final_recovery_memory_source_changed');
  }
  if (readPublicationDisposition(current.final) === undefined) {
    return fail('terminal_final_recovery_memory_publication_removed');
  }

  await params.dependencies.settleMemoryPublication({
    conversationId: params.candidate.conversationId,
    sourceEndMessageId: params.finalId,
    sourceRunId: params.candidate.runId,
    activeChatProvider: resolveActiveChatProvider(params.providerContext),
  });
}

export async function recoverTerminalFinalResponse(
  params: {
    candidate: TerminalFinalResponseRecoveryCandidate;
    ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
    providerContext: ResolvedFinalizationProviderContext | undefined;
  },
  dependencies: TerminalFinalResponseRecoveryDependencies = DEFAULT_RECOVERY_DEPENDENCIES,
): Promise<string | undefined> {
  const existing = resolveCandidateRunState(params.candidate, dependencies);
  if (existing?.final) {
    const existingDisposition = readPublicationDisposition(existing.final);
    if (existingDisposition === null) {
      await flushAndSettleRecoveredFinal({
        candidate: params.candidate,
        dependencies,
        finalId: existing.final.id,
        providerContext: params.providerContext,
      });
    }
    return existing.final.content.trim();
  }

  const preview = await params.ensureAgentRunFinalResponse({
    conversationId: params.candidate.conversationId,
    runId: params.candidate.runId,
    status: params.candidate.status,
    providerContext: params.providerContext,
    timestamp: params.candidate.timestamp,
  });
  if (!preview) return undefined;

  const repaired = resolveCandidateRunState(params.candidate, dependencies);
  if (!repaired?.final) return fail('terminal_final_recovery_final_unavailable');

  initializeRecoveredFinalPublication({
    candidate: params.candidate,
    conversation: repaired.conversation,
    dependencies,
    final: repaired.final,
  });
  await flushAndSettleRecoveredFinal({
    candidate: params.candidate,
    dependencies,
    finalId: repaired.final.id,
    providerContext: params.providerContext,
  });
  return preview;
}

function reportTerminalFinalRecoveryError(error: unknown): void {
  console.warn('[foreground-recovery] Terminal final memory publication remains pending:', error);
}

export function useForegroundRunRecoveryEffects(params: {
  conversations: Conversation[];
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
  resolveConversationFinalizationContext: ResolveConversationFinalizationContext;
  subAgentActivityVersion: number;
}) {
  const {
    conversations,
    ensureAgentRunFinalResponse,
    queueTerminalBackgroundReview,
    resolveConversationFinalizationContext,
    subAgentActivityVersion,
  } = params;

  useEffect(() => {
    for (const candidate of selectTerminalBackgroundReviewCandidates({
      conversations,
      getReviewableWorkers: getReviewableSubAgentsForRun,
    })) {
      void queueTerminalBackgroundReview(candidate);
    }
  }, [conversations, queueTerminalBackgroundReview, subAgentActivityVersion]);

  useEffect(() => {
    const terminalConversations = selectTerminalConversationsWithFinalResponseGaps(conversations);
    if (!terminalConversations.length) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const conversation of terminalConversations) {
        const providerContext = await resolveConversationFinalizationContext(conversation);
        if (cancelled) {
          return;
        }

        for (const candidate of selectTerminalFinalResponseRecoveryCandidates({
          conversation,
          hasProviderContext: !!providerContext,
        })) {
          try {
            await recoverTerminalFinalResponse({
              candidate,
              ensureAgentRunFinalResponse,
              providerContext,
            });
          } catch (error) {
            reportTerminalFinalRecoveryError(error);
          }

          if (cancelled) {
            return;
          }
        }
      }
    })().catch(reportTerminalFinalRecoveryError);

    return () => {
      cancelled = true;
    };
  }, [conversations, ensureAgentRunFinalResponse, resolveConversationFinalizationContext]);
}
