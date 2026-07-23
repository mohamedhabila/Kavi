import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityFeedView } from '../components/activity/ActivityFeedView';
import { appForegroundRequestRegistry } from '../engine/graph/foregroundRun/requestRegistry';
import {
  buildActivityFeed,
  getActivityRunKey,
  type ActivityFilter,
  type ActivityItem,
} from '../services/activity/activityFeed';
import { onSubAgentEvent, listActiveSubAgents } from '../services/agents/subAgent';
import { getSubAgentsForAgentRun } from '../services/agents/lifecycle/stateMachine';
import { useApprovalStore } from '../services/remote/approvalStore';
import { useSchedulerStore } from '../services/scheduler/store';
import { useExecutionTraceStore } from '../services/scheduler/traceStore';
import { useChatStore } from '../store/useChatStore';

export const ActivityScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const conversations = useChatStore((state) => state.conversations);
  const setActiveConversation = useChatStore((state) => state.setActiveConversation);
  const approvalRequestsById = useApprovalStore((state) => state.requests);
  const schedulerJobs = useSchedulerStore((state) => state.jobs);
  const schedulerReports = useSchedulerStore((state) => state.terminalReports);
  const schedulerTraces = useExecutionTraceStore((state) => state.traces);
  const foregroundSnapshot = useSyncExternalStore(
    appForegroundRequestRegistry.subscribe,
    appForegroundRequestRegistry.getSnapshot,
    appForegroundRequestRegistry.getSnapshot,
  );
  const [filter, setFilter] = useState<ActivityFilter>('pending');
  const [subAgents, setSubAgents] = useState(listActiveSubAgents);

  useEffect(
    () =>
      onSubAgentEvent(() => {
        setSubAgents(listActiveSubAgents());
      }),
    [],
  );

  const approvalRequests = useMemo(
    () => Object.values(approvalRequestsById),
    [approvalRequestsById],
  );
  const liveWorkerRunKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const conversation of conversations) {
      for (const run of conversation.agentRuns ?? []) {
        if (
          getSubAgentsForAgentRun(conversation, run.id, subAgents).some(
            (snapshot) => snapshot.status === 'running',
          )
        ) {
          keys.add(getActivityRunKey(conversation.id, run.id));
        }
      }
    }
    return keys;
  }, [conversations, subAgents]);
  const items = useMemo(
    () =>
      buildActivityFeed({
        approvalRequests,
        conversations,
        foregroundConversationIds: foregroundSnapshot.activeConversationIds,
        liveWorkerRunKeys,
        schedulerJobs,
        schedulerReports,
        schedulerTraces,
      }),
    [
      approvalRequests,
      conversations,
      foregroundSnapshot.activeConversationIds,
      liveWorkerRunKeys,
      schedulerJobs,
      schedulerReports,
      schedulerTraces,
    ],
  );

  const openConversation = useCallback(
    (conversationId: string) => {
      if (!conversations.some((conversation) => conversation.id === conversationId)) return;
      setActiveConversation(conversationId);
      navigation.navigate('Chat');
    },
    [conversations, navigation, setActiveConversation],
  );

  const handleOpenItem = useCallback(
    (item: ActivityItem) => {
      if (item.kind === 'approval') {
        navigation.navigate('ApprovalHistory', {
          initialRequestId: item.approvalId,
          returnTo: { name: 'Activity' },
        });
        return;
      }
      if (item.kind === 'automation' || item.kind === 'automation-result') {
        navigation.navigate('Scheduler', {
          initialJobId: item.automationId,
          returnTo: { name: 'Activity' },
        });
        return;
      }
      if (item.sourceConversationId) {
        openConversation(item.sourceConversationId);
      }
    },
    [navigation, openConversation],
  );

  const handleOpenArtifact = useCallback(
    (item: ActivityItem, path: string) => {
      if (!item.sourceConversationId) return;
      navigation.navigate('ConversationFiles', {
        conversationId: item.sourceConversationId,
        initialFilePath: path,
        returnTo: { name: 'Activity' },
      });
    },
    [navigation],
  );

  return (
    <ActivityFeedView
      filter={filter}
      items={items}
      onFilterChange={setFilter}
      onOpenAdvanced={() =>
        navigation.navigate('AgentRoster', {
          initialTab: 'queue',
          returnTo: { name: 'Activity' },
        })
      }
      onOpenArtifact={handleOpenArtifact}
      onOpenAssistant={() => navigation.navigate('Chat')}
      onOpenAutomations={() => navigation.navigate('Scheduler', { returnTo: { name: 'Activity' } })}
      onOpenItem={handleOpenItem}
    />
  );
};
