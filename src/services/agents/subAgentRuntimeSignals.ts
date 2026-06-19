import type { SubAgentActivityEntry, SubAgentResult, SubAgentSnapshot } from '../../types/subAgent';

export type SubAgentAnnounceEvent =
  | 'started'
  | 'completed'
  | 'timeout'
  | 'error'
  | 'cancelled'
  | 'progress';

export type ScheduledSubAgentLaunchControl = {
  handle: ReturnType<typeof setTimeout>;
  resolve: (result: SubAgentResult) => void;
  reject: (error: unknown) => void;
};

type QueuedLaunchWatch = {
  warningHandle?: ReturnType<typeof setTimeout>;
  timeoutHandle?: ReturnType<typeof setTimeout>;
};

type UpdateAgentProgressFn<TAgent extends SubAgentSnapshot> = (
  agent: TAgent,
  changes: Partial<
    Pick<
      TAgent,
      | 'currentActivity'
      | 'activeToolName'
      | 'activeToolStartedAt'
      | 'lastToolResultPreview'
      | 'launchState'
      | 'modelResponsePendingSince'
      | 'taskLedger'
    >
  >,
  options?: {
    activityKind?: SubAgentActivityEntry['kind'];
    activityText?: string;
    announce?: boolean;
    markProgress?: boolean;
  },
) => void;

type RuntimeSignalsManagerParams<TAgent extends SubAgentSnapshot> = {
  activeSubAgents: Map<string, TAgent>;
  scheduledSubAgentLaunches: Map<string, ScheduledSubAgentLaunchControl>;
  cloneAgent: (agent: TAgent) => TAgent;
  buildResultFromSnapshot: (agent: TAgent) => SubAgentResult;
  updateAgentProgress: UpdateAgentProgressFn<TAgent>;
  appendActivity: (
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ) => void;
  normalizePreviewText: (value: string | undefined, maxLength?: number) => string | undefined;
  scheduleRegistryPersist: () => void;
  maxToolResultPreviewChars: number;
  queuedLaunchWarningMs: number;
  queuedLaunchTimeoutMs: number;
  progressAnnounceIntervalMs: number;
};

export function createSubAgentRuntimeSignalsManager<TAgent extends SubAgentSnapshot>(
  params: RuntimeSignalsManagerParams<TAgent>,
) {
  const queuedLaunchWatches = new Map<string, QueuedLaunchWatch>();
  const announceListeners = new Set<(agent: TAgent, event: SubAgentAnnounceEvent) => void>();
  const scheduledProgressAnnouncements = new Map<string, ReturnType<typeof setTimeout>>();

  function clearQueuedLaunchWatch(sessionId: string): void {
    const watch = queuedLaunchWatches.get(sessionId);
    if (!watch) {
      return;
    }

    if (watch.warningHandle) {
      clearTimeout(watch.warningHandle);
    }
    if (watch.timeoutHandle) {
      clearTimeout(watch.timeoutHandle);
    }

    queuedLaunchWatches.delete(sessionId);
  }

  function clearScheduledProgressAnnouncement(sessionId: string): void {
    const timer = scheduledProgressAnnouncements.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    scheduledProgressAnnouncements.delete(sessionId);
  }

  function announce(agent: TAgent, event: SubAgentAnnounceEvent): void {
    if (event !== 'progress') {
      clearScheduledProgressAnnouncement(agent.sessionId);
    }

    const snapshot = params.cloneAgent(agent);
    for (const listener of announceListeners) {
      try {
        listener(snapshot, event);
      } catch {
        /* swallow listener errors */
      }
    }
  }

  function scheduleProgressAnnouncement(agent: TAgent): void {
    if (announceListeners.size === 0 || scheduledProgressAnnouncements.has(agent.sessionId)) {
      return;
    }

    const timer = setTimeout(() => {
      scheduledProgressAnnouncements.delete(agent.sessionId);
      const latestSnapshot = params.activeSubAgents.get(agent.sessionId);
      if (!latestSnapshot || latestSnapshot.status !== 'running') {
        return;
      }

      announce(latestSnapshot, 'progress');
    }, params.progressAnnounceIntervalMs);
    (timer as any)?.unref?.();
    scheduledProgressAnnouncements.set(agent.sessionId, timer);
  }

  function resolveScheduledLaunchWithSnapshot(sessionId: string): boolean {
    const scheduledLaunch = params.scheduledSubAgentLaunches.get(sessionId);
    const agent = params.activeSubAgents.get(sessionId);
    if (!scheduledLaunch || !agent) {
      return false;
    }

    clearTimeout(scheduledLaunch.handle);
    params.scheduledSubAgentLaunches.delete(sessionId);
    scheduledLaunch.resolve(params.buildResultFromSnapshot(agent));
    return true;
  }

  function failQueuedLaunch(sessionId: string, message: string, announceFailure: boolean): void {
    const agent = params.activeSubAgents.get(sessionId);
    if (!agent || agent.status !== 'running' || agent.launchState !== 'queued') {
      return;
    }

    clearQueuedLaunchWatch(sessionId);

    agent.status = 'error';
    agent.launchState = 'terminal';
    agent.output = message;
    agent.currentActivity = params.normalizePreviewText(message, params.maxToolResultPreviewChars);
    agent.activeToolName = undefined;
    agent.activeToolStartedAt = undefined;
    agent.deadlineAt = undefined;
    agent.updatedAt = Date.now();
    params.appendActivity(agent, 'status', message);

    params.scheduleRegistryPersist();
    resolveScheduledLaunchWithSnapshot(sessionId);

    if (announceFailure) {
      announce(agent, 'error');
    }
  }

  function scheduleQueuedLaunchWatch(agent: TAgent, announceFailure: boolean): void {
    clearQueuedLaunchWatch(agent.sessionId);

    const warningHandle = setTimeout(() => {
      const latestAgent = params.activeSubAgents.get(agent.sessionId);
      if (
        !latestAgent ||
        latestAgent.status !== 'running' ||
        latestAgent.launchState !== 'queued'
      ) {
        return;
      }

      params.updateAgentProgress(
        latestAgent,
        {
          currentActivity: 'Still starting worker runtime',
          launchState: 'queued',
        },
        {
          activityKind: 'status',
          activityText: 'Still starting worker runtime',
          markProgress: false,
        },
      );
    }, params.queuedLaunchWarningMs);
    (warningHandle as any)?.unref?.();

    const timeoutHandle = setTimeout(() => {
      failQueuedLaunch(
        agent.sessionId,
        'Worker launch stalled before bootstrapping. Retry the worker or inspect runtime persistence health.',
        announceFailure,
      );
    }, params.queuedLaunchTimeoutMs);
    (timeoutHandle as any)?.unref?.();

    queuedLaunchWatches.set(agent.sessionId, {
      warningHandle,
      timeoutHandle,
    });
  }

  function onSubAgentEvent(
    listener: (agent: TAgent, event: SubAgentAnnounceEvent) => void,
  ): () => void {
    announceListeners.add(listener);
    return () => {
      announceListeners.delete(listener);
    };
  }

  function clearTransientState(): void {
    for (const sessionId of Array.from(scheduledProgressAnnouncements.keys())) {
      clearScheduledProgressAnnouncement(sessionId);
    }

    for (const sessionId of Array.from(queuedLaunchWatches.keys())) {
      clearQueuedLaunchWatch(sessionId);
    }
  }

  return {
    announce,
    clearQueuedLaunchWatch,
    clearScheduledProgressAnnouncement,
    clearTransientState,
    onSubAgentEvent,
    resolveScheduledLaunchWithSnapshot,
    scheduleProgressAnnouncement,
    scheduleQueuedLaunchWatch,
  };
}
