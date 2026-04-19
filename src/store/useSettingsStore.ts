// ---------------------------------------------------------------------------
// Kavi — Settings Store (Zustand)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppSettings,
  BrowserProviderConfig,
  ConversationMode,
  ExpoAccountConfig,
  ExpoProjectConfig,
  LastUsedModelSelection,
  LlmProviderConfig,
  McpServerConfig,
  SshTargetConfig,
  ThinkingLevelPreference,
  WebSearchProvider,
  WorkspaceTargetConfig,
} from '../types';
import { STORAGE_KEYS } from '../constants/storage';
import { finalizeProviderConfig } from '../constants/api';
import type { Locale } from '../i18n/types';
import { i18n } from '../i18n';
import {
  getWorkspaceTargetDisplayName,
  normalizeWorkspaceTargetLinks,
} from '../services/workspaces/config';

interface SettingsState extends AppSettings {
  lastUsedModel: LastUsedModelSelection | null;
  thinkingLevel: ThinkingLevelPreference;
  locale: Locale;
  webSearchProvider: WebSearchProvider;
  linkUnderstandingEnabled: boolean;
  mediaUnderstandingEnabled: boolean;
  maxLinks: number;
  defaultConversationMode: ConversationMode;

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
  replaceAllSettings: (settings: Partial<AppSettings>) => void;
}

function hasOwnSetting(settings: Partial<AppSettings>, key: keyof AppSettings): boolean {
  return Object.prototype.hasOwnProperty.call(settings, key);
}

function normalizeProviders(providers: LlmProviderConfig[] | undefined): LlmProviderConfig[] {
  return (providers || []).map((provider) => finalizeProviderConfig(provider));
}

type WorkspaceLinkSettings = Pick<AppSettings, 'browserProviders' | 'sshTargets'>;

function normalizeWorkspaceTargetForState(
  target: WorkspaceTargetConfig,
  settings: WorkspaceLinkSettings,
): WorkspaceTargetConfig {
  const namedTarget: WorkspaceTargetConfig = {
    ...target,
    name: getWorkspaceTargetDisplayName(target),
  };

  return normalizeWorkspaceTargetLinks(namedTarget, settings);
}

function sanitizeWorkspaceTargetsForState(
  workspaceTargets: WorkspaceTargetConfig[] | undefined,
  settings: WorkspaceLinkSettings,
): WorkspaceTargetConfig[] {
  return (workspaceTargets || []).map((target) =>
    normalizeWorkspaceTargetForState(target, settings),
  );
}

function sanitizeExpoProjectsForSshTargets(
  expoProjects: ExpoProjectConfig[] | undefined,
  sshTargets: SshTargetConfig[] | undefined,
): ExpoProjectConfig[] {
  const validTargetIds = new Set((sshTargets || []).map((target) => target.id));

  return (expoProjects || []).map((project) => {
    const sshTargetId = (project.sshTargetId || '').trim();
    if (!sshTargetId || validTargetIds.has(sshTargetId)) {
      return project;
    }

    return {
      ...project,
      sshTargetId: undefined,
    };
  });
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
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
      thinkingLevel: 'medium' as const,
      locale: 'en' as Locale,
      webSearchProvider: 'auto' as WebSearchProvider,
      linkUnderstandingEnabled: true,
      mediaUnderstandingEnabled: true,
      maxLinks: 3,
      defaultConversationMode: 'agentic' as ConversationMode,

      addProvider: (provider) =>
        set((state) => {
          const finalizedProvider = finalizeProviderConfig(provider);
          return {
            providers: [...state.providers, finalizedProvider],
            activeProviderId: state.activeProviderId ?? finalizedProvider.id,
            activeModel: state.activeProviderId ? state.activeModel : finalizedProvider.model,
          };
        }),

      updateProvider: (updatedProvider) =>
        set((state) => {
          const finalizedProvider = finalizeProviderConfig(updatedProvider);
          const previousProvider = state.providers.find((p) => p.id === finalizedProvider.id);
          let activeProviderId = state.activeProviderId;
          let activeModel = state.activeModel;

          if (activeProviderId === finalizedProvider.id) {
            if (!finalizedProvider.enabled) {
              const fallbackProvider = state.providers.find(
                (p) => p.id !== finalizedProvider.id && p.enabled,
              );
              activeProviderId = fallbackProvider?.id ?? null;
              activeModel = fallbackProvider?.model ?? null;
            } else if (!activeModel || activeModel === previousProvider?.model) {
              activeModel = finalizedProvider.model;
            }
          }

          return {
            providers: state.providers.map((p) =>
              p.id === finalizedProvider.id ? finalizedProvider : p,
            ),
            activeProviderId,
            activeModel,
            lastUsedModel:
              state.lastUsedModel?.providerId === finalizedProvider.id && !finalizedProvider.enabled
                ? null
                : state.lastUsedModel,
          };
        }),

      removeProvider: (id) =>
        set((state) => {
          const nextProvider = state.providers.find((p) => p.id !== id && p.enabled);
          return {
            providers: state.providers.filter((p) => p.id !== id),
            activeProviderId:
              state.activeProviderId === id ? (nextProvider?.id ?? null) : state.activeProviderId,
            activeModel:
              state.activeProviderId === id ? (nextProvider?.model ?? null) : state.activeModel,
            lastUsedModel: state.lastUsedModel?.providerId === id ? null : state.lastUsedModel,
          };
        }),

      toggleModelVisibility: (providerId, model) =>
        set((state) => ({
          providers: state.providers.map((p) => {
            if (p.id !== providerId) return p;
            const hidden = new Set(p.hiddenModels || []);
            if (hidden.has(model)) {
              hidden.delete(model);
            } else {
              hidden.add(model);
            }
            return { ...p, hiddenModels: Array.from(hidden) };
          }),
        })),

      setActiveProviderAndModel: (providerId, model) =>
        set((state) => ({
          activeProviderId: providerId,
          activeModel: model,
          lastUsedModel: providerId && model ? { providerId, model } : state.lastUsedModel,
        })),

      setLastUsedModel: (providerId, model) => set({ lastUsedModel: { providerId, model } }),

      addMcpServer: (server) => set((state) => ({ mcpServers: [...state.mcpServers, server] })),

      updateMcpServer: (server) =>
        set((state) => ({
          mcpServers: state.mcpServers.map((s) => (s.id === server.id ? server : s)),
        })),

      removeMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.filter((s) => s.id !== id),
        })),

      addSshTarget: (target) =>
        set((state) => ({ sshTargets: [...(state.sshTargets || []), target] })),

      updateSshTarget: (target) =>
        set((state) => ({
          sshTargets: (state.sshTargets || []).map((entry) =>
            entry.id === target.id ? target : entry,
          ),
        })),

      removeSshTarget: (id) =>
        set((state) => {
          const sshTargets = (state.sshTargets || []).filter((entry) => entry.id !== id);
          return {
            sshTargets,
            workspaceTargets: sanitizeWorkspaceTargetsForState(
              (state.workspaceTargets || []).map((entry) =>
                entry.sshTargetId === id ? { ...entry, sshTargetId: undefined } : entry,
              ),
              {
                browserProviders: state.browserProviders,
                sshTargets,
              },
            ),
            expoProjects: sanitizeExpoProjectsForSshTargets(
              (state.expoProjects || []).map((project) =>
                project.sshTargetId === id ? { ...project, sshTargetId: undefined } : project,
              ),
              sshTargets,
            ),
          };
        }),

      addWorkspaceTarget: (target) =>
        set((state) => ({
          workspaceTargets: [
            ...(state.workspaceTargets || []),
            normalizeWorkspaceTargetForState(target, {
              browserProviders: state.browserProviders,
              sshTargets: state.sshTargets,
            }),
          ],
        })),

      updateWorkspaceTarget: (target) =>
        set((state) => ({
          workspaceTargets: (state.workspaceTargets || []).map((entry) =>
            entry.id === target.id
              ? normalizeWorkspaceTargetForState(target, {
                  browserProviders: state.browserProviders,
                  sshTargets: state.sshTargets,
                })
              : entry,
          ),
        })),

      removeWorkspaceTarget: (id) =>
        set((state) => ({
          workspaceTargets: (state.workspaceTargets || []).filter((entry) => entry.id !== id),
        })),

      addBrowserProvider: (provider) =>
        set((state) => ({ browserProviders: [...(state.browserProviders || []), provider] })),

      updateBrowserProvider: (provider) =>
        set((state) => ({
          browserProviders: (state.browserProviders || []).map((entry) =>
            entry.id === provider.id ? provider : entry,
          ),
        })),

      removeBrowserProvider: (id) =>
        set((state) => {
          const browserProviders = (state.browserProviders || []).filter(
            (entry) => entry.id !== id,
          );
          return {
            browserProviders,
            workspaceTargets: sanitizeWorkspaceTargetsForState(
              (state.workspaceTargets || []).map((entry) =>
                entry.browserProviderId === id ? { ...entry, browserProviderId: undefined } : entry,
              ),
              {
                browserProviders,
                sshTargets: state.sshTargets,
              },
            ),
          };
        }),

      addExpoAccount: (account) =>
        set((state) => ({ expoAccounts: [...(state.expoAccounts || []), account] })),

      updateExpoAccount: (account) =>
        set((state) => ({
          expoAccounts: (state.expoAccounts || []).map((entry) =>
            entry.id === account.id ? account : entry,
          ),
        })),

      removeExpoAccount: (id) =>
        set((state) => ({
          expoAccounts: (state.expoAccounts || []).filter((entry) => entry.id !== id),
          expoProjects: (state.expoProjects || []).filter((project) => project.accountId !== id),
        })),

      addExpoProject: (project) =>
        set((state) => ({ expoProjects: [...(state.expoProjects || []), project] })),

      updateExpoProject: (project) =>
        set((state) => ({
          expoProjects: (state.expoProjects || []).map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        })),

      removeExpoProject: (id) =>
        set((state) => ({
          expoProjects: (state.expoProjects || []).filter((entry) => entry.id !== id),
        })),

      setTheme: (theme) => set({ theme }),

      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

      setThinkingLevel: (level) => set({ thinkingLevel: level }),

      setLocale: (locale) => set({ locale }),

      setWebSearchProvider: (provider) => set({ webSearchProvider: provider }),

      setLinkUnderstandingEnabled: (enabled) => set({ linkUnderstandingEnabled: enabled }),

      setMediaUnderstandingEnabled: (enabled) => set({ mediaUnderstandingEnabled: enabled }),

      setMaxLinks: (max) => set({ maxLinks: Math.max(1, Math.min(10, max)) }),

      setDefaultConversationMode: (mode) => set({ defaultConversationMode: mode }),

      replaceAllSettings: (settings) =>
        set((state) => {
          const sshTargets = settings.sshTargets ?? state.sshTargets;
          const browserProviders = settings.browserProviders ?? state.browserProviders;

          return {
            providers: settings.providers
              ? normalizeProviders(settings.providers)
              : state.providers,
            mcpServers: settings.mcpServers ?? state.mcpServers,
            sshTargets,
            workspaceTargets: sanitizeWorkspaceTargetsForState(
              settings.workspaceTargets ?? state.workspaceTargets,
              { browserProviders, sshTargets },
            ),
            browserProviders,
            expoAccounts: settings.expoAccounts ?? state.expoAccounts,
            expoProjects: sanitizeExpoProjectsForSshTargets(
              settings.expoProjects ?? state.expoProjects,
              sshTargets,
            ),
            activeProviderId: hasOwnSetting(settings, 'activeProviderId')
              ? settings.activeProviderId
              : state.activeProviderId,
            activeModel: hasOwnSetting(settings, 'activeModel')
              ? settings.activeModel
              : state.activeModel,
            theme: settings.theme ?? state.theme,
            systemPrompt: settings.systemPrompt ?? state.systemPrompt,
            lastUsedModel: hasOwnSetting(settings, 'lastUsedModel')
              ? (settings.lastUsedModel ?? null)
              : state.lastUsedModel,
            thinkingLevel: settings.thinkingLevel ?? state.thinkingLevel,
            locale: settings.locale ?? state.locale,
            webSearchProvider: settings.webSearchProvider ?? state.webSearchProvider,
            linkUnderstandingEnabled:
              settings.linkUnderstandingEnabled ?? state.linkUnderstandingEnabled,
            mediaUnderstandingEnabled:
              settings.mediaUnderstandingEnabled ?? state.mediaUnderstandingEnabled,
            maxLinks:
              settings.maxLinks !== undefined
                ? Math.max(1, Math.min(10, settings.maxLinks))
                : state.maxLinks,
            defaultConversationMode:
              settings.defaultConversationMode ?? state.defaultConversationMode,
          };
        }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(() => AsyncStorage),
      version: 8,
      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;
        if (version < 2) {
          persistedState = {
            ...persistedState,
            webSearchProvider: persistedState.webSearchProvider || 'auto',
          };
        }
        if (version < 3) {
          persistedState = {
            ...persistedState,
            sshTargets: persistedState.sshTargets || [],
            workspaceTargets: persistedState.workspaceTargets || [],
          };
        }
        if (version < 4) {
          persistedState = {
            ...persistedState,
            browserProviders: persistedState.browserProviders || [],
          };
        }
        if (version < 5) {
          persistedState = {
            ...persistedState,
            expoAccounts: persistedState.expoAccounts || [],
            expoProjects: persistedState.expoProjects || [],
          };
        }
        if (version < 6) {
          persistedState = {
            ...persistedState,
            defaultConversationMode: persistedState.defaultConversationMode || 'agentic',
          };
        }
        if (version < 7) {
          persistedState = {
            ...persistedState,
            providers: normalizeProviders(persistedState.providers),
          };
        }
        if (version < 8) {
          const sshTargets = persistedState.sshTargets || [];
          const browserProviders = persistedState.browserProviders || [];
          persistedState = {
            ...persistedState,
            workspaceTargets: sanitizeWorkspaceTargetsForState(
              persistedState.workspaceTargets || [],
              { browserProviders, sshTargets },
            ),
            expoProjects: sanitizeExpoProjectsForSshTargets(
              persistedState.expoProjects || [],
              sshTargets,
            ),
          };
        }
        return persistedState;
      },
      partialize: (state) => ({
        providers: state.providers.map((p) => ({ ...p, apiKey: '' })), // Don't persist API keys in plain storage
        mcpServers: state.mcpServers,
        sshTargets: state.sshTargets,
        workspaceTargets: state.workspaceTargets,
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
      }),
    },
  ),
);
