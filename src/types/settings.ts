import type { Locale } from '../i18n/types';
import type {
  LlmProviderConfig,
  LastUsedModelSelection,
  ThinkingLevelPreference,
} from './provider';
import type { MemoryConsolidationMode } from '../services/memory/memoryConsolidationMode';
import type { WebSearchProvider } from './tool';
import type {
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
} from './remote';

/** How tier-2/tier-3 compaction summaries are produced. */
export type CompactionSummarizerMode = 'auto' | 'off';

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
  /** The person's thinking level; null in an exported file: none chosen, each model's own default. */
  thinkingLevel?: ThinkingLevelPreference | null;
  locale?: Locale;
  webSearchProvider?: WebSearchProvider;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxLinks?: number;
  theme: 'light' | 'dark' | 'system';
  systemPrompt: string;
  /**
   * Which model extracts memories from finished turns: `auto` uses the active chat model,
   * `local` an on-device model, `specific` the chosen provider, and `off` none (Kavi then
   * saves only what it is asked to remember).
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
  /** 'auto' lets compaction summaries be model-authored; 'off' forces the deterministic path. */
  compactionSummarizer?: CompactionSummarizerMode;
  compactionProvider?: string | null;
  /** Optional cheaper model override on `compactionProvider`. */
  compactionModel?: string | null;
  disableLongTermMemory?: boolean;
}
