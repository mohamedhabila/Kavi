import type { AppSettings } from '../types/settings';
import { i18n } from '../i18n/manager';
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

export const SETTINGS_STORE_VERSION = 17;

type MigratableSettingsState = Record<string, any>;

/**
 * Values that used to be written as the shipped default system prompt. Locales load
 * lazily, so this checks the English original plus whatever the active locale renders;
 * an unmatched translation simply survives as a harmless customization the user can
 * clear in Settings.
 */
function isLegacyShippedSystemPrompt(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return (
    normalized === 'You are a helpful personal AI assistant with access to tools.' ||
    normalized === i18n.t('settings.defaultSystemPrompt').trim()
  );
}

export function migrateSettingsState(persistedState: unknown, version: number): AppSettings {
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
  if (version < 15) {
    nextState = {
      ...nextState,
      memoryConsolidationMode: deriveMemoryConsolidationModeFromSettings({
        memoryConsolidationMode: nextState.memoryConsolidationMode,
        consolidationProvider: nextState.consolidationProvider ?? null,
      }),
    };
  }
  if (version < 17) {
    nextState = {
      ...nextState,
      developerModeEnabled:
        typeof nextState.developerModeEnabled === 'boolean'
          ? nextState.developerModeEnabled
          : false,
      // The shipped default flipped from 'agentic' to 'chitchat'. A persisted
      // 'agentic' value cannot be distinguished from "never touched, took the
      // old default", so every existing install is carried over to the new
      // default; the mode stays user-switchable per conversation and in
      // Settings afterward.
      defaultConversationMode:
        nextState.defaultConversationMode === 'agentic'
          ? 'chitchat'
          : nextState.defaultConversationMode,
    };
  }
  if (version < SETTINGS_STORE_VERSION && nextState.compactionSummarizer === undefined) {
    // Model-authored compaction is the new default. The previous "off" chip only
    // meant "no cheaper override provider", never an explicit opt-out, so an
    // existing install is migrated to auto and can switch back in Settings.
    nextState = {
      ...nextState,
      compactionSummarizer: 'auto',
    };
  }
  if (version < SETTINGS_STORE_VERSION && isLegacyShippedSystemPrompt(nextState.systemPrompt)) {
    // The generic one-liner used to be the shipped default, so a persisted copy is
    // almost never a deliberate customization. Clearing it lets the active persona
    // own the operating instructions instead of competing with a second identity.
    nextState = {
      ...nextState,
      systemPrompt: '',
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
    compactionSummarizer: state.compactionSummarizer,
    compactionProvider: state.compactionProvider,
    compactionModel: state.compactionModel,
    disableLongTermMemory: state.disableLongTermMemory,
    developerModeEnabled: state.developerModeEnabled,
  };
}
