import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useChatStore } from '../store/useChatStore';
import { SUB_AGENT_PROGRESS_REFRESH_INTERVAL_MS } from './chatScreenConstants';
import {
  PendingAgentRunProgressUpdate,
  SubAgentSnapshot,
} from './subAgentRunBridgeTypes';

function buildAgentRunProgressKey(conversationId: string, runId: string): string {
  return `${conversationId}:${runId}`;
}

export function useSubAgentProgressBuffer({
  selectedSubAgentSessionIdRef,
  setSelectedSubAgentSnapshot,
  setSubAgentActivityVersion,
}: {
  selectedSubAgentSessionIdRef: MutableRefObject<string | null>;
  setSelectedSubAgentSnapshot: Dispatch<SetStateAction<SubAgentSnapshot | null>>;
  setSubAgentActivityVersion: Dispatch<SetStateAction<number>>;
}): {
  clearSubAgentProgressFlushTimer: () => void;
  discardPendingAgentRunProgress: (conversationId: string, runId?: string) => void;
  pendingAgentRunProgressRef: MutableRefObject<Map<string, PendingAgentRunProgressUpdate>>;
  pendingSubAgentProgressRef: MutableRefObject<Map<string, SubAgentSnapshot>>;
  queueAgentRunProgressUpdate: (update: PendingAgentRunProgressUpdate) => void;
  scheduleSubAgentProgressRefresh: (snapshot: SubAgentSnapshot) => void;
} {
  const pendingSubAgentProgressRef = useRef(new Map<string, SubAgentSnapshot>());
  const pendingAgentRunProgressRef = useRef(new Map<string, PendingAgentRunProgressUpdate>());
  const subAgentProgressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSubAgentProgressFlushTimer = useCallback(() => {
    if (!subAgentProgressFlushTimerRef.current) {
      return;
    }

    clearTimeout(subAgentProgressFlushTimerRef.current);
    subAgentProgressFlushTimerRef.current = null;
  }, []);

  const flushPendingSubAgentProgress = useCallback(() => {
    clearSubAgentProgressFlushTimer();

    const pendingSnapshots = pendingSubAgentProgressRef.current;
    const pendingRunProgress = pendingAgentRunProgressRef.current;
    const hadSnapshotUpdates = pendingSnapshots.size > 0;
    if (pendingSnapshots.size === 0 && pendingRunProgress.size === 0) {
      return;
    }

    const selectedSnapshot =
      hadSnapshotUpdates && selectedSubAgentSessionIdRef.current
        ? pendingSnapshots.get(selectedSubAgentSessionIdRef.current)
        : undefined;
    const runProgressUpdates = Array.from(pendingRunProgress.values());
    pendingSnapshots.clear();
    pendingRunProgress.clear();

    const { setAgentRunPhase, updateAgentRunSummary } = useChatStore.getState();
    for (const update of runProgressUpdates) {
      setAgentRunPhase(
        update.conversationId,
        'work',
        {
          status: 'active',
          detail: update.detail,
          timestamp: update.timestamp,
          allowRegression: true,
        },
        update.runId,
      );
      updateAgentRunSummary(
        update.conversationId,
        {
          latestSummary: update.detail,
          timestamp: update.timestamp,
        },
        update.runId,
      );
    }

    if (selectedSnapshot) {
      setSubAgentActivityVersion((value) => value + 1);
      setSelectedSubAgentSnapshot({ ...selectedSnapshot });
    } else if (hadSnapshotUpdates) {
      setSubAgentActivityVersion((value) => value + 1);
    }
  }, [
    clearSubAgentProgressFlushTimer,
    selectedSubAgentSessionIdRef,
    setSelectedSubAgentSnapshot,
    setSubAgentActivityVersion,
  ]);

  const scheduleSubAgentProgressFlush = useCallback(() => {
    if (subAgentProgressFlushTimerRef.current) {
      return;
    }

    subAgentProgressFlushTimerRef.current = setTimeout(() => {
      flushPendingSubAgentProgress();
    }, SUB_AGENT_PROGRESS_REFRESH_INTERVAL_MS);
    (subAgentProgressFlushTimerRef.current as any)?.unref?.();
  }, [flushPendingSubAgentProgress]);

  const queueAgentRunProgressUpdate = useCallback(
    (update: PendingAgentRunProgressUpdate) => {
      const key = buildAgentRunProgressKey(update.conversationId, update.runId);
      const existing = pendingAgentRunProgressRef.current.get(key);
      if (existing && existing.detail === update.detail) {
        return;
      }

      pendingAgentRunProgressRef.current.set(key, update);
      scheduleSubAgentProgressFlush();
    },
    [scheduleSubAgentProgressFlush],
  );

  const discardPendingAgentRunProgress = useCallback((conversationId: string, runId?: string) => {
    if (!runId) {
      return;
    }

    pendingAgentRunProgressRef.current.delete(buildAgentRunProgressKey(conversationId, runId));
  }, []);

  const scheduleSubAgentProgressRefresh = useCallback(
    (snapshot: SubAgentSnapshot) => {
      pendingSubAgentProgressRef.current.set(snapshot.sessionId, { ...snapshot });
      scheduleSubAgentProgressFlush();
    },
    [scheduleSubAgentProgressFlush],
  );

  useEffect(
    () => () => {
      clearSubAgentProgressFlushTimer();
      pendingSubAgentProgressRef.current.clear();
      pendingAgentRunProgressRef.current.clear();
    },
    [clearSubAgentProgressFlushTimer, pendingAgentRunProgressRef, pendingSubAgentProgressRef],
  );

  return {
    clearSubAgentProgressFlushTimer,
    discardPendingAgentRunProgress,
    pendingAgentRunProgressRef,
    pendingSubAgentProgressRef,
    queueAgentRunProgressUpdate,
    scheduleSubAgentProgressRefresh,
  };
}
