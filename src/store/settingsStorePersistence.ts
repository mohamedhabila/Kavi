import type { AppSettings } from '../types/settings';
import {
  deriveMemoryConsolidationModeFromSettings,
  normalizeMemoryConsolidationMode,
} from '../services/memory/memoryConsolidationMode';
import type { SettingsDataState } from './settingsStoreTypes';
import {
  normalizeProviders,
  sanitizeDefaultWorkspaceTargetIdForState,
  sanitizeExpoProjectsForSshTargets,
  sanitizeWebSearchProvider,
  sanitizeWorkspaceTargetsForState,
} from './settingsStoreNormalization';

export const SETTINGS_STORE_VERSION = 15;

type MigratableSettingsState = Record<string, any>;

export function migrateSettingsState(
  persistedState: unknown,
  version: number,
): AppSettings {
  if (!persistedState || typeof persistedState !== 'object') {
    return persistedState as AppSettings;
  }

  let nextState = persistedState as MigratableSettingsState;

  if (version < 2) {
    nextState = {
      ...nextState,
      webSearchProvider: nextState.webSearchProvider || 'auto',
    };
  }
  if (version < 3) {
    nextState = {
      ...nextState,
      sshTargets: nextState.sshTargets || [],
      workspaceTargets: nextState.workspaceTargets || [],
    };
  }
  if (version < 4) {
    nextState = {
      ...nextState,
      browserProviders: nextState.browserProviders || [],
    };
  }
  if (version < 5) {
    nextState = {
      ...nextState,
      expoAccounts: nextState.expoAccounts || [],
      expoProjects: nextState.expoProjects || [],
    };
  }
  if (version < 6) {
    nextState = {
      ...nextState,
      defaultConversationMode: nextState.defaultConversationMode || 'agentic',
    };
  }
  if (version < 7) {
    nextState = {
      ...nextState,
      providers: normalizeProviders(nextState.providers),
    };
  }
  if (version < 8) {
    const sshTargets = nextState.sshTargets || [];
    const browserProviders = nextState.browserProviders || [];
    nextState = {
      ...nextState,
      workspaceTargets: sanitizeWorkspaceTargetsForState(nextState.workspaceTargets || [], {
        browserProviders,
        sshTargets,
      }),
      expoProjects: sanitizeExpoProjectsForSshTargets(nextState.expoProjects || [], sshTargets),
    };
  }
  if (version < 9 && nextState.defaultConversationMode === 'direct') {
    nextState = {
      ...nextState,
      defaultConversationMode: 'chitchat',
    };
  }
  if (version < 10 && nextState.consolidationProvider === undefined) {
    nextState = {
      ...nextState,
      consolidationProvider: null,
    };
  }
  if (version < 11 && nextState.disableLongTermMemory === undefined) {
    nextState = {
      ...nextState,
      disableLongTermMemory: false,
    };
  }
  if (version < 12) {
    nextState = {
      ...nextState,
      webSearchProvider: sanitizeWebSearchProvider(nextState.webSearchProvider),
    };
  }
  if (version < 13) {
    nextState = {
      ...nextState,
      defaultWorkspaceTargetId: sanitizeDefaultWorkspaceTargetIdForState({
        defaultWorkspaceTargetId: nextState.defaultWorkspaceTargetId ?? null,
        workspaceTargets: nextState.workspaceTargets || [],
      }),
    };
  }
  if (version < 14) {
    nextState = {
      ...nextState,
      compactionProvider: nextState.compactionProvider ?? null,
      compactionModel: nextState.compactionModel ?? null,
    };
  }
  if (version < SETTINGS_STORE_VERSION) {
    nextState = {
      ...nextState,
      memoryConsolidationMode: deriveMemoryConsolidationModeFromSettings({
        memoryConsolidationMode: nextState.memoryConsolidationMode,
        consolidationProvider: nextState.consolidationProvider ?? null,
      }),
    };
  }

  return nextState as AppSettings;
}

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
    defaultConversationMode: state.defaultConversationMode,
    consolidationProvider: state.consolidationProvider,
    memoryConsolidationMode: normalizeMemoryConsolidationMode(state.memoryConsolidationMode),
    compactionProvider: state.compactionProvider,
    compactionModel: state.compactionModel,
    disableLongTermMemory: state.disableLongTermMemory,
  };
}
