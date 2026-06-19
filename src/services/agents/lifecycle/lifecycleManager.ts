import type { Conversation } from '../../../types/conversation';
import type { SubAgentResult, SubAgentSnapshot } from '../../../types/subAgent';
import { cloneAttachments } from '../../../utils/messageAttachments';
import { normalizeFinalizationOutputText } from '../finalizationText';
import {
  applyRecoveredTerminalSnapshot,
  buildRecoveredTerminalSnapshotMap,
  interruptRecoveredRunningAgent,
} from './lifecycleRecovery';
import type { SubAgentLifecycleManagerParams } from './lifecycleManagerTypes';

export function buildResultFromSnapshot(agent: SubAgentSnapshot): SubAgentResult {
  const output = agent.output || '';
  const status = agent.status === 'running' ? 'cancelled' : agent.status;
  return {
    sessionId: agent.sessionId,
    output,
    toolsUsed: agent.toolsUsed ? [...new Set(agent.toolsUsed)] : [],
    iterations: agent.iterations || 0,
    status,
    ...(status === 'error' && output ? { error: output } : {}),
    depth: agent.depth + 1,
    ...(agent.artifacts?.length ? { artifacts: cloneAttachments(agent.artifacts) } : {}),
  };
}

export async function waitForSubAgentResultPromise(
  resultPromise: Promise<SubAgentResult>,
  waitTimeoutMs?: number,
): Promise<SubAgentResult | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise =
    waitTimeoutMs == null
      ? undefined
      : new Promise<null>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(null), waitTimeoutMs);
          (timeoutHandle as any)?.unref?.();
        });

  try {
    return timeoutPromise
      ? await Promise.race([resultPromise, timeoutPromise])
      : await resultPromise;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createSubAgentLifecycleManager<TAgent extends SubAgentSnapshot>(
  params: SubAgentLifecycleManagerParams<TAgent>,
) {
  async function waitForTerminalSubAgentSnapshot(
    sessionId: string,
    waitTimeoutMs?: number,
  ): Promise<SubAgentResult | null> {
    const startedAt = Date.now();

    while (true) {
      const agent = params.activeSubAgents.get(sessionId);
      if (!agent) {
        throw new Error(`session not found: ${sessionId}`);
      }

      if (agent.status !== 'running') {
        return buildResultFromSnapshot(agent);
      }

      if (waitTimeoutMs != null) {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= waitTimeoutMs) {
          return null;
        }

        await new Promise<void>((resolve) => {
          const handle = setTimeout(resolve, Math.max(1, Math.min(250, waitTimeoutMs - elapsedMs)));
          (handle as any)?.unref?.();
        });
        continue;
      }

      await new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, 250);
        (handle as any)?.unref?.();
      });
    }
  }

  function handleUnexpectedBackgroundSubAgentFailure(
    sessionId: string,
    error: unknown,
    announceFailure: boolean,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    params.logger.devWarn('Background worker promise rejected:', errorMessage);

    const agent = params.activeSubAgents.get(sessionId);
    if (!agent || agent.status !== 'running') {
      return;
    }

    const terminalMessage = `Worker failed before a final result could be persisted: ${errorMessage}`;
    const existingOutput = normalizeFinalizationOutputText(agent.output);

    agent.status = 'error';
    agent.launchState = 'terminal';
    agent.output = existingOutput ? `${existingOutput}\n\n[${terminalMessage}]` : terminalMessage;
    agent.currentActivity = params.normalizePreviewText(
      terminalMessage,
      params.maxToolResultPreviewChars,
    );
    agent.activeToolName = undefined;
    agent.activeToolStartedAt = undefined;
    agent.deadlineAt = undefined;
    agent.updatedAt = Date.now();
    params.appendActivity(agent, 'status', terminalMessage);

    params.activeRunControls.delete(sessionId);
    void params.registryPersistenceManager
      .persistRegistryNow()
      .then(() => {
        const latestAgent = params.activeSubAgents.get(sessionId);
        if (latestAgent && latestAgent.status !== 'running') {
          params.sessionContextManager.scheduleSessionContextEviction(sessionId);
        }
      })
      .catch((persistError) => {
        params.logger.devWarn(
          'unexpected background failure persist failed:',
          persistError instanceof Error ? persistError.message : String(persistError),
        );
      });

    if (announceFailure) {
      params.announce(agent, 'error');
    }
  }

  async function waitForSubAgentCompletion(
    sessionId: string,
    waitTimeoutMs?: number,
  ): Promise<SubAgentResult | null> {
    const agent = params.activeSubAgents.get(sessionId);
    if (!agent) {
      throw new Error(`session not found: ${sessionId}`);
    }

    if (agent.status !== 'running') {
      return buildResultFromSnapshot(agent);
    }

    const resultPromise = params.activeResultPromises.get(sessionId);
    if (resultPromise) {
      try {
        return await waitForSubAgentResultPromise(resultPromise, waitTimeoutMs);
      } catch (error: unknown) {
        handleUnexpectedBackgroundSubAgentFailure(sessionId, error, false);
        const latestAgent = params.activeSubAgents.get(sessionId);
        if (latestAgent && latestAgent.status !== 'running') {
          return buildResultFromSnapshot(latestAgent);
        }
        throw error;
      }
    }

    return waitForTerminalSubAgentSnapshot(sessionId, waitTimeoutMs);
  }

  function observeBackgroundSubAgentResult(
    started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
    options?: { announce?: boolean },
  ): void {
    void started.resultPromise.catch((error) => {
      handleUnexpectedBackgroundSubAgentFailure(
        started.sessionId,
        error,
        options?.announce !== false,
      );
    });
  }

  function cancelSubAgent(sessionId: string, reason?: string): TAgent | undefined {
    const agent = params.activeSubAgents.get(sessionId);
    if (!agent) {
      return undefined;
    }

    if (agent.status !== 'running') {
      return params.cloneAgent(agent);
    }

    const normalizedReason =
      params.normalizePreviewText(reason, params.maxToolResultPreviewChars) ||
      'Cancelled by supervisor before completion.';
    const runControl = params.activeRunControls.get(sessionId);

    params.updateAgentProgress(
      agent,
      {
        currentActivity: normalizedReason,
        modelResponsePendingSince: undefined,
      },
      {
        activityKind: 'status',
        activityText: normalizedReason,
      },
    );

    if (runControl) {
      runControl.abortReason = 'cancelled';
      runControl.cancelReason = normalizedReason;
      runControl.abortController.abort();
    } else {
      params.clearQueuedLaunchWatch(sessionId);
      agent.status = 'cancelled';
      agent.launchState = 'terminal';
      agent.output = normalizedReason;
      agent.modelResponsePendingSince = undefined;
      agent.currentActivity = normalizedReason;
      agent.activeToolName = undefined;
      agent.activeToolStartedAt = undefined;
      agent.updatedAt = Date.now();
      params.appendActivity(agent, 'status', normalizedReason);
      params.registryPersistenceManager.scheduleRegistryPersist();
      params.resolveScheduledLaunchWithSnapshot(sessionId);
      params.announce(agent, 'cancelled');
    }

    return params.cloneAgent(agent);
  }

  function cleanupSubAgents(): void {
    const now = Date.now();
    let didRemove = false;

    for (const [id, agent] of params.activeSubAgents) {
      if (
        agent.status !== 'running' &&
        now - agent.updatedAt > params.terminalSubAgentRetentionMs
      ) {
        params.clearScheduledProgressAnnouncement(id);
        params.clearQueuedLaunchWatch(id);
        params.activeSubAgents.delete(id);
        params.sessionContextManager.deleteSessionContext(id);
        didRemove = true;
      }
    }

    if (didRemove) {
      params.registryPersistenceManager.scheduleRegistryPersist();
    }
  }

  async function detectOrphans(conversations?: Conversation[]): Promise<number> {
    await params.registryPersistenceManager.loadRegistry();
    let orphanCount = 0;
    let restoredTerminalCount = 0;
    const now = Date.now();
    const recoveredTerminalSnapshots = buildRecoveredTerminalSnapshotMap(conversations);

    for (const [, agent] of params.activeSubAgents) {
      const recoveredSnapshot = recoveredTerminalSnapshots.get(agent.sessionId);
      if (recoveredSnapshot) {
        const shouldAdoptRecoveredSnapshot =
          agent.status !== recoveredSnapshot.status ||
          agent.updatedAt < recoveredSnapshot.updatedAt ||
          (!agent.output && !!recoveredSnapshot.output) ||
          (agent.toolsUsed?.length ?? 0) < (recoveredSnapshot.toolsUsed?.length ?? 0) ||
          (agent.activityLog?.length ?? 0) < (recoveredSnapshot.activityLog?.length ?? 0);

        if (shouldAdoptRecoveredSnapshot) {
          applyRecoveredTerminalSnapshot(agent, recoveredSnapshot);
          restoredTerminalCount += 1;
        }
        continue;
      }

      if (agent.status === 'running') {
        interruptRecoveredRunningAgent(agent, now, params.appendActivity);
        orphanCount++;
      }
    }

    if (restoredTerminalCount > 0 || orphanCount > 0) {
      await params.registryPersistenceManager.persistRegistryNow();
    }
    return orphanCount;
  }

  async function initSubAgentRegistry(conversations?: Conversation[]): Promise<void> {
    await detectOrphans(conversations);
    cleanupSubAgents();
  }

  return {
    cancelSubAgent,
    cleanupSubAgents,
    detectOrphans,
    initSubAgentRegistry,
    observeBackgroundSubAgentResult,
    waitForSubAgentCompletion,
  };
}
