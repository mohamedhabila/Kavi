import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useChatStore } from '../store/useChatStore';
import { applySubAgentTerminalControlGraphEffects } from '../services/agents/subAgentGoalGraphEffects';
import { listActiveSubAgents, onSubAgentEvent } from '../services/agents/subAgent';
import { buildSubAgentLifecycleMessage } from '../services/agents/lifecycle/presentPhase';
import {
  resolveAgentRunIdForSubAgent,
  resolveOwningConversationId,
} from '../services/agents/lifecycle/stateMachine';
import { generateId } from '../utils/id';
import { getAgentRunPhaseForSubAgentEvent, truncateLogDetail } from './chatFormatting';
import {
  PendingAgentRunProgressUpdate,
  QueueTerminalBackgroundReview,
  SubAgentSnapshot,
} from './subAgentRunBridgeTypes';
import { queueTerminalReviewWhenWorkersSettled } from './subAgentTerminalReview';
import {
  getSubAgentCheckpointTitle,
  getSubAgentLifecycleLogLevel,
  getSubAgentLifecycleTitle,
} from './subAgentLifecyclePresentation';

type AppendConversationLog = (
  conversationId: string,
  entry: Parameters<ReturnType<typeof useChatStore.getState>['addConversationLog']>[1],
) => void;

export function useSubAgentEventBridge({
  activeConversationId,
  appendConversationLog,
  clearSubAgentProgressFlushTimer,
  discardPendingAgentRunProgress,
  forceNextScrollRef,
  pendingAgentRunProgressRef,
  pendingSubAgentProgressRef,
  queueAgentRunProgressUpdate,
  queueTerminalBackgroundReview,
  scheduleSubAgentProgressRefresh,
  selectedSubAgentSessionIdRef,
  setSelectedSubAgentSnapshot,
  setSubAgentActivityVersion,
  shouldAutoFollowRef,
}: {
  activeConversationId?: string | null;
  appendConversationLog: AppendConversationLog;
  clearSubAgentProgressFlushTimer: () => void;
  discardPendingAgentRunProgress: (conversationId: string, runId?: string) => void;
  forceNextScrollRef: MutableRefObject<boolean>;
  pendingAgentRunProgressRef: MutableRefObject<Map<string, PendingAgentRunProgressUpdate>>;
  pendingSubAgentProgressRef: MutableRefObject<Map<string, SubAgentSnapshot>>;
  queueAgentRunProgressUpdate: (update: PendingAgentRunProgressUpdate) => void;
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
  scheduleSubAgentProgressRefresh: (snapshot: SubAgentSnapshot) => void;
  selectedSubAgentSessionIdRef: MutableRefObject<string | null>;
  setSelectedSubAgentSnapshot: Dispatch<SetStateAction<SubAgentSnapshot | null>>;
  setSubAgentActivityVersion: Dispatch<SetStateAction<number>>;
  shouldAutoFollowRef: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    return onSubAgentEvent((agent, event) => {
      const registrySnapshots = listActiveSubAgents();
      const resolvedOwnerConversationId = resolveOwningConversationId(
        agent.sessionId,
        registrySnapshots,
      );
      const ownerConversationId =
        resolvedOwnerConversationId && resolvedOwnerConversationId !== agent.sessionId
          ? resolvedOwnerConversationId
          : agent.parentConversationId;
      const state = useChatStore.getState();
      const conversation = state.conversations.find(
        (candidate) => candidate.id === ownerConversationId,
      );
      if (!conversation) {
        return;
      }

      const targetAgentRunId = resolveAgentRunIdForSubAgent(conversation, agent);
      const shouldRefreshLiveSnapshots =
        ownerConversationId === activeConversationId ||
        selectedSubAgentSessionIdRef.current === agent.sessionId;

      if (event === 'progress') {
        const progressDetail = truncateLogDetail(
          agent.currentActivity || agent.activeToolName || 'Worker still running',
        );
        if (progressDetail && targetAgentRunId) {
          queueAgentRunProgressUpdate({
            conversationId: ownerConversationId,
            runId: targetAgentRunId,
            detail: progressDetail,
            timestamp: agent.updatedAt,
          });
        }

        if (shouldRefreshLiveSnapshots) {
          scheduleSubAgentProgressRefresh(agent);
        }
        return;
      }

      discardPendingAgentRunProgress(ownerConversationId, targetAgentRunId);
      const lifecycleMessage = buildSubAgentLifecycleMessage(agent, event);
      const lifecycleSummary = truncateLogDetail(lifecycleMessage);
      const lifecyclePhase = getAgentRunPhaseForSubAgentEvent(event);
      const label = agent.name || agent.sessionId;
      const eventTimestamp = event === 'started' ? agent.startedAt : agent.updatedAt;

      if (targetAgentRunId) {
        const targetRun = conversation.agentRuns?.find((run) => run.id === targetAgentRunId);
        if (targetRun) {
          const nextControlGraph = applySubAgentTerminalControlGraphEffects({
            run: targetRun,
            agent,
            event,
            timestamp: eventTimestamp,
          });
          if (
            nextControlGraph &&
            JSON.stringify(nextControlGraph) !== JSON.stringify(targetRun.controlGraph)
          ) {
            state.updateAgentRunControlGraph(
              ownerConversationId,
              nextControlGraph,
              targetAgentRunId,
            );
          }
        }

        state.setAgentRunPhase(
          ownerConversationId,
          lifecyclePhase,
          {
            status: 'active',
            detail: lifecycleSummary,
            checkpointTitle: getSubAgentCheckpointTitle(event, label),
            checkpointDetail: lifecycleSummary,
            checkpointKind: 'sub-agent',
            timestamp: eventTimestamp,
            allowRegression: lifecyclePhase === 'work',
          },
          targetAgentRunId,
        );
        state.updateAgentRunSummary(
          ownerConversationId,
          {
            latestSummary: lifecycleSummary,
            timestamp: eventTimestamp,
          },
          targetAgentRunId,
        );
      }

      pendingSubAgentProgressRef.current.delete(agent.sessionId);
      if (
        pendingSubAgentProgressRef.current.size === 0 &&
        pendingAgentRunProgressRef.current.size === 0
      ) {
        clearSubAgentProgressFlushTimer();
      }

      if (shouldRefreshLiveSnapshots) {
        if (ownerConversationId === activeConversationId) {
          forceNextScrollRef.current = shouldAutoFollowRef.current;
        }
        setSubAgentActivityVersion((value) => value + 1);
        setSelectedSubAgentSnapshot((current) =>
          current?.sessionId === agent.sessionId ? { ...agent } : current,
        );
      }

      state.addMessage(ownerConversationId, {
        id: generateId(),
        role: 'assistant',
        content: lifecycleMessage,
        attachments: agent.artifacts?.length
          ? agent.artifacts.map((attachment) => ({ ...attachment }))
          : undefined,
        ...(event === 'started' ? {} : { isError: event === 'error' || event === 'cancelled' }),
        subAgentEvent: {
          type: 'sub-agent',
          event,
          snapshot: { ...agent },
        },
      });

      appendConversationLog(ownerConversationId, {
        kind: 'system',
        level: getSubAgentLifecycleLogLevel(event),
        title: getSubAgentLifecycleTitle(event, label),
        detail:
          event === 'started'
            ? `Depth ${agent.depth}, sandbox: ${agent.sandboxPolicy}`
            : lifecycleMessage,
        timestamp: eventTimestamp,
      });

      queueTerminalReviewWhenWorkersSettled({
        conversationId: ownerConversationId,
        runId: targetAgentRunId,
        timestamp: agent.updatedAt,
        queueTerminalBackgroundReview,
      });
    });
  }, [
    activeConversationId,
    appendConversationLog,
    clearSubAgentProgressFlushTimer,
    discardPendingAgentRunProgress,
    forceNextScrollRef,
    pendingAgentRunProgressRef,
    pendingSubAgentProgressRef,
    queueAgentRunProgressUpdate,
    queueTerminalBackgroundReview,
    scheduleSubAgentProgressRefresh,
    selectedSubAgentSessionIdRef,
    setSelectedSubAgentSnapshot,
    setSubAgentActivityVersion,
    shouldAutoFollowRef,
  ]);
}
