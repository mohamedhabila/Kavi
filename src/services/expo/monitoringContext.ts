import { useSettingsStore } from '../../store/useSettingsStore';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import {
  tryResolveExpoAccountFromGraphqlVariables,
  tryResolveExpoProjectFromGraphqlVariables,
} from './providers/expoGraphql';
import { getExpoAccounts, resolveExpoAccount, resolveExpoProject } from './projectState';
function resolveExpoMonitoringContext(
  projectId?: string,
  accountId?: string,
  variables?: Record<string, unknown>,
): {
  project?: ExpoProjectConfig;
  account: ExpoAccountConfig;
} {
  const settings = useSettingsStore.getState();

  if (projectId) {
    const project = resolveExpoProject(projectId, settings);
    const account = resolveExpoAccount(project.accountId, settings);
    return { project, account };
  }

  if (accountId) {
    return { account: resolveExpoAccount(accountId, settings) };
  }

  if (variables) {
    const inferredProject = tryResolveExpoProjectFromGraphqlVariables(settings, variables);
    if (inferredProject) {
      return {
        project: inferredProject,
        account: resolveExpoAccount(inferredProject.accountId, settings),
      };
    }

    const inferredAccount = tryResolveExpoAccountFromGraphqlVariables(settings, variables);
    if (inferredAccount) {
      return { account: inferredAccount };
    }
  }

  const enabledAccounts = getExpoAccounts(settings).filter((entry) => entry.enabled);
  if (enabledAccounts.length === 1) {
    return { account: enabledAccounts[0] };
  }

  throw new Error(enabledAccounts.length > 1 ? 'expo-account-ambiguous' : 'expo-account-not-found');
}

export { resolveExpoMonitoringContext };
