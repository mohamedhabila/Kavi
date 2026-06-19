import type { Message } from '../../../types/message';
import type { LlmProviderConfig } from '../../../types/provider';
import type {
  SubAgentActivityEntry,
  SubAgentConfig,
  SubAgentSnapshot,
} from '../../../types/subAgent';
import type {
  ActiveSubAgentRunControl,
  PreparedSubAgentSession,
  ProgressChanges,
  ProgressOptions,
} from './phases';
import type {
  PersistRegistryBestEffortOutcome,
  SessionContextStoreParams,
} from './sessionContext';

export type RunPreparedSubAgentSessionParams<TAgent extends SubAgentSnapshot> = {
  prepared: PreparedSubAgentSession<TAgent>;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  activeRunControls: Map<string, ActiveSubAgentRunControl>;
  appendActivity: (
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ) => void;
  appendTranscriptMessage: (messages: Message[], message: Message) => void;
  announce: (agent: TAgent, event: 'completed' | 'cancelled' | 'timeout' | 'error') => void;
  clearPendingSessionContextCheckpoint: (sessionId: string) => void;
  clearSessionContextEviction: (sessionId: string) => void;
  finalizationMaxTranscriptMessages: number;
  finalizationMessageCharLimit: number;
  finalizationMinRemainingMs: number;
  finalizationTimeoutCapMs: number;
  finalizationToolContentCharLimit: number;
  markModelResponseObserved: (agent: TAgent) => void;
  maxToolResultPreviewChars: number;
  persistRegistryBestEffort: (context: string) => Promise<PersistRegistryBestEffortOutcome>;
  refreshSubAgentArtifacts: (agent: TAgent, transcriptMessages: Message[]) => void;
  sanitizeTranscriptMessage: (message: Message) => Message;
  scheduleRegistryPersist: () => void;
  scheduleSessionContextCheckpoint: (
    context: SessionContextStoreParams,
    options?: { immediate?: boolean },
  ) => void;
  scheduleSessionContextEvictionWhenDurable: (
    sessionId: string,
    persistOutcome: PersistRegistryBestEffortOutcome,
  ) => void;
  storeSessionContext: (context: SessionContextStoreParams) => void;
  updateAgentProgress: (
    agent: TAgent,
    changes: ProgressChanges<TAgent>,
    options?: ProgressOptions,
  ) => void;
};
