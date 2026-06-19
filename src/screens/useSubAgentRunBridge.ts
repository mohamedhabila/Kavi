import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useChatStore } from '../store/useChatStore';
import { listActiveSubAgents } from '../services/agents/subAgent';
import { getSubAgentsForConversation } from '../services/agents/lifecycle/stateMachine';
import { truncateLogDetail } from './chatFormatting';
import { useSubAgentEventBridge } from './useSubAgentEventBridge';
import { useSubAgentProgressBuffer } from './useSubAgentProgressBuffer';
import { QueueTerminalBackgroundReview, SubAgentSnapshot } from './subAgentRunBridgeTypes';

export function useSubAgentRunBridge({
  activeConversationId,
  forceNextScrollRef,
  queueTerminalBackgroundReview,
  shouldAutoFollowRef,
}: {
  activeConversationId?: string | null;
  forceNextScrollRef: MutableRefObject<boolean>;
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
  shouldAutoFollowRef: MutableRefObject<boolean>;
}): {
  liveSubAgentSnapshotsById: Map<string, SubAgentSnapshot>;
  resetSubAgentRunBridge: () => void;
  selectedSubAgentSnapshot: SubAgentSnapshot | null;
  setSelectedSubAgentSnapshot: Dispatch<SetStateAction<SubAgentSnapshot | null>>;
  subAgentActivityVersion: number;
} {
  const [selectedSubAgentSnapshot, setSelectedSubAgentSnapshot] = useState<SubAgentSnapshot | null>(
    null,
  );
  const [subAgentActivityVersion, setSubAgentActivityVersion] = useState(0);
  const selectedSubAgentSessionIdRef = useRef<string | null>(null);

  const appendConversationLog = useCallback(
    (
      conversationId: string,
      entry: Parameters<ReturnType<typeof useChatStore.getState>['addConversationLog']>[1],
    ) => {
      useChatStore.getState().addConversationLog(conversationId, {
        ...entry,
        detail: truncateLogDetail(entry.detail),
      });
    },
    [],
  );

  const {
    clearSubAgentProgressFlushTimer,
    discardPendingAgentRunProgress,
    pendingAgentRunProgressRef,
    pendingSubAgentProgressRef,
    queueAgentRunProgressUpdate,
    scheduleSubAgentProgressRefresh,
  } = useSubAgentProgressBuffer({
    selectedSubAgentSessionIdRef,
    setSelectedSubAgentSnapshot,
    setSubAgentActivityVersion,
  });

  const resetSubAgentRunBridge = useCallback(() => {
    setSelectedSubAgentSnapshot(null);
    selectedSubAgentSessionIdRef.current = null;
    pendingSubAgentProgressRef.current.clear();
    pendingAgentRunProgressRef.current.clear();
    clearSubAgentProgressFlushTimer();
    setSubAgentActivityVersion(0);
  }, [clearSubAgentProgressFlushTimer, pendingAgentRunProgressRef, pendingSubAgentProgressRef]);

  useEffect(() => {
    selectedSubAgentSessionIdRef.current = selectedSubAgentSnapshot?.sessionId ?? null;
  }, [selectedSubAgentSnapshot]);

  useSubAgentEventBridge({
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
  });

  const liveSubAgentSnapshotState = useMemo(() => {
    const snapshots: SubAgentSnapshot[] = activeConversationId
      ? getSubAgentsForConversation(activeConversationId, listActiveSubAgents())
      : [];

    return {
      activityVersion: subAgentActivityVersion,
      snapshots,
    };
  }, [activeConversationId, subAgentActivityVersion]);

  const liveSubAgentSnapshotsById = useMemo(() => {
    return new Map(
      liveSubAgentSnapshotState.snapshots.map((snapshot) => [snapshot.sessionId, snapshot]),
    );
  }, [liveSubAgentSnapshotState]);

  return {
    liveSubAgentSnapshotsById,
    resetSubAgentRunBridge,
    selectedSubAgentSnapshot,
    setSelectedSubAgentSnapshot,
    subAgentActivityVersion,
  };
}
