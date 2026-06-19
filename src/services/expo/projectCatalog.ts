import { getExpoProjectDisplayOwner } from './projectState';
import { getExpoProjectExecutionMode, getExpoProjectReadiness } from './projectAutomation';
import { getExpoProjectPublicUrls } from './projectUrls';
import type { ExpoProjectReadiness, ExpoPublicUrl } from './contracts';
import type { AppSettings } from '../../types/settings';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';

const DEFAULT_EXPO_PLATFORMS: Array<'android' | 'ios' | 'web'> = ['android', 'ios', 'web'];

export interface ExpoProjectSnapshot {
  project: ExpoProjectConfig;
  account?: ExpoAccountConfig;
  id: string;
  easProjectId?: string;
  name: string;
  slug: string;
  owner: string;
  fullName: string;
  accountId: string;
  accountName?: string;
  source?: ExpoProjectConfig['source'];
  mode: ExpoProjectConfig['mode'];
  readiness: ExpoProjectReadiness;
  repoFullName?: string;
  repoDefaultBranch?: string;
  workflowFile?: string;
  availableWorkflowFiles?: string[];
  projectPath?: string;
  platforms: Array<'android' | 'ios' | 'web'>;
  publicUrls?: ExpoPublicUrl[];
  webUrl?: string;
  previewUrl?: string;
  customDomain?: string;
  lastSyncedAt?: number;
}

export function getExpoModeSummaryLabel(mode: ExpoProjectConfig['mode']): string {
  switch (mode) {
    case 'eas-workflow':
      return 'Expo workflow';
    case 'github-workflow':
      return 'GitHub workflow';
    case 'direct-ssh':
    default:
      return 'Direct EAS CLI';
  }
}

export function getExpoProjectPlatforms(
  platforms?: ExpoProjectConfig['platforms'],
): Array<'android' | 'ios' | 'web'> {
  return platforms?.length ? [...platforms] : [...DEFAULT_EXPO_PLATFORMS];
}

export function buildExpoProjectSnapshot(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
  settings?: Pick<AppSettings, 'sshTargets'>,
): ExpoProjectSnapshot {
  const owner = getExpoProjectDisplayOwner(project, account);
  const slug = project.slug;
  const platforms = getExpoProjectPlatforms(project.platforms);
  const publicUrls = getExpoProjectPublicUrls(project);
  const webUrl = publicUrls?.find((entry) => entry.label === 'web')?.url;
  const previewUrl = publicUrls?.find((entry) => entry.label === 'preview')?.url;
  const customDomain = publicUrls?.find((entry) => entry.label === 'custom-domain')?.url;

  return {
    project,
    account,
    id: project.id,
    easProjectId: project.easProjectId,
    name: project.name,
    slug,
    owner,
    fullName: `@${owner}/${slug}`,
    accountId: project.accountId,
    accountName: account?.name,
    source: project.source,
    mode: getExpoProjectExecutionMode(project, account),
    readiness: getExpoProjectReadiness(project, account, settings),
    repoFullName: project.repoFullName,
    repoDefaultBranch: project.repoDefaultBranch,
    workflowFile: project.workflowFile,
    availableWorkflowFiles: project.availableWorkflowFiles,
    projectPath: project.projectPath,
    platforms,
    publicUrls,
    webUrl,
    previewUrl,
    customDomain,
    lastSyncedAt: project.lastSyncedAt,
  };
}

export function buildExpoProjectSnapshots(
  projects: ExpoProjectConfig[],
  accounts: ExpoAccountConfig[],
  settings?: Pick<AppSettings, 'sshTargets'>,
): ExpoProjectSnapshot[] {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  return projects.map((project) =>
    buildExpoProjectSnapshot(project, accountMap.get(project.accountId), settings),
  );
}
