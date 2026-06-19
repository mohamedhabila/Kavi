import { useSettingsStore } from "../../store/useSettingsStore";
import type { ExpoProjectListing } from "./contracts";
import { getExpoAccounts, normalizeExpoProjectRef, normalizeRepo, trimToUndefined } from "./projectState";
import { listExpoProjects } from "./projectSync";
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

function normalizeRepoForComparison(value: string | undefined): string {
  return normalizeRepo(value)?.toLowerCase() ?? '';
}

function matchesExpoProjectRef(project: ExpoProjectListing, projectRef: string): boolean {
  const normalizedRef = normalizeExpoProjectRef(projectRef);
  if (!normalizedRef && !projectRef.trim()) {
    return false;
  }

  return (
    project.id === projectRef ||
    project.easProjectId === projectRef ||
    normalizeExpoProjectRef(project.fullName) === normalizedRef ||
    project.slug.toLowerCase() === projectRef.trim().toLowerCase()
  );
}

function chooseExpoProjectExecutionCandidate(
  projects: ExpoProjectListing[],
  options?: {
    projectRef?: string;
    repoFullName?: string;
  },
  synced = false,
): ExpoProjectExecutionResolution {
  const enabledProjects = projects.filter((project) => project.readiness.reason !== 'disabled');
  const requestedRef = trimToUndefined(options?.projectRef);
  if (requestedRef) {
    const matches = enabledProjects.filter((project) => matchesExpoProjectRef(project, requestedRef));
    if (matches.length === 1) {
      return {
        status: 'resolved',
        project: matches[0],
        candidates: matches,
        reason: 'project-ref',
        synced,
      };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches, reason: 'multiple-candidates', synced };
    }
    return {
      status: 'not_found',
      candidates: enabledProjects,
      reason: enabledProjects.length > 0 ? 'no-matching-project' : 'no-projects',
      synced,
    };
  }

  const repoFullName = normalizeRepoForComparison(options?.repoFullName);
  if (repoFullName) {
    const matches = enabledProjects.filter(
      (project) => normalizeRepoForComparison(project.repoFullName) === repoFullName,
    );
    if (matches.length === 1) {
      return {
        status: 'resolved',
        project: matches[0],
        candidates: matches,
        reason: 'repo-match',
        synced,
      };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches, reason: 'multiple-candidates', synced };
    }
  }

  const launchableProjects = enabledProjects.filter((project) => project.readiness.launchable);
  if (launchableProjects.length === 1) {
    return {
      status: 'resolved',
      project: launchableProjects[0],
      candidates: launchableProjects,
      reason: 'single-launchable',
      synced,
    };
  }
  if (launchableProjects.length > 1) {
    return {
      status: 'ambiguous',
      candidates: launchableProjects,
      reason: 'multiple-launchable',
      synced,
    };
  }

  if (enabledProjects.length === 1) {
    return {
      status: 'resolved',
      project: enabledProjects[0],
      candidates: enabledProjects,
      reason: 'single-enabled-project',
      synced,
    };
  }

  return enabledProjects.length > 1
    ? { status: 'ambiguous', candidates: enabledProjects, reason: 'multiple-candidates', synced }
    : { status: 'not_found', candidates: [], reason: 'no-projects', synced };
}

export async function resolveExpoProjectForExecutionTask(options?: {
  accountId?: string;
  projectRef?: string;
  repoFullName?: string;
  allowSync?: boolean;
}): Promise<ExpoProjectExecutionResolution> {
  const loadProjects = async (refresh: boolean) =>
    listExpoProjects({
      accountId: options?.accountId,
      refresh,
    });

  let projects = await loadProjects(false);
  let resolution = chooseExpoProjectExecutionCandidate(projects, options, false);
  if (resolution.status === 'resolved' || options?.allowSync === false) {
    return resolution;
  }

  const settings = useSettingsStore.getState();
  const enabledAccounts = getExpoAccounts(settings).filter(
    (account) =>
      account.enabled &&
      account.tokenRef &&
      (!options?.accountId || account.id === options.accountId),
  );
  if (enabledAccounts.length === 1) {
    projects = await loadProjects(true);
    resolution = chooseExpoProjectExecutionCandidate(projects, options, true);
  }

  return resolution;
}
