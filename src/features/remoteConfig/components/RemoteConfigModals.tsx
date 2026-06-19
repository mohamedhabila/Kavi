import React from 'react';

import type { ConfigEditorModalShellStyles } from '../../../screens/components/ConfigEditorModal';
import type { AppPalette } from '../../../theme/useAppTheme';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../../types/remote';
import { RemoteConfigBrowserModal } from './RemoteConfigBrowserModal';
import { RemoteConfigExpoModal } from './RemoteConfigExpoModal';
import { RemoteConfigMcpModal } from './RemoteConfigMcpModal';
import { RemoteConfigSshModal } from './RemoteConfigSshModal';
import { RemoteConfigWorkspaceModal } from './RemoteConfigWorkspaceModal';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

export type RemoteConfigModalsProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
  isWide: boolean;
  showWorkspaceEditor: boolean;
  showSshEditor: boolean;
  showBrowserEditor: boolean;
  showExpoEditor: boolean;
  showMcpEditor: boolean;
  workspaceDraft: WorkspaceTargetConfig | null;
  workspaceEditorIsExisting: boolean;
  workspaceTitleOverride?: string;
  browserProviders: BrowserProviderConfig[];
  sshTargets: SshTargetConfig[];
  workspaceAccessToken: string;
  workspaceConfigRootsText: string;
  closeWorkspaceEditor: () => void;
  setWorkspaceDraft: React.Dispatch<React.SetStateAction<WorkspaceTargetConfig | null>>;
  setWorkspaceAccessToken: (value: string) => void;
  setWorkspaceConfigRootsText: (value: string) => void;
  getLocalizedWorkspaceProviderLabel: (provider?: WorkspaceTargetConfig['provider']) => string;
  getWorkspaceAuthModeLabel: (authMode?: WorkspaceTargetConfig['authMode']) => string;
  handleDeleteWorkspaceConfig: (id: string) => void;
  handleSaveWorkspaceConfig: () => void | Promise<void>;
  sshDraft: SshTargetConfig | null;
  sshEditorIsExisting: boolean;
  sshPortText: string;
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  sshFingerprintPending: boolean;
  closeSshEditor: () => void;
  sshCloseAccessibilityLabel?: string;
  sshCloseIcon?: 'close' | 'back';
  sshDeleteButtonLabel?: string;
  setSshDraft: React.Dispatch<React.SetStateAction<SshTargetConfig | null>>;
  setSshPassphrase: (value: string) => void;
  setSshPassword: (value: string) => void;
  setSshPortText: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
  getLocalizedSshHostKeyPolicyOptionLabel: (policy?: SshTargetConfig['hostKeyPolicy']) => string;
  handleDeleteSshConfig: (id: string) => void | Promise<void>;
  handleFetchFingerprint: () => void | Promise<void>;
  handleResetFingerprint?: () => void;
  handleSaveSshConfig: () => void | Promise<void>;
  browserDraft: BrowserProviderConfig | null;
  browserEditorIsExisting: boolean;
  browserApiKey: string;
  closeBrowserEditor: () => void;
  setBrowserDraft: React.Dispatch<React.SetStateAction<BrowserProviderConfig | null>>;
  setBrowserApiKey: (value: string) => void;
  getLocalizedBrowserAuthModeLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  handleDeleteBrowserConfig: (id: string) => void;
  handleSaveBrowserConfig: () => void | Promise<void>;
  expoTitleOverride?: string;
  expoAccountDraft: ExpoAccountConfig | null;
  expoProjectDraft: ExpoProjectConfig | null;
  expoAccountEditorIsExisting: boolean;
  expoProjectEditorIsExisting: boolean;
  expoAccountToken: string;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  closeExpoEditor: () => void;
  setExpoAccountDraft: React.Dispatch<React.SetStateAction<ExpoAccountConfig | null>>;
  setExpoAccountToken: (value: string) => void;
  setExpoProjectDraft: React.Dispatch<React.SetStateAction<ExpoProjectConfig | null>>;
  getLocalizedExpoModeLabel: (mode?: ExpoProjectConfig['mode']) => string;
  handleDeleteExpoAccount: (id: string) => void;
  handleDeleteExpoProject: (id: string) => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
  handleSaveExpoAccount: () => void | Promise<void>;
  handleSaveExpoProject: () => void | Promise<void>;
  handleSyncExpoAccount: (accountId?: string) => void | Promise<void>;
  toggleExpoPlatform: (platform: 'android' | 'ios' | 'web') => void;
  mcpDraft: McpServerConfig | null;
  mcpEditorIsExisting: boolean;
  mcpToken: string;
  mcpHeadersText: string;
  mcpTimeoutText: string;
  mcpOauthClientSecret: string;
  mcpMetadataChips: string[];
  hasStoredMcpOauthSession: boolean;
  closeMcpEditor: () => void;
  mcpCloseAccessibilityLabel?: string;
  mcpCloseIcon?: 'close' | 'back';
  mcpDeleteButtonLabel?: string;
  setMcpDraft: React.Dispatch<React.SetStateAction<McpServerConfig | null>>;
  setMcpToken: (value: string) => void;
  setMcpHeadersText: (value: string) => void;
  setMcpTimeoutText: (value: string) => void;
  setMcpOauthClientSecret: (value: string) => void;
  getLocalizedMcpTransportLabel: (transport?: McpServerConfig['transport']) => string;
  handleResetMcpOAuthSession: () => void | Promise<void>;
  handleDeleteMcpConfig: (id: string) => void;
  handleSaveMcpConfig: () => void | Promise<void>;
};

export const RemoteConfigModals: React.FC<RemoteConfigModalsProps> = ({ ...props }) => {
  return (
    <>
      <RemoteConfigWorkspaceModal {...props} />
      <RemoteConfigSshModal {...props} />
      <RemoteConfigBrowserModal {...props} />
      <RemoteConfigExpoModal {...props} />
      <RemoteConfigMcpModal {...props} />
    </>
  );
};
