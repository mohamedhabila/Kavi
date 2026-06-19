import type { AppSettings } from '../types/settings';
import type { ExpoProjectConfig, SshTargetConfig, WorkspaceTargetConfig } from '../types/remote';
import type { LlmProviderConfig } from '../types/provider';
import type { WebSearchProvider } from '../types/tool';
import { finalizeProviderConfig } from '../constants/api';
import {
  getWorkspaceTargetDisplayName,
  normalizeWorkspaceTargetLinks,
  resolveDefaultWorkspaceTargetId,
} from '../services/workspaces/config';

export function hasOwnSetting(settings: Partial<AppSettings>, key: keyof AppSettings): boolean {
  return Object.prototype.hasOwnProperty.call(settings, key);
}

const VALID_WEB_SEARCH_PROVIDERS: readonly WebSearchProvider[] = [
  'auto',
  'brave',
  'gemini',
  'perplexity',
  'grok',
  'kimi',
];

export function sanitizeWebSearchProvider(provider: unknown): WebSearchProvider {
  return VALID_WEB_SEARCH_PROVIDERS.includes(provider as WebSearchProvider)
    ? (provider as WebSearchProvider)
    : 'auto';
}

export function normalizeProviders(
  providers: LlmProviderConfig[] | undefined,
): LlmProviderConfig[] {
  return (providers || []).map((provider) => finalizeProviderConfig(provider));
}

type WorkspaceLinkSettings = Pick<AppSettings, 'browserProviders' | 'sshTargets'>;

export function normalizeWorkspaceTargetForState(
  target: WorkspaceTargetConfig,
  settings: WorkspaceLinkSettings,
): WorkspaceTargetConfig {
  const namedTarget: WorkspaceTargetConfig = {
    ...target,
    name: getWorkspaceTargetDisplayName(target),
  };

  return normalizeWorkspaceTargetLinks(namedTarget, settings);
}

export function sanitizeWorkspaceTargetsForState(
  workspaceTargets: WorkspaceTargetConfig[] | undefined,
  settings: WorkspaceLinkSettings,
): WorkspaceTargetConfig[] {
  return (workspaceTargets || []).map((target) =>
    normalizeWorkspaceTargetForState(target, settings),
  );
}

export function sanitizeDefaultWorkspaceTargetIdForState(options: {
  defaultWorkspaceTargetId?: string | null;
  workspaceTargets?: WorkspaceTargetConfig[];
}): string | null {
  return resolveDefaultWorkspaceTargetId(options);
}

export function sanitizeExpoProjectsForSshTargets(
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

export function clampMaxLinks(maxLinks: number): number {
  return Math.max(1, Math.min(10, maxLinks));
}
