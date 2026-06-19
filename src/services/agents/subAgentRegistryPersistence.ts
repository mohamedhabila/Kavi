import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { SubAgentConfig } from '../../types/subAgent';
import { flushPendingStorageWrites, throttledAsyncStorage } from '../../store/throttledStorage';
import {
  createSubAgentSessionContextManager,
  type PersistRegistryBestEffortOutcome,
  type SubAgentSessionContext,
} from './lifecycle/sessionContext';

type RegistryAgentSnapshot = {
  sessionId: string;
};

type RegistryLogger = {
  devWarn: (...args: unknown[]) => void;
};

type PreparedRegistryLaunch = {
  sessionId: string;
  depth: number;
};

type RegistryPersistenceManagerParams<TAgent extends RegistryAgentSnapshot> = {
  activeSubAgents: Map<string, TAgent>;
  sessionContextManager: Pick<
    ReturnType<typeof createSubAgentSessionContextManager>,
    | 'serializeActiveContexts'
    | 'loadPersistedContexts'
    | 'scheduleSessionContextCheckpoint'
    | 'reset'
  >;
  sanitizePersistedAgentSnapshot: (agent: TAgent) => TAgent;
  cloneSubAgentConfig: (config: SubAgentConfig) => SubAgentConfig;
  buildSubAgentSystemPrompt: (
    config: Pick<SubAgentConfig, 'systemPrompt' | 'inheritMemory'>,
    depth: number,
  ) => string;
  buildInitialSubAgentMessages: (config: SubAgentConfig) => Message[];
  logger: RegistryLogger;
  registryKey: string;
  registryContextsKey: string;
  registryPersistDebounceMs: number;
  persistBlockingTimeoutMs: number;
};

export function createSubAgentRegistryPersistenceManager<TAgent extends RegistryAgentSnapshot>(
  params: RegistryPersistenceManagerParams<TAgent>,
) {
  let registryPersistRequested = false;
  let registryPersistChain: Promise<void> = Promise.resolve();
  let scheduledRegistryPersist: ReturnType<typeof setTimeout> | undefined;

  async function writeRegistrySnapshot(): Promise<void> {
    const entries = Array.from(params.activeSubAgents.values()).map((agent) =>
      params.sanitizePersistedAgentSnapshot(agent),
    );
    const serializedContexts = params.sessionContextManager.serializeActiveContexts();

    await Promise.all([
      throttledAsyncStorage.setItem(params.registryKey, JSON.stringify(entries)),
      throttledAsyncStorage.setItem(params.registryContextsKey, JSON.stringify(serializedContexts)),
    ]);
  }

  async function flushPersistRegistryRequests(): Promise<void> {
    while (registryPersistRequested) {
      registryPersistRequested = false;
      await writeRegistrySnapshot();
    }
  }

  function enqueueRegistryPersist(): Promise<void> {
    registryPersistRequested = true;
    registryPersistChain = registryPersistChain
      .catch(() => undefined)
      .then(() => flushPersistRegistryRequests());
    return registryPersistChain;
  }

  function scheduleRegistryPersist(): void {
    registryPersistRequested = true;
    if (scheduledRegistryPersist) {
      return;
    }

    scheduledRegistryPersist = setTimeout(() => {
      scheduledRegistryPersist = undefined;
      void enqueueRegistryPersist().catch((error: unknown) => {
        params.logger.devWarn('background registry persist failed:', error);
      });
    }, params.registryPersistDebounceMs);
    (scheduledRegistryPersist as any)?.unref?.();
  }

  async function persistRegistryNow(): Promise<void> {
    if (scheduledRegistryPersist) {
      clearTimeout(scheduledRegistryPersist);
      scheduledRegistryPersist = undefined;
    }

    await enqueueRegistryPersist();
    await Promise.all([
      flushPendingStorageWrites(params.registryKey),
      flushPendingStorageWrites(params.registryContextsKey),
    ]);
  }

  async function loadRegistry(): Promise<void> {
    const [rawRegistry, rawContexts] = await Promise.all([
      throttledAsyncStorage.getItem(params.registryKey),
      throttledAsyncStorage.getItem(params.registryContextsKey),
    ]);

    const loadedSessionIds = new Set<string>();

    if (rawRegistry) {
      try {
        const entries: TAgent[] = JSON.parse(rawRegistry);
        for (const entry of entries) {
          if (!entry?.sessionId) {
            continue;
          }

          params.activeSubAgents.set(entry.sessionId, entry);
          loadedSessionIds.add(entry.sessionId);
        }
      } catch {
        /* corrupted data — ignore */
      }
    }

    if (!rawContexts) {
      return;
    }

    try {
      const parsed = JSON.parse(rawContexts) as Record<string, SubAgentSessionContext>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }
      params.sessionContextManager.loadPersistedContexts(parsed, loadedSessionIds);
    } catch {
      /* corrupted data — ignore */
    }
  }

  async function persistPreparedSubAgentLaunchState(
    prepared: PreparedRegistryLaunch,
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ): Promise<void> {
    params.sessionContextManager.scheduleSessionContextCheckpoint(
      {
        sessionId: prepared.sessionId,
        config,
        provider,
        allProviders,
        systemPrompt: params.buildSubAgentSystemPrompt(config, prepared.depth),
        conversationSummary: '',
        messages: params.buildInitialSubAgentMessages(config),
      },
      { immediate: true },
    );

    await persistRegistryNow();
  }

  async function persistPreparedSubAgentLaunchStateBestEffort(
    prepared: PreparedRegistryLaunch,
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const persistPromise = persistPreparedSubAgentLaunchState(
      prepared,
      config,
      provider,
      allProviders,
    );
    const persistOutcome = await new Promise<
      'persisted' | 'timed-out' | { kind: 'failed'; error: unknown }
    >((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timed-out'), params.persistBlockingTimeoutMs);
      (timeoutHandle as any)?.unref?.();
      void persistPromise
        .then(() => resolve('persisted'))
        .catch((error) => resolve({ kind: 'failed', error }));
    });

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (persistOutcome === 'persisted') {
      return;
    }

    if (persistOutcome === 'timed-out') {
      params.logger.devWarn(
        `Launch persistence exceeded ${params.persistBlockingTimeoutMs}ms; continuing in memory for ${prepared.sessionId}.`,
      );
      void persistPromise.catch((error) => {
        params.logger.devWarn(
          'Launch persistence eventually failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
      return;
    }

    params.logger.devWarn(
      'Launch persistence failed; continuing in memory:',
      persistOutcome.error instanceof Error
        ? persistOutcome.error.message
        : String(persistOutcome.error),
    );
  }

  async function persistRegistryBestEffort(
    context: string,
  ): Promise<PersistRegistryBestEffortOutcome> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const persistPromise = persistRegistryNow();
    const persistOutcome = await new Promise<
      'persisted' | 'timed-out' | { kind: 'failed'; error: unknown }
    >((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timed-out'), params.persistBlockingTimeoutMs);
      (timeoutHandle as any)?.unref?.();
      void persistPromise
        .then(() => resolve('persisted'))
        .catch((error) => resolve({ kind: 'failed', error }));
    });

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (persistOutcome === 'persisted') {
      return { status: 'persisted' };
    }

    if (persistOutcome === 'timed-out') {
      params.logger.devWarn(
        `${context}: persistence exceeded ${params.persistBlockingTimeoutMs}ms; continuing with in-memory state.`,
      );
      return {
        status: 'timed-out',
        completion: persistPromise
          .then(() => true)
          .catch((error) => {
            params.logger.devWarn(
              `${context}: background persistence eventually failed:`,
              error instanceof Error ? error.message : String(error),
            );
            return false;
          }),
      };
    }

    params.logger.devWarn(
      `${context}:`,
      persistOutcome.error instanceof Error
        ? persistOutcome.error.message
        : String(persistOutcome.error),
    );

    return { status: 'failed' };
  }

  function reset(): void {
    if (scheduledRegistryPersist) {
      clearTimeout(scheduledRegistryPersist);
      scheduledRegistryPersist = undefined;
    }

    registryPersistRequested = false;
    registryPersistChain = Promise.resolve();
  }

  return {
    loadRegistry,
    persistPreparedSubAgentLaunchStateBestEffort,
    persistRegistryBestEffort,
    persistRegistryNow,
    reset,
    scheduleRegistryPersist,
  };
}
