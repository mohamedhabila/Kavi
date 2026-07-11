import type {
  SubAgentActivityEntry,
  SubAgentResult,
  SubAgentSnapshot,
} from '../../../types/subAgent';
import type { SubAgentTerminalEvent } from '../subAgentRuntimeSignals';
import type { ActiveSubAgentRunControl, ProgressChanges, ProgressOptions } from './phases';

type LifecyclePersistenceManager = {
  loadRegistry: () => Promise<void>;
  persistRegistryNow: () => Promise<void>;
  scheduleRegistryPersist: () => void;
};

type LifecycleSessionContextManager = {
  deleteSessionContext: (sessionId: string) => void;
  scheduleSessionContextEviction: (sessionId: string) => void;
};

type LifecycleLogger = {
  devWarn: (...args: unknown[]) => void;
};

type UpdateAgentProgressFn<TAgent extends SubAgentSnapshot> = (
  agent: TAgent,
  changes: ProgressChanges<TAgent>,
  options?: ProgressOptions,
) => void;

export type SubAgentLifecycleManagerParams<TAgent extends SubAgentSnapshot> = {
  activeSubAgents: Map<string, TAgent>;
  activeRunControls: Map<string, ActiveSubAgentRunControl>;
  activeResultPromises: Map<string, Promise<SubAgentResult>>;
  logger: LifecycleLogger;
  registryPersistenceManager: LifecyclePersistenceManager;
  sessionContextManager: LifecycleSessionContextManager;
  clearQueuedLaunchWatch: (sessionId: string) => void;
  clearScheduledProgressAnnouncement: (sessionId: string) => void;
  resolveScheduledLaunchWithSnapshot: (sessionId: string) => boolean;
  cloneAgent: (agent: TAgent) => TAgent;
  updateAgentProgress: UpdateAgentProgressFn<TAgent>;
  appendActivity: (
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ) => void;
  onSubAgentTerminal: (
    listener: (agent: TAgent, event: SubAgentTerminalEvent) => void,
  ) => () => void;
  signalTerminal: (
    agent: TAgent,
    event: SubAgentTerminalEvent,
    options?: { announce?: boolean },
  ) => void;
  normalizePreviewText: (value: string | undefined, maxLength?: number) => string | undefined;
  maxToolResultPreviewChars: number;
  terminalSubAgentRetentionMs: number;
  reconcileOutcome?: (agent: TAgent) => Promise<boolean>;
};
