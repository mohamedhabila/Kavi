import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings } from '../types/settings';
import { STORAGE_KEYS } from '../constants/storage';
import { finalizeProviderConfig } from '../constants/api';
import {
  normalizeMemoryConsolidationMode,
  resolveConsolidationProviderIdForMode,
} from '../services/memory/memoryConsolidationMode';
import { createDefaultSettingsDataState, type SettingsState } from './settingsStoreTypes';
import {
  clampMaxLinks,
  hasOwnSetting,
  normalizeProviders,
  normalizeWorkspaceTargetForState,
  sanitizeDefaultWorkspaceTargetIdForState,
  sanitizeExpoProjectsForSshTargets,
  sanitizeWebSearchProvider,
  sanitizeWorkspaceTargetsForState,
} from './settingsStoreNormalization';
import {
  migrateSettingsState,
  partializeSettingsState,
  SETTINGS_STORE_VERSION,
} from './settingsStorePersistence';

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], AppSettings>(
    (set) => ({
      ...createDefaultSettingsDataState(),

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
          providers: state.providers.map((provider) => {
            if (provider.id !== providerId) return provider;
            const hidden = new Set(provider.hiddenModels || []);
            if (hidden.has(model)) {
              hidden.delete(model);
            } else {
              hidden.add(model);
            }
            return { ...provider, hiddenModels: Array.from(hidden) };
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
          mcpServers: state.mcpServers.map((entry) => (entry.id === server.id ? server : entry)),
        })),

      removeMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.filter((entry) => entry.id !== id),
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
        set((state) => {
          const workspaceTargets = [
            ...(state.workspaceTargets || []),
            normalizeWorkspaceTargetForState(target, {
              browserProviders: state.browserProviders,
              sshTargets: state.sshTargets,
            }),
          ];
          return {
            workspaceTargets,
            defaultWorkspaceTargetId: sanitizeDefaultWorkspaceTargetIdForState({
              defaultWorkspaceTargetId: state.defaultWorkspaceTargetId,
              workspaceTargets,
            }),
          };
        }),

      updateWorkspaceTarget: (target) =>
        set((state) => {
          const workspaceTargets = (state.workspaceTargets || []).map((entry) =>
            entry.id === target.id
              ? normalizeWorkspaceTargetForState(target, {
                  browserProviders: state.browserProviders,
                  sshTargets: state.sshTargets,
                })
              : entry,
          );
          return {
            workspaceTargets,
            defaultWorkspaceTargetId: sanitizeDefaultWorkspaceTargetIdForState({
              defaultWorkspaceTargetId: state.defaultWorkspaceTargetId,
              workspaceTargets,
            }),
          };
        }),

      removeWorkspaceTarget: (id) =>
        set((state) => {
          const workspaceTargets = (state.workspaceTargets || []).filter(
            (entry) => entry.id !== id,
          );
          return {
            workspaceTargets,
            defaultWorkspaceTargetId: sanitizeDefaultWorkspaceTargetIdForState({
              defaultWorkspaceTargetId:
                state.defaultWorkspaceTargetId === id ? null : state.defaultWorkspaceTargetId,
              workspaceTargets,
            }),
          };
        }),

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

      setMaxLinks: (max) => set({ maxLinks: clampMaxLinks(max) }),

      setDefaultConversationMode: (mode) => set({ defaultConversationMode: mode }),

      setDefaultWorkspaceTargetId: (targetId) =>
        set((state) => ({
          defaultWorkspaceTargetId: sanitizeDefaultWorkspaceTargetIdForState({
            defaultWorkspaceTargetId: targetId,
            workspaceTargets: state.workspaceTargets,
          }),
        })),

      setConsolidationProvider: (providerId) =>
        set((state) => ({
          memoryConsolidationMode:
            typeof providerId === 'string' && providerId.trim().length > 0
              ? 'specific'
              : state.memoryConsolidationMode === 'specific'
                ? 'auto'
                : state.memoryConsolidationMode,
          consolidationProvider:
            typeof providerId === 'string' && providerId.trim().length > 0
              ? providerId.trim()
              : null,
        })),

      setMemoryConsolidationMode: (mode, providerId) =>
        set(() => {
          const normalizedMode = normalizeMemoryConsolidationMode(mode);
          const resolvedProviderId = resolveConsolidationProviderIdForMode(
            normalizedMode,
            providerId,
          );
          return {
            memoryConsolidationMode: normalizedMode,
            consolidationProvider: resolvedProviderId,
          };
        }),

      setCompactionProvider: (providerId) =>
        set({
          compactionProvider:
            typeof providerId === 'string' && providerId.trim().length > 0
              ? providerId.trim()
              : null,
        }),

      setCompactionModel: (model) =>
        set({
          compactionModel:
            typeof model === 'string' && model.trim().length > 0 ? model.trim() : null,
        }),

      setDisableLongTermMemory: (disabled) => set({ disableLongTermMemory: Boolean(disabled) }),

      replaceAllSettings: (settings) =>
        set((state) => {
          const sshTargets = settings.sshTargets ?? state.sshTargets;
          const browserProviders = settings.browserProviders ?? state.browserProviders;
          const workspaceTargets = sanitizeWorkspaceTargetsForState(
            settings.workspaceTargets ?? state.workspaceTargets,
            { browserProviders, sshTargets },
          );

          return {
            providers: settings.providers
              ? normalizeProviders(settings.providers)
              : state.providers,
            mcpServers: settings.mcpServers ?? state.mcpServers,
            sshTargets,
            workspaceTargets,
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
            webSearchProvider:
              settings.webSearchProvider !== undefined
                ? sanitizeWebSearchProvider(settings.webSearchProvider)
                : state.webSearchProvider,
            linkUnderstandingEnabled:
              settings.linkUnderstandingEnabled ?? state.linkUnderstandingEnabled,
            mediaUnderstandingEnabled:
              settings.mediaUnderstandingEnabled ?? state.mediaUnderstandingEnabled,
            maxLinks:
              settings.maxLinks !== undefined ? clampMaxLinks(settings.maxLinks) : state.maxLinks,
            defaultConversationMode:
              settings.defaultConversationMode ?? state.defaultConversationMode,
            defaultWorkspaceTargetId: hasOwnSetting(settings, 'defaultWorkspaceTargetId')
              ? sanitizeDefaultWorkspaceTargetIdForState({
                  defaultWorkspaceTargetId: settings.defaultWorkspaceTargetId ?? null,
                  workspaceTargets,
                })
              : sanitizeDefaultWorkspaceTargetIdForState({
                  defaultWorkspaceTargetId: state.defaultWorkspaceTargetId,
                  workspaceTargets,
                }),
            consolidationProvider: hasOwnSetting(settings, 'consolidationProvider')
              ? (settings.consolidationProvider ?? null)
              : state.consolidationProvider,
            memoryConsolidationMode: hasOwnSetting(settings, 'memoryConsolidationMode')
              ? normalizeMemoryConsolidationMode(settings.memoryConsolidationMode)
              : state.memoryConsolidationMode,
            compactionProvider: hasOwnSetting(settings, 'compactionProvider')
              ? (settings.compactionProvider ?? null)
              : state.compactionProvider,
            compactionModel: hasOwnSetting(settings, 'compactionModel')
              ? (settings.compactionModel ?? null)
              : state.compactionModel,
            disableLongTermMemory: hasOwnSetting(settings, 'disableLongTermMemory')
              ? Boolean(settings.disableLongTermMemory)
              : state.disableLongTermMemory,
          };
        }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage<AppSettings>(() => AsyncStorage),
      version: SETTINGS_STORE_VERSION,
      migrate: migrateSettingsState,
      partialize: partializeSettingsState,
    },
  ),
);
