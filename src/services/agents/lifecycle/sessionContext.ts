import type { LlmProviderConfig } from '../../../types/provider';
import type { Message } from '../../../types/message';
import type { SubAgentConfig } from '../../../types/subAgent';
import { buildStoredSessionMessages, sanitizeTranscriptMessage } from './sessionContextMessages';
import { cloneProviderConfig, cloneSessionContext } from './sessionContextClone';

export interface SubAgentSessionContext {
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  conversationSummary: string;
  messages: Message[];
}

export interface SessionContextStoreParams {
  sessionId: string;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  conversationSummary: string;
  messages: Message[];
}

export type PersistRegistryBestEffortOutcome =
  | { status: 'persisted' }
  | { status: 'timed-out'; completion: Promise<boolean> }
  | { status: 'failed' };

type SessionContextAgentSnapshot = {
  status: string;
  updatedAt: number;
};

type SessionContextManagerOptions = {
  activeAgents: ReadonlyMap<string, SessionContextAgentSnapshot>;
  maxSessionContexts: number;
  evictionGraceMs: number;
  checkpointDebounceMs: number;
  finalizationMessageCharLimit: number;
  finalizationToolContentCharLimit: number;
  sessionContextMaxMessages: number;
  sessionContextMessageCharLimit: number;
  sessionContextToolContentCharLimit: number;
  cloneConfig: (config: SubAgentConfig) => SubAgentConfig;
  scheduleRegistryPersist: () => void;
};

export function createSubAgentSessionContextManager(options: SessionContextManagerOptions) {
  const sessionContexts = new Map<string, SubAgentSessionContext>();
  const sessionContextEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingSessionContextCheckpoints = new Map<string, SessionContextStoreParams>();
  const scheduledSessionContextCheckpoints = new Map<string, ReturnType<typeof setTimeout>>();

  function clearSessionContextEviction(sessionId: string): void {
    const timer = sessionContextEvictionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      sessionContextEvictionTimers.delete(sessionId);
    }
  }

  function scheduleSessionContextEviction(sessionId: string): void {
    clearSessionContextEviction(sessionId);
    const timer = setTimeout(() => {
      sessionContextEvictionTimers.delete(sessionId);
      sessionContexts.delete(sessionId);
    }, options.evictionGraceMs);
    (timer as any)?.unref?.();
    sessionContextEvictionTimers.set(sessionId, timer);
  }

  function scheduleSessionContextEvictionWhenDurable(
    sessionId: string,
    persistOutcome: PersistRegistryBestEffortOutcome,
  ): void {
    if (persistOutcome.status === 'persisted') {
      scheduleSessionContextEviction(sessionId);
      return;
    }

    if (persistOutcome.status === 'failed') {
      return;
    }

    void persistOutcome.completion.then((persisted) => {
      if (persisted) {
        scheduleSessionContextEviction(sessionId);
      }
    });
  }

  function enforceSessionContextLimit(): void {
    if (sessionContexts.size <= options.maxSessionContexts) {
      return;
    }

    const evictableSessions = Array.from(sessionContexts.keys())
      .filter((sessionId) => {
        const agent = options.activeAgents.get(sessionId);
        return agent?.status !== 'running' && !sessionContextEvictionTimers.has(sessionId);
      })
      .sort((left, right) => {
        const leftUpdatedAt = options.activeAgents.get(left)?.updatedAt ?? 0;
        const rightUpdatedAt = options.activeAgents.get(right)?.updatedAt ?? 0;
        return leftUpdatedAt - rightUpdatedAt;
      });

    const requiredEvictions = sessionContexts.size - options.maxSessionContexts;
    for (let index = 0; index < requiredEvictions && index < evictableSessions.length; index += 1) {
      clearSessionContextEviction(evictableSessions[index]);
      sessionContexts.delete(evictableSessions[index]);
    }
  }

  function storeSessionContext(params: SessionContextStoreParams): void {
    clearSessionContextEviction(params.sessionId);

    sessionContexts.set(params.sessionId, {
      config: options.cloneConfig(params.config),
      provider: cloneProviderConfig(params.provider),
      ...(params.allProviders
        ? { allProviders: params.allProviders.map((entry) => cloneProviderConfig(entry)) }
        : {}),
      systemPrompt: params.systemPrompt,
      conversationSummary: params.conversationSummary,
      messages: buildStoredSessionMessages(params.messages, params.conversationSummary, options),
    });

    enforceSessionContextLimit();
  }

  function clearScheduledSessionContextCheckpoint(sessionId: string): void {
    const timer = scheduledSessionContextCheckpoints.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    scheduledSessionContextCheckpoints.delete(sessionId);
  }

  function clearPendingSessionContextCheckpoint(sessionId: string): void {
    clearScheduledSessionContextCheckpoint(sessionId);
    pendingSessionContextCheckpoints.delete(sessionId);
  }

  function flushSessionContextCheckpoint(sessionId: string): void {
    clearScheduledSessionContextCheckpoint(sessionId);
    const params = pendingSessionContextCheckpoints.get(sessionId);
    if (!params) {
      return;
    }

    pendingSessionContextCheckpoints.delete(sessionId);
    if (!options.activeAgents.has(sessionId)) {
      return;
    }

    storeSessionContext(params);
    options.scheduleRegistryPersist();
  }

  function scheduleSessionContextCheckpoint(
    params: SessionContextStoreParams,
    scheduleOptions?: { immediate?: boolean },
  ): void {
    clearSessionContextEviction(params.sessionId);
    pendingSessionContextCheckpoints.set(params.sessionId, params);

    if (scheduleOptions?.immediate) {
      flushSessionContextCheckpoint(params.sessionId);
      return;
    }

    if (scheduledSessionContextCheckpoints.has(params.sessionId)) {
      return;
    }

    const timer = setTimeout(() => {
      flushSessionContextCheckpoint(params.sessionId);
    }, options.checkpointDebounceMs);
    (timer as any)?.unref?.();
    scheduledSessionContextCheckpoints.set(params.sessionId, timer);
  }

  function getSessionContext(sessionId: string): SubAgentSessionContext | undefined {
    flushSessionContextCheckpoint(sessionId);
    const context = sessionContexts.get(sessionId);
    return context ? cloneSessionContext(context, options.cloneConfig) : undefined;
  }

  function deleteSessionContext(sessionId: string): void {
    clearPendingSessionContextCheckpoint(sessionId);
    clearSessionContextEviction(sessionId);
    sessionContexts.delete(sessionId);
  }

  function serializeActiveContexts(): Record<string, SubAgentSessionContext> {
    return Object.fromEntries(
      Array.from(sessionContexts.entries())
        .filter(([sessionId]) => options.activeAgents.has(sessionId))
        .map(([sessionId, context]) => [
          sessionId,
          cloneSessionContext(context, options.cloneConfig, { redactProviderSecrets: true }),
        ]),
    );
  }

  function loadPersistedContexts(
    parsed: Record<string, SubAgentSessionContext>,
    loadedSessionIds: ReadonlySet<string>,
  ): void {
    for (const [sessionId, context] of Object.entries(parsed)) {
      if (!loadedSessionIds.has(sessionId) || !context || typeof context !== 'object') {
        continue;
      }

      try {
        sessionContexts.set(
          sessionId,
          cloneSessionContext(context, options.cloneConfig, { redactProviderSecrets: true }),
        );
      } catch {
        // Ignore only malformed entries so valid siblings still load.
      }
    }
  }

  function reset(): void {
    for (const sessionId of Array.from(sessionContextEvictionTimers.keys())) {
      clearSessionContextEviction(sessionId);
    }

    for (const sessionId of Array.from(scheduledSessionContextCheckpoints.keys())) {
      clearScheduledSessionContextCheckpoint(sessionId);
    }

    pendingSessionContextCheckpoints.clear();
    sessionContexts.clear();
  }

  return {
    clearPendingSessionContextCheckpoint,
    clearSessionContextEviction,
    deleteSessionContext,
    getSessionContext,
    loadPersistedContexts,
    reset,
    sanitizeTranscriptMessage: (message: Message) => sanitizeTranscriptMessage(message, options),
    scheduleSessionContextCheckpoint,
    scheduleSessionContextEviction,
    scheduleSessionContextEvictionWhenDurable,
    serializeActiveContexts,
    storeSessionContext,
  };
}
