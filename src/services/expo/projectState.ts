import { useSettingsStore } from '../../store/useSettingsStore';
import type { AppSettings } from '../../types/settings';
import type { ExpoAccountConfig, ExpoProjectConfig, SshTargetConfig } from '../../types/remote';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function trimToUndefined(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function normalizeRepo(value?: string): string | undefined {
  return trimToUndefined(value);
}

function slugifyExpoProjectName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'expo-project';
}

function normalizeExpoOwner(value?: string | null): string {
  return trimToUndefined(value)?.replace(/^@+/, '') || '';
}

function normalizeExpoProjectRef(value: string): string {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('@') ? trimmed.toLowerCase() : `@${trimmed.toLowerCase()}`;
}

function getExpoProjectSlug(project: { slug?: string | null }): string | undefined {
  return trimToUndefined(project.slug);
}

function requireExpoProjectPath(project: Pick<ExpoProjectConfig, 'projectPath'>): string {
  const projectPath = trimToUndefined(project.projectPath);
  if (!projectPath) {
    throw new Error('missing-project-path');
  }
  return projectPath;
}

function requireGitHubWorkflowRepo(project: Pick<ExpoProjectConfig, 'repoFullName'>): string {
  const repo = normalizeRepo(project.repoFullName);
  if (!repo) {
    throw new Error('missing-linked-repo');
  }
  return repo;
}

function requireGitHubWorkflowFile(project: Pick<ExpoProjectConfig, 'workflowFile'>): string {
  const workflowFile = trimToUndefined(project.workflowFile);
  if (!workflowFile) {
    throw new Error('missing-workflow-file');
  }
  return workflowFile;
}

function getExpoAccounts(
  settings?: Partial<Pick<AppSettings, 'expoAccounts'>>,
): ExpoAccountConfig[] {
  return settings?.expoAccounts || useSettingsStore.getState().expoAccounts || [];
}

function getExpoProjects(
  settings?: Partial<Pick<AppSettings, 'expoProjects'>>,
): ExpoProjectConfig[] {
  return settings?.expoProjects || useSettingsStore.getState().expoProjects || [];
}

function getSshTargets(settings?: Partial<Pick<AppSettings, 'sshTargets'>>): SshTargetConfig[] {
  return settings?.sshTargets || useSettingsStore.getState().sshTargets || [];
}

export function getExpoProjectDisplayOwner(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
): string {
  return normalizeExpoOwner(project.owner) || normalizeExpoOwner(account?.owner) || 'owner';
}

export function getExpoProjectFullName(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
): string {
  const owner = getExpoProjectDisplayOwner(project, account);
  const slug = getExpoProjectSlug(project) || slugifyExpoProjectName(project.name || 'project');
  return `@${owner}/${slug}`;
}

export function resolveExpoAccount(
  accountId: string,
  settings?: Pick<AppSettings, 'expoAccounts'>,
): ExpoAccountConfig {
  const account = getExpoAccounts(settings).find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error('expo-account-not-found');
  }
  return account;
}

export function resolveExpoProject(
  projectId: string,
  settings?: Partial<Pick<AppSettings, 'expoProjects' | 'expoAccounts'>>,
): ExpoProjectConfig {
  const normalizedProjectRef = normalizeExpoProjectRef(projectId);
  const accountMap = new Map(getExpoAccounts(settings).map((entry) => [entry.id, entry]));
  const project = getExpoProjects(settings).find((entry) => {
    if (entry.id === projectId || entry.easProjectId === projectId) {
      return true;
    }

    const entrySlug = getExpoProjectSlug(entry);
    if (!entrySlug) {
      return false;
    }

    const entryFullName = normalizeExpoProjectRef(
      getExpoProjectFullName(entry, accountMap.get(entry.accountId)),
    );
    return Boolean(normalizedProjectRef) && entryFullName === normalizedProjectRef;
  });

  if (!project) {
    throw new Error('expo-project-not-found');
  }
  return project;
}

export function resolveExpoProjectSshTarget(
  project: ExpoProjectConfig,
  settings?: Pick<AppSettings, 'sshTargets'>,
): SshTargetConfig {
  const target = getSshTargets(settings).find((entry) => entry.id === project.sshTargetId);
  if (!target) {
    throw new Error('expo-ssh-target-not-found');
  }
  return target;
}

export {
  shellQuote,
  trimToUndefined,
  normalizeRepo,
  slugifyExpoProjectName,
  normalizeExpoOwner,
  normalizeExpoProjectRef,
  getExpoProjectSlug,
  requireExpoProjectPath,
  requireGitHubWorkflowRepo,
  requireGitHubWorkflowFile,
  getExpoAccounts,
  getExpoProjects,
  getSshTargets,
};
