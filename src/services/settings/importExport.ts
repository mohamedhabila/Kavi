// ---------------------------------------------------------------------------
// Kavi — Settings Import/Export
// ---------------------------------------------------------------------------
// Backup and restore all app settings, hooks, and skill configurations.

import type { ExportedSettings, AppSettings, HookDefinition } from '../../types';
import type { SkillEntry } from '../skills/types';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSkillsStore } from '../skills/manager';
import { getLoadedHooks } from '../hooks/loader';
import { i18n } from '../../i18n/manager';

const EXPORT_VERSION = 1;

const PROVIDER_API_KEYS_WARNING = "API keys were not exported — you'll need to re-enter them";
const MCP_SECRETS_WARNING =
  "MCP tokens, header values, and OAuth client secrets were not exported — you'll need to re-enter them";
const SSH_SECRETS_WARNING =
  "SSH credentials were not exported — you'll need to re-enter passwords or private keys";
const WORKSPACE_TOKENS_WARNING =
  "Workspace access tokens were not exported — you'll need to re-enter them";
const BROWSER_KEYS_WARNING =
  "Browser provider API keys were not exported — you'll need to re-enter them";
const EXPO_ACCOUNT_TOKENS_WARNING =
  "Expo account tokens were not exported — you'll need to re-enter them";
const EXPO_PROJECT_TOKENS_WARNING =
  "Expo project GitHub tokens were not exported — you'll need to re-enter them";

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const LOCALES = ['en', 'zh-CN', 'zh-TW', 'pt-BR', 'de', 'es', 'ar', 'fr', 'ja'] as const;
const WEB_SEARCH_PROVIDERS = ['auto', 'brave', 'perplexity', 'grok', 'kimi', 'gemini'] as const;
// 'direct' is accepted for backwards compatibility with exports created before
// the 2026-04-29 rename to 'chitchat'. New exports always emit 'chitchat'.
const LEGACY_CONVERSATION_MODE_ALIASES: Record<string, 'agentic' | 'chitchat'> = {
  direct: 'chitchat',
};

function normalizeConversationMode(
  value: unknown,
): 'agentic' | 'chitchat' | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'agentic' || value === 'chitchat') return value;
  return LEGACY_CONVERSATION_MODE_ALIASES[value];
}
const THEMES = ['light', 'dark', 'system'] as const;

type LlmProviderConfig = AppSettings['providers'][number];
type McpServerConfig = AppSettings['mcpServers'][number];
type SshTargetConfig = NonNullable<AppSettings['sshTargets']>[number];
type WorkspaceTargetConfig = NonNullable<AppSettings['workspaceTargets']>[number];
type BrowserProviderConfig = NonNullable<AppSettings['browserProviders']>[number];
type ExpoAccountConfig = NonNullable<AppSettings['expoAccounts']>[number];
type ExpoProjectConfig = NonNullable<AppSettings['expoProjects']>[number];

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function sanitizeHeadersForExport(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const headerKeys = Object.keys(headers).filter((key) => key.trim().length > 0);
  if (headerKeys.length === 0) {
    return undefined;
  }

  return Object.fromEntries(headerKeys.map((key) => [key, '']));
}

function sanitizeProviderForExport(provider: LlmProviderConfig): LlmProviderConfig {
  return {
    ...provider,
    apiKey: '',
    apiKeyRef: undefined,
  };
}

function sanitizeMcpServerForExport(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    token: '',
    tokenRef: undefined,
    headers: sanitizeHeadersForExport(server.headers),
    oauth: server.oauth
      ? {
          ...server.oauth,
          clientSecretRef: undefined,
        }
      : undefined,
  };
}

function sanitizeSshTargetForExport(target: SshTargetConfig): SshTargetConfig {
  return {
    ...target,
    passwordRef: undefined,
    privateKeyRef: undefined,
    passphraseRef: undefined,
  };
}

function sanitizeWorkspaceTargetForExport(target: WorkspaceTargetConfig): WorkspaceTargetConfig {
  return {
    ...target,
    accessTokenRef: undefined,
  };
}

function sanitizeBrowserProviderForExport(provider: BrowserProviderConfig): BrowserProviderConfig {
  return {
    ...provider,
    apiKeyRef: undefined,
  };
}

function sanitizeExpoAccountForExport(account: ExpoAccountConfig): ExpoAccountConfig {
  return {
    ...account,
    tokenRef: undefined,
  };
}

function sanitizeExpoProjectForExport(project: ExpoProjectConfig): ExpoProjectConfig {
  return {
    ...project,
    githubTokenRef: undefined,
  };
}

function buildOmittedSensitiveDataWarnings(
  state: ReturnType<typeof useSettingsStore.getState>,
): string[] {
  const warnings: string[] = [];

  if (
    (state.sshTargets || []).some(
      (target) => target.passwordRef || target.privateKeyRef || target.passphraseRef,
    )
  ) {
    addWarning(warnings, SSH_SECRETS_WARNING);
  }

  if ((state.workspaceTargets || []).some((target) => target.accessTokenRef)) {
    addWarning(warnings, WORKSPACE_TOKENS_WARNING);
  }

  if ((state.browserProviders || []).some((provider) => provider.apiKeyRef)) {
    addWarning(warnings, BROWSER_KEYS_WARNING);
  }

  if ((state.expoAccounts || []).some((account) => account.tokenRef)) {
    addWarning(warnings, EXPO_ACCOUNT_TOKENS_WARNING);
  }

  if ((state.expoProjects || []).some((project) => project.githubTokenRef)) {
    addWarning(warnings, EXPO_PROJECT_TOKENS_WARNING);
  }

  return warnings;
}

function sanitizeImportedProvider(provider: LlmProviderConfig): LlmProviderConfig {
  return sanitizeProviderForExport(provider);
}

function sanitizeImportedMcpServer(server: McpServerConfig): McpServerConfig {
  return sanitizeMcpServerForExport(server);
}

function sanitizeImportedSshTarget(target: SshTargetConfig): SshTargetConfig {
  return sanitizeSshTargetForExport(target);
}

function sanitizeImportedWorkspaceTarget(target: WorkspaceTargetConfig): WorkspaceTargetConfig {
  return sanitizeWorkspaceTargetForExport(target);
}

function sanitizeImportedBrowserProvider(provider: BrowserProviderConfig): BrowserProviderConfig {
  return sanitizeBrowserProviderForExport(provider);
}

function sanitizeImportedExpoAccount(account: ExpoAccountConfig): ExpoAccountConfig {
  return sanitizeExpoAccountForExport(account);
}

function sanitizeImportedExpoProject(project: ExpoProjectConfig): ExpoProjectConfig {
  return sanitizeExpoProjectForExport(project);
}

function isValidLastUsedModelSelection(
  value: unknown,
): value is NonNullable<AppSettings['lastUsedModel']> {
  return (
    isPlainRecord(value) &&
    typeof value.providerId === 'string' &&
    value.providerId.trim().length > 0 &&
    typeof value.model === 'string' &&
    value.model.trim().length > 0
  );
}

// ── Export ────────────────────────────────────────────────────────────────

export function exportSettings(): ExportedSettings {
  const state = useSettingsStore.getState();
  const skills = useSkillsStore.getState().entries;
  const hooks = getLoadedHooks();
  const omittedSensitiveData = buildOmittedSensitiveDataWarnings(state);

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    settings: {
      providers: state.providers.map(sanitizeProviderForExport),
      mcpServers: state.mcpServers.map(sanitizeMcpServerForExport),
      activeProviderId: state.activeProviderId,
      activeModel: state.activeModel,
      sshTargets: state.sshTargets?.map(sanitizeSshTargetForExport),
      workspaceTargets: state.workspaceTargets?.map(sanitizeWorkspaceTargetForExport),
      browserProviders: state.browserProviders?.map(sanitizeBrowserProviderForExport),
      expoAccounts: state.expoAccounts?.map(sanitizeExpoAccountForExport),
      expoProjects: state.expoProjects?.map(sanitizeExpoProjectForExport),
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
    },
    ...(omittedSensitiveData.length > 0 ? { omittedSensitiveData } : {}),
    hooks: hooks.map((h) => ({ ...h })),
    skills: skills.map((s) => ({
      metadata: s.metadata,
      source: s.source,
      systemPrompt: s.systemPrompt,
      hooks: s.hooks,
    })),
  };
}

export function exportSettingsToJson(): string {
  return JSON.stringify(exportSettings(), null, 2);
}

// ── Import ────────────────────────────────────────────────────────────────

export interface ImportResult {
  success: boolean;
  imported: {
    providers: number;
    mcpServers: number;
    hooks: number;
    skills: number;
  };
  warnings: string[];
  error?: string;
}

export function importSettings(data: string | ExportedSettings): ImportResult {
  const warnings: string[] = [];
  const imported = {
    providers: 0,
    mcpServers: 0,
    hooks: 0,
    skills: 0,
  };

  try {
    const parsed: ExportedSettings = typeof data === 'string' ? JSON.parse(data) : data;

    if (!parsed.version || parsed.version > EXPORT_VERSION) {
      return {
        success: false,
        imported,
        warnings: [],
        error: `Unsupported export version: ${parsed.version}`,
      };
    }

    if (Array.isArray(parsed.omittedSensitiveData)) {
      for (const warning of parsed.omittedSensitiveData) {
        if (typeof warning === 'string' && warning.trim()) {
          addWarning(warnings, warning.trim());
        }
      }
    }

    // Import settings
    if (parsed.settings) {
      const settingsUpdate: Partial<AppSettings> = {};
      const settings = parsed.settings;

      if (Array.isArray(settings.providers)) {
        settingsUpdate.providers = settings.providers.map(sanitizeImportedProvider);
        imported.providers = settings.providers.length;
        addWarning(warnings, PROVIDER_API_KEYS_WARNING);
      }

      if (Array.isArray(settings.mcpServers)) {
        settingsUpdate.mcpServers = settings.mcpServers.map(sanitizeImportedMcpServer);
        imported.mcpServers = settings.mcpServers.length;
        addWarning(warnings, MCP_SECRETS_WARNING);
      }

      if (Array.isArray(settings.sshTargets)) {
        settingsUpdate.sshTargets = settings.sshTargets.map(sanitizeImportedSshTarget);
      }
      if (Array.isArray(settings.workspaceTargets)) {
        settingsUpdate.workspaceTargets = settings.workspaceTargets.map(
          sanitizeImportedWorkspaceTarget,
        );
      }
      if (Array.isArray(settings.browserProviders)) {
        settingsUpdate.browserProviders = settings.browserProviders.map(
          sanitizeImportedBrowserProvider,
        );
      }
      if (Array.isArray(settings.expoAccounts)) {
        settingsUpdate.expoAccounts = settings.expoAccounts.map(sanitizeImportedExpoAccount);
      }
      if (Array.isArray(settings.expoProjects)) {
        settingsUpdate.expoProjects = settings.expoProjects.map(sanitizeImportedExpoProject);
      }

      if (isOneOf(settings.theme, THEMES)) settingsUpdate.theme = settings.theme;
      if (hasOwn(settings, 'systemPrompt') && typeof settings.systemPrompt === 'string') {
        settingsUpdate.systemPrompt = settings.systemPrompt;
      }
      if (
        hasOwn(settings, 'activeProviderId') &&
        (typeof settings.activeProviderId === 'string' || settings.activeProviderId === null)
      ) {
        settingsUpdate.activeProviderId = settings.activeProviderId;
      }
      if (
        hasOwn(settings, 'activeModel') &&
        (typeof settings.activeModel === 'string' || settings.activeModel === null)
      ) {
        settingsUpdate.activeModel = settings.activeModel;
      }
      if (hasOwn(settings, 'lastUsedModel')) {
        settingsUpdate.lastUsedModel = isValidLastUsedModelSelection(settings.lastUsedModel)
          ? settings.lastUsedModel
          : null;
      }
      if (isOneOf(settings.thinkingLevel, THINKING_LEVELS))
        settingsUpdate.thinkingLevel = settings.thinkingLevel;
      if (isOneOf(settings.locale, LOCALES)) settingsUpdate.locale = settings.locale;
      if (isOneOf(settings.webSearchProvider, WEB_SEARCH_PROVIDERS))
        settingsUpdate.webSearchProvider = settings.webSearchProvider;
      if (typeof settings.linkUnderstandingEnabled === 'boolean')
        settingsUpdate.linkUnderstandingEnabled = settings.linkUnderstandingEnabled;
      if (typeof settings.mediaUnderstandingEnabled === 'boolean')
        settingsUpdate.mediaUnderstandingEnabled = settings.mediaUnderstandingEnabled;
      if (typeof settings.maxLinks === 'number' && Number.isFinite(settings.maxLinks))
        settingsUpdate.maxLinks = Math.max(1, Math.min(10, Math.floor(settings.maxLinks)));
      const importedConversationMode = normalizeConversationMode(settings.defaultConversationMode);
      if (importedConversationMode)
        settingsUpdate.defaultConversationMode = importedConversationMode;

      if (
        Array.isArray(settings.sshTargets) &&
        settings.sshTargets.some(
          (target) => target.passwordRef || target.privateKeyRef || target.passphraseRef,
        )
      ) {
        addWarning(warnings, SSH_SECRETS_WARNING);
      }
      if (
        Array.isArray(settings.workspaceTargets) &&
        settings.workspaceTargets.some((target) => target.accessTokenRef)
      ) {
        addWarning(warnings, WORKSPACE_TOKENS_WARNING);
      }
      if (
        Array.isArray(settings.browserProviders) &&
        settings.browserProviders.some((provider) => provider.apiKeyRef)
      ) {
        addWarning(warnings, BROWSER_KEYS_WARNING);
      }
      if (
        Array.isArray(settings.expoAccounts) &&
        settings.expoAccounts.some((account) => account.tokenRef)
      ) {
        addWarning(warnings, EXPO_ACCOUNT_TOKENS_WARNING);
      }
      if (
        Array.isArray(settings.expoProjects) &&
        settings.expoProjects.some((project) => project.githubTokenRef)
      ) {
        addWarning(warnings, EXPO_PROJECT_TOKENS_WARNING);
      }

      useSettingsStore.getState().replaceAllSettings(settingsUpdate);
      if (settingsUpdate.locale) {
        void i18n.setLocale(settingsUpdate.locale);
      }
    }

    // Import skills
    if (Array.isArray(parsed.skills)) {
      for (const skill of parsed.skills) {
        if (skill.metadata && skill.source) {
          const entry: SkillEntry = {
            id: `imported_${Date.now()}_${imported.skills}`,
            metadata: skill.metadata,
            enabled: true,
            installedAt: Date.now(),
            source: {
              ...skill.source,
              managedDir: undefined,
              managedFiles: undefined,
              managedBinaryFiles: undefined,
            },
            systemPrompt: skill.systemPrompt,
            hooks: skill.hooks,
          };
          useSkillsStore.getState().addEntry(entry);
          imported.skills++;
        }
      }
    }

    // Note: hooks need to be saved to files and reloaded
    if (Array.isArray(parsed.hooks)) {
      imported.hooks = parsed.hooks.length;
      addWarning(warnings, 'Hooks were noted but need to be saved via the Hooks screen');
    }

    return { success: true, imported, warnings };
  } catch (err: unknown) {
    return {
      success: false,
      imported,
      warnings,
      error: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Validate an export file before importing
 */
export function validateExportFile(data: string): { valid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(data);
    if (!parsed.version) return { valid: false, error: 'Missing version field' };
    if (!parsed.exportedAt) return { valid: false, error: 'Missing exportedAt field' };
    if (!parsed.settings) return { valid: false, error: 'Missing settings field' };
    return { valid: true };
  } catch (err: unknown) {
    return {
      valid: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
