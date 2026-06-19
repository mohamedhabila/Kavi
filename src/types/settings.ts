import type { Locale } from '../i18n/types';
import type {
  LlmProviderConfig,
  LastUsedModelSelection,
  ThinkingLevelPreference,
} from './provider';
import type { MemoryConsolidationMode } from '../services/memory/memoryConsolidationMode';
import type { WebSearchProvider } from './tool';
import type { ConversationMode } from './conversation';
import type {
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
} from './remote';

export interface AppSettings {
  providers: LlmProviderConfig[];
  mcpServers: McpServerConfig[];
  sshTargets?: SshTargetConfig[];
  workspaceTargets?: WorkspaceTargetConfig[];
  defaultWorkspaceTargetId?: string | null;
  browserProviders?: BrowserProviderConfig[];
  expoAccounts?: ExpoAccountConfig[];
  expoProjects?: ExpoProjectConfig[];
  activeProviderId: string | null;
  activeModel: string | null;
  lastUsedModel?: LastUsedModelSelection | null;
  thinkingLevel?: ThinkingLevelPreference;
  locale?: Locale;
  webSearchProvider?: WebSearchProvider;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxLinks?: number;
  theme: 'light' | 'dark' | 'system';
  systemPrompt: string;
  defaultConversationMode?: ConversationMode;
  /**
   * Enrichment strategy for memory consolidation. `auto` cascades through
   * dedicated provider → on-device → active chat → structural extraction.
   */
  memoryConsolidationMode?: MemoryConsolidationMode;
  /**
   * Provider id used when `memoryConsolidationMode` is `specific`.
   */
  consolidationProvider?: string | null;
  /**
   * Optional provider for tier-2/tier-3 LLM compaction summaries.
   * When unset, compaction uses deterministic structural summaries.
   */
  compactionProvider?: string | null;
  /** Optional cheaper model override on `compactionProvider`. */
  compactionModel?: string | null;
  disableLongTermMemory?: boolean;
}
