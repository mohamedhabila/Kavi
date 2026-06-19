import { useSettingsStore } from "../../store/useSettingsStore";
import type { ExpoProjectListing } from "./contracts";
import {
  getExpoAccounts,
  getExpoProjectDisplayOwner,
  getExpoProjectFullName,
  normalizeExpoOwner,
  resolveExpoAccount,
  resolveExpoProject,
  slugifyExpoProjectName,
} from "./projectState";
import { getExpoProjectReadiness, getExpoProjectReadinessLabel } from "./projectAutomation";
import { findExpoProjectByFullNameAsync, fetchExpoRemoteAccountAsync, createExpoRemoteProjectAsync } from "./projectRemote";
import { resolveExpoAccountToken } from "./secrets";
import { syncExpoAccountProjects } from "./projectSync";
export async function createExpoProject(args: {
  accountId?: string;
  name: string;
  slug?: string;
}): Promise<ExpoProjectListing> {
  const settings = useSettingsStore.getState();
  const enabledAccounts = getExpoAccounts(settings).filter((account) => account.enabled);
  const account = args.accountId
    ? resolveExpoAccount(args.accountId, settings)
    : enabledAccounts.length === 1
      ? enabledAccounts[0]
      : null;

  if (!account) {
    throw new Error('expo-account-not-found');
  }

  const token = await resolveExpoAccountToken(account);
  const slug = slugifyExpoProjectName(args.slug || args.name);
  const fullName = `@${normalizeExpoOwner(account.owner)}/${slug}`;
  const existingProject = await findExpoProjectByFullNameAsync(token, fullName);

  if (!existingProject) {
    const remoteAccount = await fetchExpoRemoteAccountAsync(token, account.owner);
    await createExpoRemoteProjectAsync(token, remoteAccount.id, slug);
  }

  await syncExpoAccountProjects(account.id);
  const refreshedSettings = useSettingsStore.getState();
  const project = resolveExpoProject(fullName, refreshedSettings);
  const refreshedAccount = resolveExpoAccount(project.accountId, refreshedSettings);
  const readiness = getExpoProjectReadiness(project, refreshedAccount, refreshedSettings);

  return {
    id: project.id,
    easProjectId: project.easProjectId,
    name: project.name,
    fullName: getExpoProjectFullName(project, refreshedAccount),
    owner: getExpoProjectDisplayOwner(project, refreshedAccount),
    slug: project.slug,
    accountId: project.accountId,
    accountName: refreshedAccount.name,
    source: project.source,
    mode: project.mode,
    repoFullName: project.repoFullName,
    repoDefaultBranch: project.repoDefaultBranch,
    availableWorkflowFiles: project.availableWorkflowFiles,
    lastSyncedAt: project.lastSyncedAt,
    readiness: {
      ...readiness,
      label: getExpoProjectReadinessLabel(readiness),
    },
  };
}
