import { useCallback, useEffect, useRef } from 'react';

import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import { useConfigModalFlow } from './shared/useConfigModalFlow';
import type { SettingsSection } from './settingsRemoteConfigTypes';

type TranslationFn = (key: string, params?: any) => string;

type UseSettingsRemoteConfigActionsParams = {
  section: SettingsSection;
  setSection: React.Dispatch<React.SetStateAction<SettingsSection>>;
  routeParams?: { serverId?: string; section?: SettingsSection };
  t: TranslationFn;
  mcpServers: McpServerConfig[];
  editingWorkspace: WorkspaceTargetConfig | null;
  editingSsh: SshTargetConfig | null;
  editingBrowser: BrowserProviderConfig | null;
  editingExpoAccount: ExpoAccountConfig | null;
  editingExpoProject: ExpoProjectConfig | null;
  editingMcp: McpServerConfig | null;
  openNewMcpConfig: (draft: Partial<McpServerConfig>) => void;
  openEditMcpConfig: (server: McpServerConfig) => Promise<unknown>;
  resetMcpEditor: () => void;
  resetMcpOauthSession: () => void;
  saveMcpConfig: () => Promise<unknown>;
  removeMcpConfig: (id: string) => void;
  openNewSshConfig: (draft: Partial<SshTargetConfig>) => void;
  openEditSshConfig: (target: SshTargetConfig) => void;
  resetSshEditor: () => void;
  fetchSshFingerprint: () => Promise<unknown>;
  saveSshConfig: () => Promise<unknown>;
  removeSshConfig: (id: string) => Promise<unknown> | void;
  openNewWorkspaceConfig: (draft: Partial<WorkspaceTargetConfig>) => void;
  openEditWorkspaceConfig: (target: WorkspaceTargetConfig) => void;
  resetWorkspaceEditor: () => void;
  saveWorkspaceConfig: () => Promise<unknown>;
  removeWorkspaceConfig: (id: string) => void;
  openNewBrowserConfig: (draft: Partial<BrowserProviderConfig>) => void;
  openEditBrowserConfig: (provider: BrowserProviderConfig) => void;
  resetBrowserEditor: () => void;
  saveBrowserConfig: () => Promise<unknown>;
  removeBrowserConfig: (id: string) => void;
  openNewExpoAccountConfig: (draft: Partial<ExpoAccountConfig>) => void;
  openNewExpoProjectConfig: (draft: Partial<ExpoProjectConfig>) => boolean;
  openEditExpoAccountConfig: (account: ExpoAccountConfig) => void;
  openEditExpoProjectConfig: (project: ExpoProjectConfig) => void;
  resetExpoEditor: () => void;
  toggleExpoProjectPlatformSelection: (platform: 'android' | 'ios' | 'web') => void;
  syncExpoAccountConfig: (accountId?: string) => Promise<unknown>;
  saveExpoAccountConfig: () => Promise<unknown>;
  removeExpoAccountConfig: (id: string) => void;
  saveExpoProjectConfig: () => Promise<unknown>;
  removeExpoProjectConfig: (id: string) => void;
};

const WORKSPACE_EDITOR_SECTIONS: readonly SettingsSection[] = ['workspace-edit'];
const BROWSER_EDITOR_SECTIONS: readonly SettingsSection[] = ['browser-edit'];
const EXPO_EDITOR_SECTIONS: readonly SettingsSection[] = ['expo-account-edit', 'expo-project-edit'];
const MCP_EDITOR_SECTIONS: readonly SettingsSection[] = ['mcp-edit'];
const SSH_EDITOR_SECTIONS: readonly SettingsSection[] = ['ssh-edit'];

export function useSettingsRemoteConfigActions({
  section,
  setSection,
  routeParams,
  t,
  mcpServers,
  editingWorkspace,
  editingSsh,
  editingBrowser,
  editingExpoAccount,
  editingExpoProject,
  editingMcp,
  openNewMcpConfig,
  openEditMcpConfig,
  resetMcpEditor,
  resetMcpOauthSession,
  saveMcpConfig,
  removeMcpConfig,
  openNewSshConfig,
  openEditSshConfig,
  resetSshEditor,
  fetchSshFingerprint,
  saveSshConfig,
  removeSshConfig,
  openNewWorkspaceConfig,
  openEditWorkspaceConfig,
  resetWorkspaceEditor,
  saveWorkspaceConfig,
  removeWorkspaceConfig,
  openNewBrowserConfig,
  openEditBrowserConfig,
  resetBrowserEditor,
  saveBrowserConfig,
  removeBrowserConfig,
  openNewExpoAccountConfig,
  openNewExpoProjectConfig,
  openEditExpoAccountConfig,
  openEditExpoProjectConfig,
  resetExpoEditor,
  toggleExpoProjectPlatformSelection,
  syncExpoAccountConfig,
  saveExpoAccountConfig,
  removeExpoAccountConfig,
  saveExpoProjectConfig,
  removeExpoProjectConfig,
}: UseSettingsRemoteConfigActionsParams) {
  const handledRouteMcpRef = useRef<string | null>(null);
  const workspaceFlow = useConfigModalFlow({
    section,
    setSection,
    editorSections: WORKSPACE_EDITOR_SECTIONS,
    mainSection: 'main',
    resetEditor: resetWorkspaceEditor,
    isActive: section === 'workspace-edit' && Boolean(editingWorkspace),
  });
  const browserFlow = useConfigModalFlow({
    section,
    setSection,
    editorSections: BROWSER_EDITOR_SECTIONS,
    mainSection: 'main',
    resetEditor: resetBrowserEditor,
    isActive: section === 'browser-edit' && Boolean(editingBrowser),
  });
  const expoFlow = useConfigModalFlow({
    section,
    setSection,
    editorSections: EXPO_EDITOR_SECTIONS,
    mainSection: 'main',
    resetEditor: resetExpoEditor,
    isActive:
      (section === 'expo-account-edit' && Boolean(editingExpoAccount)) ||
      (section === 'expo-project-edit' && Boolean(editingExpoProject)),
  });
  const mcpFlow = useConfigModalFlow({
    section,
    setSection,
    editorSections: MCP_EDITOR_SECTIONS,
    mainSection: 'main',
    resetEditor: resetMcpEditor,
    isActive: section === 'mcp-edit' && Boolean(editingMcp),
  });
  const sshFlow = useConfigModalFlow({
    section,
    setSection,
    editorSections: SSH_EDITOR_SECTIONS,
    mainSection: 'main',
    resetEditor: resetSshEditor,
    isActive: section === 'ssh-edit' && Boolean(editingSsh),
  });
  const showWorkspaceEditor = workspaceFlow.isVisible;
  const showBrowserEditor = browserFlow.isVisible;
  const showExpoEditor = expoFlow.isVisible;
  const showMcpEditor = mcpFlow.isVisible;
  const showSshEditor = sshFlow.isVisible;

  const closeWorkspaceEditor = workspaceFlow.closeEditor;
  const closeBrowserEditor = browserFlow.closeEditor;
  const closeExpoEditor = expoFlow.closeEditor;
  const closeMcpEditor = mcpFlow.closeEditor;
  const closeSshEditor = sshFlow.closeEditor;

  const handleNewMcp = useCallback(() => {
    openNewMcpConfig({
      name: t('settings.newMcpServer'),
      headers: {},
      timeoutMs: 20000,
    });
    mcpFlow.openEditor('mcp-edit');
  }, [mcpFlow, openNewMcpConfig, t]);
  const handleEditMcp = useCallback(
    async (server: McpServerConfig) => {
      await openEditMcpConfig(server);
      mcpFlow.openEditor('mcp-edit');
    },
    [mcpFlow, openEditMcpConfig],
  );
  const handleSaveMcp = useCallback(async () => {
    await saveMcpConfig();
  }, [saveMcpConfig]);
  const handleResetMcpOAuthSession = useCallback(() => {
    resetMcpOauthSession();
  }, [resetMcpOauthSession]);
  const handleDeleteMcp = useCallback(
    (id: string) => {
      removeMcpConfig(id);
    },
    [removeMcpConfig],
  );

  const handleNewSsh = useCallback(() => {
    openNewSshConfig({ name: t('settings.newSshTarget') });
    sshFlow.openEditor('ssh-edit');
  }, [openNewSshConfig, sshFlow, t]);
  const handleEditSsh = useCallback(
    (target: SshTargetConfig) => {
      openEditSshConfig(target);
      sshFlow.openEditor('ssh-edit');
    },
    [openEditSshConfig, sshFlow],
  );
  const handleSaveSsh = useCallback(async () => {
    await saveSshConfig();
  }, [saveSshConfig]);
  const handleFetchSshFingerprint = useCallback(async () => {
    await fetchSshFingerprint();
  }, [fetchSshFingerprint]);
  const handleDeleteSsh = useCallback(
    (id: string) => {
      void removeSshConfig(id);
    },
    [removeSshConfig],
  );

  const handleNewWorkspace = useCallback(() => {
    openNewWorkspaceConfig({ name: t('settings.newWorkspaceTarget') });
    workspaceFlow.openEditor('workspace-edit');
  }, [openNewWorkspaceConfig, t, workspaceFlow]);
  const handleEditWorkspace = useCallback(
    (target: WorkspaceTargetConfig) => {
      openEditWorkspaceConfig(target);
      workspaceFlow.openEditor('workspace-edit');
    },
    [openEditWorkspaceConfig, workspaceFlow],
  );
  const handleSaveWorkspace = useCallback(async () => {
    await saveWorkspaceConfig();
  }, [saveWorkspaceConfig]);
  const handleDeleteWorkspace = useCallback(
    (id: string) => {
      removeWorkspaceConfig(id);
    },
    [removeWorkspaceConfig],
  );

  const handleNewBrowserProvider = useCallback(() => {
    openNewBrowserConfig({ name: t('settings.newBrowserProvider') });
    browserFlow.openEditor('browser-edit');
  }, [browserFlow, openNewBrowserConfig, t]);
  const handleEditBrowserProvider = useCallback(
    (provider: BrowserProviderConfig) => {
      openEditBrowserConfig(provider);
      browserFlow.openEditor('browser-edit');
    },
    [browserFlow, openEditBrowserConfig],
  );
  const handleSaveBrowserProvider = useCallback(async () => {
    await saveBrowserConfig();
  }, [saveBrowserConfig]);
  const handleDeleteBrowserProvider = useCallback(
    (id: string) => {
      removeBrowserConfig(id);
    },
    [removeBrowserConfig],
  );

  const handleNewExpoAccount = useCallback(() => {
    openNewExpoAccountConfig({ name: t('settings.newExpoAccount') });
    expoFlow.openEditor('expo-account-edit');
  }, [expoFlow, openNewExpoAccountConfig, t]);
  const handleEditExpoAccount = useCallback(
    (account: ExpoAccountConfig) => {
      openEditExpoAccountConfig(account);
      expoFlow.openEditor('expo-account-edit');
    },
    [expoFlow, openEditExpoAccountConfig],
  );
  const handleSaveExpoAccount = useCallback(async () => {
    await saveExpoAccountConfig();
  }, [saveExpoAccountConfig]);
  const handleSyncExpoAccount = useCallback(
    async (accountId?: string) => {
      await syncExpoAccountConfig(accountId);
    },
    [syncExpoAccountConfig],
  );
  const handleDeleteExpoAccount = useCallback(
    (id: string) => {
      removeExpoAccountConfig(id);
    },
    [removeExpoAccountConfig],
  );
  const handleNewExpoProject = useCallback(() => {
    const opened = openNewExpoProjectConfig({ name: t('settings.newExpoProject') });
    if (opened) {
      expoFlow.openEditor('expo-project-edit');
    }
  }, [expoFlow, openNewExpoProjectConfig, t]);
  const handleEditExpoProject = useCallback(
    (project: ExpoProjectConfig) => {
      openEditExpoProjectConfig(project);
      expoFlow.openEditor('expo-project-edit');
    },
    [expoFlow, openEditExpoProjectConfig],
  );
  const toggleExpoPlatform = useCallback(
    (platform: 'android' | 'ios' | 'web') => {
      toggleExpoProjectPlatformSelection(platform);
    },
    [toggleExpoProjectPlatformSelection],
  );
  const handleSaveExpoProject = useCallback(async () => {
    await saveExpoProjectConfig();
  }, [saveExpoProjectConfig]);
  const handleDeleteExpoProject = useCallback(
    (id: string) => {
      removeExpoProjectConfig(id);
    },
    [removeExpoProjectConfig],
  );

  useEffect(() => {
    const routeServerId = routeParams?.serverId as string | undefined;
    const routeSection = routeParams?.section as SettingsSection | undefined;
    const nextKey = routeServerId || routeSection || null;

    if (!nextKey || handledRouteMcpRef.current === nextKey) {
      return;
    }

    handledRouteMcpRef.current = nextKey;

    if (routeServerId) {
      const server = mcpServers.find((candidate) => candidate.id === routeServerId);
      if (server) {
        void handleEditMcp(server);
      }
      return;
    }

    if (routeSection === 'mcp-edit') {
      handleNewMcp();
    }
  }, [handleEditMcp, handleNewMcp, mcpServers, routeParams]);

  const isRemoteConfigModalActive =
    workspaceFlow.isActive ||
    browserFlow.isActive ||
    expoFlow.isActive ||
    mcpFlow.isActive ||
    sshFlow.isActive;

  return {
    showWorkspaceEditor,
    showBrowserEditor,
    showExpoEditor,
    showMcpEditor,
    showSshEditor,
    isRemoteConfigModalActive,
    closeWorkspaceEditor,
    closeBrowserEditor,
    closeExpoEditor,
    closeMcpEditor,
    closeSshEditor,
    handleNewMcp,
    handleEditMcp,
    handleSaveMcp,
    handleResetMcpOAuthSession,
    handleDeleteMcp,
    handleNewSsh,
    handleEditSsh,
    handleSaveSsh,
    handleFetchSshFingerprint,
    handleDeleteSsh,
    handleNewWorkspace,
    handleEditWorkspace,
    handleSaveWorkspace,
    handleDeleteWorkspace,
    handleNewBrowserProvider,
    handleEditBrowserProvider,
    handleSaveBrowserProvider,
    handleDeleteBrowserProvider,
    handleNewExpoAccount,
    handleEditExpoAccount,
    handleSaveExpoAccount,
    handleSyncExpoAccount,
    handleDeleteExpoAccount,
    handleNewExpoProject,
    handleEditExpoProject,
    toggleExpoPlatform,
    handleSaveExpoProject,
    handleDeleteExpoProject,
  };
}
