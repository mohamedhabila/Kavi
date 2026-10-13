import type { AppSettings } from '../types/settings';
import { normalizeMemoryConsolidationMode } from '../services/memory/memoryConsolidationMode';
import type { SettingsDataState } from './settingsStoreTypes';

export const SETTINGS_STORE_VERSION = 17;

export function partializeSettingsState(state: SettingsDataState): AppSettings {
  return {
    providers: state.providers.map((provider) => ({ ...provider, apiKey: '' })),
    mcpServers: state.mcpServers,
    sshTargets: state.sshTargets,
    workspaceTargets: state.workspaceTargets,
    defaultWorkspaceTargetId: state.defaultWorkspaceTargetId,
    browserProviders: state.browserProviders,
    expoAccounts: state.expoAccounts,
    expoProjects: state.expoProjects,
    activeProviderId: state.activeProviderId,
    activeModel: state.activeModel,
    theme: state.theme,
    systemPrompt: state.systemPrompt,
    lastUsedModel: state.lastUsedModel,
    thinkingLevel: state.thinkingLevel,
    locale: state.locale,
    webSearchProvider: state.webSearchProvider,
    linkUnderstandingEnabled: state.linkUnderstandingEnabled,
    mediaUnderstandingEnabled: state.mediaUnderstandingEnabled,
    maxLinks: state.maxLinks,
    consolidationProvider: state.consolidationProvider,
    memoryConsolidationMode: normalizeMemoryConsolidationMode(state.memoryConsolidationMode),
    compactionSummarizer: state.compactionSummarizer,
    compactionProvider: state.compactionProvider,
    compactionModel: state.compactionModel,
    disableLongTermMemory: state.disableLongTermMemory,
    developerModeEnabled: state.developerModeEnabled,
  };
}
