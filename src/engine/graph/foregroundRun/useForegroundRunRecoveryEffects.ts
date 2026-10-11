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
import {
  publishConversationTurnMemory,
  type RecordConversationTurnMemory,
} from '../../../services/memory/core/memoryCapture';
import { flushChatStorePersistenceNow } from '../../../store/chatStorePersistence';
import { useChatStore } from '../../../store/useChatStore';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';

type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

type QueueTerminalBackgroundReview = (params: {
  conversationId: string;
  runId: string;
  timestamp?: number;
}) => Promise<void>;

type TerminalFinalResponseRecoveryDependencies = {
  flushChatState: () => Promise<void>;
  getConversations: () => Conversation[];
  recordConversationTurnMemory: RecordConversationTurnMemory;
};

const DEFAULT_RECOVERY_DEPENDENCIES: TerminalFinalResponseRecoveryDependencies = {
  flushChatState: flushChatStorePersistenceNow,
  getConversations: () => useChatStore.getState().conversations,
  recordConversationTurnMemory: publishConversationTurnMemory,
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

export async function recoverTerminalFinalResponse(
  params: {
    candidate: TerminalFinalResponseRecoveryCandidate;
    ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
    providerContext: ResolvedFinalizationProviderContext | undefined;
  },
  dependencies: TerminalFinalResponseRecoveryDependencies = DEFAULT_RECOVERY_DEPENDENCIES,
): Promise<string | undefined> {
  const existing = resolveCandidateRunState(params.candidate, dependencies);
  if (existing?.final) return existing.final.content.trim();

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
  await dependencies.flushChatState();
  dependencies.recordConversationTurnMemory(params.candidate.conversationId, repaired.final.id);
  return preview;
}

function reportTerminalFinalRecoveryError(error: unknown): void {
  console.warn('[foreground-recovery] Terminal final response recovery failed:', error);
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
