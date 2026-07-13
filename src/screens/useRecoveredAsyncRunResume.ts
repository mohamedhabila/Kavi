import { useCallback, useEffect, type MutableRefObject } from 'react';
import { useChatStore } from '../store/useChatStore';
import { AgentRunAsyncOperation } from '../types/agentRun';
import { Conversation } from '../types/conversation';
import {
  buildPendingAsyncOperationResumePrompt,
  buildPendingAsyncOperationSummary,
} from '../engine/pendingAsyncOperations';
import {
  getAgentRunPendingAsyncOperations,
  isAgentRunAwaitingBackgroundWorkers,
} from '../services/agents/agentRunAsyncState';
import {
  createAgentRunOperationController,
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../services/agents/agentRunCancellation';
import { createAgentRunIdentityKey } from '../services/agents/agentRunIdentity';
import { ResumeAgentRun } from '../engine/graph/foregroundRun/contracts';

type AppendConversationLog = (
  conversationId: string,
  entry: Parameters<ReturnType<typeof useChatStore.getState>['addConversationLog']>[1],
) => void;

type QueueRecoveredAsyncRunResume = (params: {
  conversationId: string;
  runId: string;
  pendingOperations: AgentRunAsyncOperation[];
  timestamp?: number;
}) => Promise<void>;

export function useRecoveredAsyncRunResume({
  activeForegroundConversationIds,
  appendConversationLog,
  conversations,
  pendingAgentRunAsyncResumesRef,
  resumeAgentRunRef,
  setAgentRunPhase,
  updateAgentRunSummary,
}: {
  activeForegroundConversationIds: ReadonlySet<string>;
  appendConversationLog: AppendConversationLog;
  conversations: Conversation[];
  pendingAgentRunAsyncResumesRef: MutableRefObject<Map<string, Promise<void>>>;
  resumeAgentRunRef: MutableRefObject<ResumeAgentRun | null>;
  setAgentRunPhase: ReturnType<typeof useChatStore.getState>['setAgentRunPhase'];
  updateAgentRunSummary: ReturnType<typeof useChatStore.getState>['updateAgentRunSummary'];
}): QueueRecoveredAsyncRunResume {
  const queueRecoveredAsyncRunResume = useCallback<QueueRecoveredAsyncRunResume>(
    (params) => {
      const runIdentityKey = createAgentRunIdentityKey(params);
      const inFlight = pendingAgentRunAsyncResumesRef.current.get(runIdentityKey);
      if (inFlight) {
        return inFlight;
      }

      const resumePromise = Promise.resolve().then(async () => {
        const operation = createAgentRunOperationController({
          conversationId: params.conversationId,
          runId: params.runId,
          operationId: 'async-resume',
        });

        try {
          throwIfAbortSignalTriggered(operation.signal);

          const latestConversation = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === params.conversationId);
          const targetRun = latestConversation?.agentRuns?.find(
            (candidate) => candidate.id === params.runId,
          );
          const effectivePendingOperations = targetRun
            ? getAgentRunPendingAsyncOperations(targetRun)
            : [];
          if (
            !latestConversation ||
            !targetRun ||
            targetRun.status !== 'running' ||
            isAgentRunAwaitingBackgroundWorkers(targetRun) ||
            effectivePendingOperations.length === 0
          ) {
            return;
          }

          const resumeAgentRun = resumeAgentRunRef.current;
          if (!resumeAgentRun) {
            return;
          }

          const resumeTimestamp = params.timestamp ?? Date.now();
          const summary =
            buildPendingAsyncOperationSummary(effectivePendingOperations) ||
            'Resuming asynchronous workflow monitoring.';
          setAgentRunPhase(
            params.conversationId,
            'work',
            {
              status: 'active',
              detail: summary,
              checkpointTitle: 'Recovered async workflow monitoring',
              checkpointDetail: summary,
              timestamp: resumeTimestamp,
              allowRegression: true,
            },
            params.runId,
          );
          updateAgentRunSummary(
            params.conversationId,
            {
              latestSummary: summary,
              timestamp: resumeTimestamp,
            },
            params.runId,
          );
          appendConversationLog(params.conversationId, {
            kind: 'state',
            level: 'warning',
            title: 'Recovered async workflow monitoring',
            detail: summary,
            timestamp: resumeTimestamp,
          });

          throwIfAbortSignalTriggered(operation.signal);

          await resumeAgentRun({
            conversationId: params.conversationId,
            runId: params.runId,
            additionalSystemPrompt: buildPendingAsyncOperationResumePrompt(
              effectivePendingOperations,
            ),
            assistantDraftMode: 'continue',
            initialPendingAsyncOperations: effectivePendingOperations,
          });
        } catch (error) {
          if (isAbortErrorLike(error, operation.signal)) {
            return;
          }

          throw error;
        } finally {
          operation.dispose();
        }
      });

      pendingAgentRunAsyncResumesRef.current.set(runIdentityKey, resumePromise);
      return resumePromise.finally(() => {
        if (pendingAgentRunAsyncResumesRef.current.get(runIdentityKey) === resumePromise) {
          pendingAgentRunAsyncResumesRef.current.delete(runIdentityKey);
        }
      });
    },
    [
      appendConversationLog,
      pendingAgentRunAsyncResumesRef,
      resumeAgentRunRef,
      setAgentRunPhase,
      updateAgentRunSummary,
    ],
  );

  useEffect(() => {
    for (const conversation of conversations) {
      if (activeForegroundConversationIds.has(conversation.id)) {
        continue;
      }

      const resumableRuns = (conversation.agentRuns ?? []).filter((run) => {
        if (run.status !== 'running' || isAgentRunAwaitingBackgroundWorkers(run)) {
          return false;
        }
        return getAgentRunPendingAsyncOperations(run).length > 0;
      });

      for (const run of resumableRuns) {
        void queueRecoveredAsyncRunResume({
          conversationId: conversation.id,
          runId: run.id,
          pendingOperations: getAgentRunPendingAsyncOperations(run),
          timestamp: run.updatedAt,
        });
      }
    }
  }, [activeForegroundConversationIds, conversations, queueRecoveredAsyncRunResume]);

  return queueRecoveredAsyncRunResume;
}
