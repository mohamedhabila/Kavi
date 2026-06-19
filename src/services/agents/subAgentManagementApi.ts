import type { Conversation } from '../../types/conversation';
import type { SubAgentResult } from '../../types/subAgent';
import { throttledAsyncStorage } from '../../store/throttledStorage';
import type {
  ScheduledSubAgentLaunchControl,
  SubAgentAnnounceEvent,
} from './subAgentRuntimeSignals';

export function createSubAgentManagementApi<
  TAgent extends { sessionId: string; parentConversationId?: string },
  TSessionContext,
>(params: {
  activeSubAgents: Map<string, TAgent>;
  activeRunControls: Map<string, unknown>;
  activeResultPromises: Map<string, Promise<SubAgentResult>>;
  scheduledSubAgentLaunches: Map<string, ScheduledSubAgentLaunchControl>;
  registryKey: string;
  registryContextsKey: string;
  runtimeSignals: {
    onSubAgentEvent: (
      listener: (agent: TAgent, event: SubAgentAnnounceEvent) => void,
    ) => () => void;
    clearTransientState: () => void;
  };
  lifecycle: {
    waitForSubAgentCompletion: (
      sessionId: string,
      waitTimeoutMs?: number,
    ) => Promise<SubAgentResult | null>;
    observeBackgroundSubAgentResult: (
      started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
      options?: { announce?: boolean },
    ) => void;
    cancelSubAgent: (sessionId: string, reason?: string) => TAgent | undefined;
    cleanupSubAgents: () => void;
    detectOrphans: (conversations?: Conversation[]) => Promise<number>;
    initSubAgentRegistry: (conversations?: Conversation[]) => Promise<void>;
  };
  sessionContextManager: {
    getSessionContext: (sessionId: string) => TSessionContext | undefined;
    reset: () => void;
  };
  registryPersistenceManager: {
    reset: () => void;
  };
}) {
  function onSubAgentEvent(
    listener: (agent: TAgent, event: SubAgentAnnounceEvent) => void,
  ): () => void {
    return params.runtimeSignals.onSubAgentEvent(listener);
  }

  function waitForSubAgentCompletion(
    sessionId: string,
    waitTimeoutMs?: number,
  ): Promise<SubAgentResult | null> {
    return params.lifecycle.waitForSubAgentCompletion(sessionId, waitTimeoutMs);
  }

  function observeBackgroundSubAgentResult(
    started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
    options?: { announce?: boolean },
  ): void {
    params.lifecycle.observeBackgroundSubAgentResult(started, options);
  }

  function cancelSubAgent(sessionId: string, reason?: string): TAgent | undefined {
    return params.lifecycle.cancelSubAgent(sessionId, reason);
  }

  function listActiveSubAgents(): TAgent[] {
    return Array.from(params.activeSubAgents.values());
  }

  function getSubAgent(sessionId: string): TAgent | undefined {
    return params.activeSubAgents.get(sessionId);
  }

  function getSessionContext(sessionId: string): TSessionContext | undefined {
    return params.sessionContextManager.getSessionContext(sessionId);
  }

  function getSubAgentsByParent(parentConversationId: string): TAgent[] {
    return Array.from(params.activeSubAgents.values()).filter(
      (agent) => agent.parentConversationId === parentConversationId,
    );
  }

  function cleanupSubAgents(): void {
    params.lifecycle.cleanupSubAgents();
  }

  function detectOrphans(conversations?: Conversation[]): Promise<number> {
    return params.lifecycle.detectOrphans(conversations);
  }

  async function initSubAgentRegistry(conversations?: Conversation[]): Promise<void> {
    await params.lifecycle.initSubAgentRegistry(conversations);
  }

  async function resetSubAgentStateForTests(): Promise<void> {
    params.registryPersistenceManager.reset();
    params.runtimeSignals.clearTransientState();

    for (const scheduledLaunch of Array.from(params.scheduledSubAgentLaunches.values())) {
      clearTimeout(scheduledLaunch.handle);
    }

    params.sessionContextManager.reset();
    params.activeSubAgents.clear();
    params.activeRunControls.clear();
    params.activeResultPromises.clear();
    params.scheduledSubAgentLaunches.clear();
    await Promise.all([
      throttledAsyncStorage.removeItem(params.registryKey),
      throttledAsyncStorage.removeItem(params.registryContextsKey),
    ]);
  }

  return {
    onSubAgentEvent,
    waitForSubAgentCompletion,
    observeBackgroundSubAgentResult,
    cancelSubAgent,
    listActiveSubAgents,
    getSubAgent,
    getSessionContext,
    getSubAgentsByParent,
    cleanupSubAgents,
    detectOrphans,
    initSubAgentRegistry,
    resetSubAgentStateForTests,
  };
}
