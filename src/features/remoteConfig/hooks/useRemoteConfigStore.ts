import { useShallow } from 'zustand/react/shallow';

import { useSettingsStore } from '../../../store/useSettingsStore';

export function selectRemoteConfigSettingsSlice(
  state: ReturnType<typeof useSettingsStore.getState>,
) {
  return {
    workspaceTargets: state.workspaceTargets,
    defaultWorkspaceTargetId: state.defaultWorkspaceTargetId,
    sshTargets: state.sshTargets,
    browserProviders: state.browserProviders,
    mcpServers: state.mcpServers,
    expoAccounts: state.expoAccounts,
    expoProjects: state.expoProjects,
    addSshTarget: state.addSshTarget,
    updateSshTarget: state.updateSshTarget,
    removeSshTarget: state.removeSshTarget,
    addWorkspaceTarget: state.addWorkspaceTarget,
    updateWorkspaceTarget: state.updateWorkspaceTarget,
    removeWorkspaceTarget: state.removeWorkspaceTarget,
    setDefaultWorkspaceTargetId: state.setDefaultWorkspaceTargetId,
    addBrowserProvider: state.addBrowserProvider,
    updateBrowserProvider: state.updateBrowserProvider,
    removeBrowserProvider: state.removeBrowserProvider,
    addExpoAccount: state.addExpoAccount,
    updateExpoAccount: state.updateExpoAccount,
    removeExpoAccount: state.removeExpoAccount,
    addExpoProject: state.addExpoProject,
    updateExpoProject: state.updateExpoProject,
    removeExpoProject: state.removeExpoProject,
    addMcpServer: state.addMcpServer,
    updateMcpServer: state.updateMcpServer,
    removeMcpServer: state.removeMcpServer,
  };
}

export type RemoteConfigSettingsSlice = ReturnType<typeof selectRemoteConfigSettingsSlice>;

export function useRemoteConfigSettingsSlice(): RemoteConfigSettingsSlice {
  return useSettingsStore(useShallow(selectRemoteConfigSettingsSlice));
}
