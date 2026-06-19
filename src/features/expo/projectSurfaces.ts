import {
  buildExpoProjectSnapshot,
  buildExpoProjectSnapshots,
  getExpoProjectPlatforms,
  type ExpoProjectSnapshot,
} from '../../services/expo/projectCatalog';
import type { ExpoProjectReadiness } from '../../services/expo/contracts';
import type { AppSettings } from '../../types/settings';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;

export interface ExpoProjectSurface extends ExpoProjectSnapshot {
  modeLabel: string;
  readinessLabel: string;
  badgeTone: 'ready' | 'warn';
  platformText: string;
  ownerSlugLabel: string;
}

export function getLocalizedExpoModeLabel(
  t: TranslationFn,
  mode?: ExpoProjectConfig['mode'],
): string {
  switch (mode) {
    case 'eas-workflow':
      return t('settings.expoExecutionModeEasWorkflow');
    case 'github-workflow':
      return t('settings.expoExecutionModeGithubWorkflow');
    case 'direct-ssh':
    default:
      return t('settings.expoExecutionModeDirectSsh');
  }
}

export function getLocalizedExpoReadinessLabel(
  t: TranslationFn,
  readiness: ExpoProjectReadiness,
): string {
  switch (readiness.reason) {
    case 'disabled':
      return t('remoteWork.disabledTarget');
    case 'missing-account':
      return t('remoteWork.expoReadinessMissingAccount');
    case 'missing-owner':
      return t('remoteWork.expoReadinessMissingOwner');
    case 'missing-slug':
      return t('remoteWork.expoReadinessMissingSlug');
    case 'missing-expo-token':
      return t('remoteWork.expoReadinessMissingExpoToken');
    case 'missing-linked-repo':
      return t('remoteWork.expoReadinessMissingLinkedRepo');
    case 'missing-ssh-target':
      return t('remoteWork.expoReadinessMissingSshTarget');
    case 'missing-project-path':
      return t('remoteWork.expoReadinessMissingProjectPath');
    case 'missing-workflow-file':
      return t('remoteWork.expoReadinessMissingWorkflowFile');
    case 'missing-github-token':
      return t('remoteWork.expoReadinessMissingGithubToken');
    case 'ready':
    default:
      return t('remoteWork.statusReady');
  }
}

export function buildExpoProjectSurface(
  project: ExpoProjectConfig,
  accounts: ExpoAccountConfig[],
  settings: Pick<AppSettings, 'sshTargets'>,
  t: TranslationFn,
): ExpoProjectSurface {
  const snapshot = buildExpoProjectSnapshot(
    project,
    accounts.find((account) => account.id === project.accountId),
    settings,
  );

  return {
    ...snapshot,
    modeLabel: getLocalizedExpoModeLabel(t, snapshot.mode),
    readinessLabel: getLocalizedExpoReadinessLabel(t, snapshot.readiness),
    badgeTone: snapshot.readiness.launchable ? 'ready' : 'warn',
    platformText: getExpoProjectPlatforms(snapshot.platforms).join(', '),
    ownerSlugLabel: `${snapshot.owner}/${snapshot.slug}`,
  };
}

export function buildExpoProjectSurfaces(
  projects: ExpoProjectConfig[],
  accounts: ExpoAccountConfig[],
  settings: Pick<AppSettings, 'sshTargets'>,
  t: TranslationFn,
): ExpoProjectSurface[] {
  const snapshots = buildExpoProjectSnapshots(projects, accounts, settings);
  return snapshots.map((snapshot) => ({
    ...snapshot,
    modeLabel: getLocalizedExpoModeLabel(t, snapshot.mode),
    readinessLabel: getLocalizedExpoReadinessLabel(t, snapshot.readiness),
    badgeTone: snapshot.readiness.launchable ? 'ready' : 'warn',
    platformText: snapshot.platforms.join(', '),
    ownerSlugLabel: `${snapshot.owner}/${snapshot.slug}`,
  }));
}
