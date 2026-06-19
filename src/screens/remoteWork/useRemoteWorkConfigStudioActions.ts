import { useCallback } from 'react';

import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import type { RemoteWorkConfigStudioControllerState } from './useRemoteWorkConfigStudioControllers';

export function useRemoteWorkConfigStudioActions(studio: RemoteWorkConfigStudioControllerState) {
  const closeWorkspaceEditor = useCallback(() => {
    studio.setIsWorkspaceEditorVisible(false);
    studio.clearWorkspaceEditorState();
  }, [studio]);

  const closeSshEditor = useCallback(() => {
    studio.setIsSshEditorVisible(false);
    studio.clearSshEditorState();
  }, [studio]);

  const closeBrowserEditor = useCallback(() => {
    studio.setIsBrowserEditorVisible(false);
    studio.clearBrowserEditorState();
  }, [studio]);

  const handleEditWorkspaceConfig = useCallback(
    (target: WorkspaceTargetConfig) => {
      studio.setActiveConfigSurface('workspace');
      studio.setSelectedWorkspaceId(target.id);
      studio.openEditWorkspaceConfig(target);
      studio.setIsWorkspaceEditorVisible(true);
    },
    [studio],
  );

  const handleEditSshConfig = useCallback(
    (target: SshTargetConfig) => {
      studio.setActiveConfigSurface('ssh');
      studio.openEditSshConfig(target);
      studio.setIsSshEditorVisible(true);
    },
    [studio],
  );

  const handleEditBrowserConfig = useCallback(
    (provider: BrowserProviderConfig) => {
      studio.setActiveConfigSurface('browser');
      studio.openEditBrowserConfig(provider);
      studio.setIsBrowserEditorVisible(true);
    },
    [studio],
  );

  const handleFetchFingerprint = useCallback(async () => {
    await studio.fetchSshFingerprint();
  }, [studio]);

  const handleSaveWorkspaceConfig = useCallback(async () => {
    await studio.saveWorkspaceConfig();
  }, [studio]);

  const handleDeleteWorkspaceConfig = useCallback(
    (id: string) => {
      studio.removeWorkspaceConfig(id);
    },
    [studio],
  );

  const handleSaveSshConfig = useCallback(async () => {
    await studio.saveSshConfig();
  }, [studio]);

  const handleDeleteSshConfig = useCallback(
    (id: string) => {
      void studio.removeSshConfig(id);
    },
    [studio],
  );

  const handleSaveBrowserConfig = useCallback(async () => {
    await studio.saveBrowserConfig();
  }, [studio]);

  const handleDeleteBrowserConfig = useCallback(
    (id: string) => {
      studio.removeBrowserConfig(id);
    },
    [studio],
  );

  const closeExpoEditor = useCallback(() => {
    studio.setIsExpoEditorVisible(false);
    studio.clearExpoEditorState();
  }, [studio]);

  const handleEditExpoAccount = useCallback(
    (account: ExpoAccountConfig) => {
      studio.setActiveConfigSurface('expo');
      studio.openEditExpoAccountConfig(account);
      studio.setIsExpoEditorVisible(true);
    },
    [studio],
  );

  const handleEditExpoProject = useCallback(
    (project: ExpoProjectConfig) => {
      studio.setActiveConfigSurface('expo');
      studio.openEditExpoProjectConfig(project);
      studio.setIsExpoEditorVisible(true);
    },
    [studio],
  );

  const toggleExpoPlatform = useCallback(
    (platform: 'android' | 'ios' | 'web') => {
      studio.toggleExpoProjectPlatformSelection(platform);
    },
    [studio],
  );

  const handleSyncExpoAccount = useCallback(
    async (accountId?: string) => {
      await studio.syncExpoAccountConfig(accountId);
    },
    [studio],
  );

  const handleSaveExpoAccount = useCallback(async () => {
    await studio.saveExpoAccountConfig();
  }, [studio]);

  const handleDeleteExpoAccount = useCallback(
    (id: string) => {
      studio.removeExpoAccountConfig(id);
    },
    [studio],
  );

  const handleSaveExpoProject = useCallback(async () => {
    await studio.saveExpoProjectConfig();
  }, [studio]);

  const handleDeleteExpoProject = useCallback(
    (id: string) => {
      studio.removeExpoProjectConfig(id);
    },
    [studio],
  );

  const closeMcpEditor = useCallback(() => {
    studio.setIsMcpEditorVisible(false);
    studio.clearMcpEditorState();
  }, [studio]);

  const handleEditMcpConfig = useCallback(
    async (server: McpServerConfig) => {
      studio.setActiveConfigSurface('mcp');
      await studio.openEditMcpConfig(server);
      studio.setIsMcpEditorVisible(true);
    },
    [studio],
  );

  const handleSaveMcpConfig = useCallback(async () => {
    await studio.saveMcpConfig();
  }, [studio]);

  const handleDeleteMcpConfig = useCallback(
    (id: string) => {
      studio.removeMcpConfig(id);
    },
    [studio],
  );

  const handleResetMcpOAuthSession = useCallback(() => {
    studio.resetMcpOauthSession();
  }, [studio]);

  const handleCreateWorkspace = useCallback(() => {
    studio.setActiveConfigSurface('workspace');
    studio.openNewWorkspaceConfig();
    studio.setIsWorkspaceEditorVisible(true);
  }, [studio]);

  const handleCreateSsh = useCallback(() => {
    studio.setActiveConfigSurface('ssh');
    studio.openNewSshConfig();
    studio.setIsSshEditorVisible(true);
  }, [studio]);

  const handleCreateBrowser = useCallback(() => {
    studio.setActiveConfigSurface('browser');
    studio.openNewBrowserConfig();
    studio.setIsBrowserEditorVisible(true);
  }, [studio]);

  const handleCreateExpo = useCallback(() => {
    studio.setActiveConfigSurface('expo');
    studio.openExpoStudio();
    studio.setIsExpoEditorVisible(true);
  }, [studio]);

  const handleCreateMcp = useCallback(() => {
    studio.setActiveConfigSurface('mcp');
    studio.openNewMcpConfig();
    studio.setIsMcpEditorVisible(true);
  }, [studio]);

  return {
    closeWorkspaceEditor,
    closeSshEditor,
    closeBrowserEditor,
    closeExpoEditor,
    closeMcpEditor,
    handleEditWorkspaceConfig,
    handleEditSshConfig,
    handleEditBrowserConfig,
    handleFetchFingerprint,
    handleSaveWorkspaceConfig,
    handleDeleteWorkspaceConfig,
    handleSaveSshConfig,
    handleDeleteSshConfig,
    handleSaveBrowserConfig,
    handleDeleteBrowserConfig,
    handleEditExpoAccount,
    handleEditExpoProject,
    toggleExpoPlatform,
    handleSyncExpoAccount,
    handleSaveExpoAccount,
    handleDeleteExpoAccount,
    handleSaveExpoProject,
    handleDeleteExpoProject,
    handleEditMcpConfig,
    handleSaveMcpConfig,
    handleDeleteMcpConfig,
    handleResetMcpOAuthSession,
    handleCreateWorkspace,
    handleCreateSsh,
    handleCreateBrowser,
    handleCreateExpo,
    handleCreateMcp,
  };
}
