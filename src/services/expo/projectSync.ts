import { useSettingsStore } from '../../store/useSettingsStore';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import type {
  ExpoAccountProjectInfo,
  ExpoAccountProjectsSyncResult,
  ExpoProjectListing,
} from './contracts';
import {
  getExpoAccounts,
  getExpoProjectDisplayOwner,
  getExpoProjectFullName,
  getExpoProjects,
  normalizeExpoProjectRef,
  resolveExpoAccount,
} from './projectState';
import { resolveExpoAccountToken } from './secrets';
import {
  canUseExpoHostedWorkflow,
  selectDefaultWorkflowFile,
  uniqueWorkflowFiles,
} from './workflowSelection';
import {
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
} from './projectAutomation';
import { fetchExpoAccountProjectsAsync } from './projectRemote';
function mergeSyncedExpoProjects(
  existingProjects: ExpoProjectConfig[],
  account: ExpoAccountConfig,
  discoveredProjects: ExpoAccountProjectInfo[],
  syncedAt: number,
): ExpoProjectConfig[] {
  const retainedProjects = existingProjects.filter((project) => project.accountId !== account.id);
  const existingAccountProjects = existingProjects.filter(
    (project) => project.accountId === account.id,
  );
  const matchedExistingIds = new Set<string>();

  const syncedProjects = discoveredProjects.map((discoveredProject) => {
    const matchedProject = existingAccountProjects.find((project) => {
      if (
        project.id === discoveredProject.projectId ||
        project.easProjectId === discoveredProject.projectId
      ) {
        return true;
      }
      return (
        normalizeExpoProjectRef(getExpoProjectFullName(project, account)) ===
        normalizeExpoProjectRef(discoveredProject.fullName)
      );
    });

    if (matchedProject) {
      matchedExistingIds.add(matchedProject.id);
    }

    const repoFullName = matchedProject?.repoFullName || discoveredProject.repoFullName;
    const availableWorkflowFiles =
      uniqueWorkflowFiles(discoveredProject.availableWorkflowFiles) ||
      matchedProject?.availableWorkflowFiles;
    const workflowFile =
      matchedProject?.workflowFile ||
      selectDefaultWorkflowFile(discoveredProject.availableWorkflowFiles);
    const mode = canUseExpoHostedWorkflow(
      {
        repoFullName,
        workflowFile,
        availableWorkflowFiles,
      },
      account,
    )
      ? 'eas-workflow'
      : matchedProject?.mode || 'eas-workflow';

    return {
      ...matchedProject,
      id: matchedProject?.id || discoveredProject.projectId,
      easProjectId: discoveredProject.projectId,
      name:
        discoveredProject.name ||
        matchedProject?.name ||
        `${discoveredProject.owner}/${discoveredProject.slug}`,
      accountId: account.id,
      owner: discoveredProject.owner,
      slug: discoveredProject.slug,
      source: 'account-sync' as const,
      lastSyncedAt: syncedAt,
      enabled: matchedProject?.enabled ?? true,
      mode,
      repoFullName,
      repoDefaultBranch: matchedProject?.repoDefaultBranch || discoveredProject.repoDefaultBranch,
      availableWorkflowFiles,
      workflowFile,
      workflowRef: matchedProject?.workflowRef,
      defaultBuildProfile: matchedProject?.defaultBuildProfile || 'production',
      defaultUpdateBranch: matchedProject?.defaultUpdateBranch || 'production',
      updateChannel: matchedProject?.updateChannel || 'production',
      platforms: matchedProject?.platforms?.length
        ? matchedProject.platforms
        : (['android', 'ios', 'web'] satisfies Array<'android' | 'ios' | 'web'>),
    };
  });

  const unmatchedProjects = existingAccountProjects.filter(
    (project) => !matchedExistingIds.has(project.id),
  );
  return [...retainedProjects, ...syncedProjects, ...unmatchedProjects];
}

export async function syncExpoAccountProjects(
  accountId: string,
): Promise<ExpoAccountProjectsSyncResult> {
  const settings = useSettingsStore.getState();
  const account = resolveExpoAccount(accountId, settings);
  const token = await resolveExpoAccountToken(account);
  const syncedAt = Date.now();

  try {
    const projects = await fetchExpoAccountProjectsAsync(account, token);
    useSettingsStore.setState((current) => ({
      expoAccounts: (current.expoAccounts || []).map((entry) =>
        entry.id === account.id
          ? {
              ...entry,
              lastProjectSyncAt: syncedAt,
              lastProjectSyncError: undefined,
              syncedProjectCount: projects.length,
            }
          : entry,
      ),
      expoProjects: mergeSyncedExpoProjects(
        current.expoProjects || [],
        account,
        projects,
        syncedAt,
      ),
    }));

    return {
      accountId: account.id,
      syncedAt,
      projectCount: projects.length,
      projects,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'expo-project-sync-failed';
    useSettingsStore.setState((current) => ({
      expoAccounts: (current.expoAccounts || []).map((entry) =>
        entry.id === account.id
          ? {
              ...entry,
              lastProjectSyncAt: syncedAt,
              lastProjectSyncError: message,
            }
          : entry,
      ),
    }));
    throw error;
  }
}

export async function syncAllExpoAccountProjects(
  accountIds?: string[],
): Promise<ExpoAccountProjectsSyncResult[]> {
  const accounts = getExpoAccounts().filter(
    (account) =>
      account.enabled && account.tokenRef && (!accountIds || accountIds.includes(account.id)),
  );
  const results = await Promise.allSettled(
    accounts.map((account) => syncExpoAccountProjects(account.id)),
  );
  return results
    .filter(
      (result): result is PromiseFulfilledResult<ExpoAccountProjectsSyncResult> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);
}

export async function listExpoProjects(options?: {
  accountId?: string;
  refresh?: boolean;
}): Promise<ExpoProjectListing[]> {
  if (options?.refresh) {
    if (options.accountId) {
      await syncExpoAccountProjects(options.accountId);
    } else {
      await syncAllExpoAccountProjects();
    }
  }

  const settings = useSettingsStore.getState();
  const accountMap = new Map(getExpoAccounts(settings).map((account) => [account.id, account]));

  return (getExpoProjects(settings) || [])
    .filter((project) => !options?.accountId || project.accountId === options.accountId)
    .map((project) => {
      const account = accountMap.get(project.accountId);
      const readiness = getExpoProjectReadiness(project, account, settings);
      const mode = getExpoProjectExecutionMode(project, account);
      return {
        id: project.id,
        easProjectId: project.easProjectId,
        name: project.name,
        fullName: getExpoProjectFullName(project, account),
        owner: getExpoProjectDisplayOwner(project, account),
        slug: project.slug,
        accountId: project.accountId,
        accountName: account?.name,
        source: project.source,
        mode,
        repoFullName: project.repoFullName,
        availableWorkflowFiles: project.availableWorkflowFiles,
        lastSyncedAt: project.lastSyncedAt,
        readiness: {
          ...readiness,
          label: getExpoProjectReadinessLabel(readiness),
        },
      } satisfies ExpoProjectListing;
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export type ExpoProjectExecutionResolution =
  | {
      status: 'resolved';
      project: ExpoProjectListing;
      candidates: ExpoProjectListing[];
      reason:
        | 'project-ref'
        | 'repo-match'
        | 'single-launchable'
        | 'single-enabled-project'
        | 'single-candidate';
      synced: boolean;
    }
  | {
      status: 'ambiguous';
      candidates: ExpoProjectListing[];
      reason: 'multiple-launchable' | 'multiple-candidates';
      synced: boolean;
    }
  | {
      status: 'not_found';
      candidates: ExpoProjectListing[];
      reason: 'no-projects' | 'no-matching-project';
      synced: boolean;
    };
