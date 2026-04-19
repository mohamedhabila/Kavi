import type { useRemoteStore } from '../services/remote/store';
import type { useSshSessionStore } from '../services/ssh/sessionStore';
import type { useSettingsStore } from '../store/useSettingsStore';

export function selectRemoteWorkSettingsSlice(state: ReturnType<typeof useSettingsStore.getState>) {
  return {
    workspaceTargets: state.workspaceTargets,
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

export function selectRemoteWorkSshSlice(state: ReturnType<typeof useSshSessionStore.getState>) {
  return {
    sessions: state.sessions,
    openShellSession: state.openShellSession,
    writeShellInput: state.writeShellInput,
    sendShellCommand: state.sendShellCommand,
    closeShellSession: state.closeShellSession,
  };
}

export function selectRemoteWorkRemoteSlice(state: ReturnType<typeof useRemoteStore.getState>) {
  return {
    jobs: state.jobs,
    sessions: state.sessions,
  };
}
