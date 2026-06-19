import type { Locale } from '../i18n/types';
import { i18n } from '../i18n/manager';
import type { AppSettings } from '../types/settings';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../types/remote';
import type {
  LastUsedModelSelection,
  LlmProviderConfig,
  ThinkingLevelPreference,
} from '../types/provider';
import type { WebSearchProvider } from '../types/tool';
import type { ConversationMode } from '../types/conversation';
import type { MemoryConsolidationMode } from '../services/memory/memoryConsolidationMode';

export interface SettingsDataState extends AppSettings {
  providers: LlmProviderConfig[];
  mcpServers: McpServerConfig[];
  sshTargets: SshTargetConfig[];
  workspaceTargets: WorkspaceTargetConfig[];
  defaultWorkspaceTargetId: string | null;
  browserProviders: BrowserProviderConfig[];
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  activeProviderId: string | null;
  activeModel: string | null;
  lastUsedModel: LastUsedModelSelection | null;
  thinkingLevel: ThinkingLevelPreference;
  locale: Locale;
  webSearchProvider: WebSearchProvider;
  linkUnderstandingEnabled: boolean;
  mediaUnderstandingEnabled: boolean;
  maxLinks: number;
  defaultConversationMode: ConversationMode;
  memoryConsolidationMode: MemoryConsolidationMode;
  consolidationProvider: string | null;
  compactionProvider: string | null;
  compactionModel: string | null;
  disableLongTermMemory: boolean;
}

export interface SettingsState extends SettingsDataState {
  addProvider: (provider: LlmProviderConfig) => void;
  updateProvider: (provider: LlmProviderConfig) => void;
  removeProvider: (id: string) => void;
  toggleModelVisibility: (providerId: string, model: string) => void;
  setActiveProviderAndModel: (providerId: string | null, model: string | null) => void;
  setLastUsedModel: (providerId: string, model: string) => void;

  addMcpServer: (server: McpServerConfig) => void;
  updateMcpServer: (server: McpServerConfig) => void;
  removeMcpServer: (id: string) => void;

  addSshTarget: (target: SshTargetConfig) => void;
  updateSshTarget: (target: SshTargetConfig) => void;
  removeSshTarget: (id: string) => void;

  addWorkspaceTarget: (target: WorkspaceTargetConfig) => void;
  updateWorkspaceTarget: (target: WorkspaceTargetConfig) => void;
  removeWorkspaceTarget: (id: string) => void;

  addBrowserProvider: (provider: BrowserProviderConfig) => void;
  updateBrowserProvider: (provider: BrowserProviderConfig) => void;
  removeBrowserProvider: (id: string) => void;

  addExpoAccount: (account: ExpoAccountConfig) => void;
  updateExpoAccount: (account: ExpoAccountConfig) => void;
  removeExpoAccount: (id: string) => void;

  addExpoProject: (project: ExpoProjectConfig) => void;
  updateExpoProject: (project: ExpoProjectConfig) => void;
  removeExpoProject: (id: string) => void;

  setTheme: (theme: AppSettings['theme']) => void;
  setSystemPrompt: (prompt: string) => void;
  setThinkingLevel: (level: ThinkingLevelPreference) => void;
  setLocale: (locale: Locale) => void;
  setWebSearchProvider: (provider: WebSearchProvider) => void;
  setLinkUnderstandingEnabled: (enabled: boolean) => void;
  setMediaUnderstandingEnabled: (enabled: boolean) => void;
  setMaxLinks: (max: number) => void;
  setDefaultConversationMode: (mode: ConversationMode) => void;
  setDefaultWorkspaceTargetId: (targetId: string | null) => void;
  setConsolidationProvider: (providerId: string | null) => void;
  setMemoryConsolidationMode: (mode: MemoryConsolidationMode, providerId?: string | null) => void;
  setCompactionProvider: (providerId: string | null) => void;
  setCompactionModel: (model: string | null) => void;
  setDisableLongTermMemory: (disabled: boolean) => void;
  replaceAllSettings: (settings: Partial<AppSettings>) => void;
}

export function createDefaultSettingsDataState(): SettingsDataState {
  return {
    providers: [],
    mcpServers: [],
    sshTargets: [],
    workspaceTargets: [],
    browserProviders: [],
    expoAccounts: [],
    expoProjects: [],
    activeProviderId: null,
    activeModel: null,
    theme: 'dark',
    systemPrompt: i18n.t('settings.defaultSystemPrompt'),
    lastUsedModel: null,
    thinkingLevel: 'medium',
    locale: 'en',
    webSearchProvider: 'auto',
    linkUnderstandingEnabled: true,
    mediaUnderstandingEnabled: true,
    maxLinks: 3,
    defaultConversationMode: 'agentic',
    defaultWorkspaceTargetId: null,
    consolidationProvider: null,
    memoryConsolidationMode: 'auto',
    compactionProvider: null,
    compactionModel: null,
    disableLongTermMemory: false,
  };
}
