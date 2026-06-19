import React from 'react';

import { RemoteConfigMcpModal } from '../../features/remoteConfig/components/RemoteConfigMcpModal';
import type { McpServerConfig } from '../../types/remote';
import type { SettingsRemoteConfigModalSharedProps } from './settingsRemoteConfigModalShared';

type SettingsMcpModalAdapterProps = SettingsRemoteConfigModalSharedProps & {
  showMcpEditor: boolean;
  editingMcp: McpServerConfig | null;
  mcpServers: McpServerConfig[];
  mcpHeadersText: string;
  mcpOauthClientSecret: string;
  mcpTimeoutText: string;
  hasStoredMcpOauthSession: boolean;
  mcpMetadataChips: string[];
  closeMcpEditor: () => void;
  setEditingMcp: React.Dispatch<React.SetStateAction<McpServerConfig | null>>;
  setMcpHeadersText: (value: string) => void;
  setMcpOauthClientSecret: (value: string) => void;
  setMcpTimeoutText: (value: string) => void;
  getLocalizedMcpTransportLabel: (transport?: McpServerConfig['transport']) => string;
  handleDeleteMcp: (id: string) => void | Promise<void>;
  handleSaveMcp: () => void | Promise<void>;
  handleResetMcpOAuthSession: () => void | Promise<void>;
};

export const SettingsMcpModalAdapter: React.FC<SettingsMcpModalAdapterProps> = ({
  showMcpEditor,
  editingMcp,
  mcpServers,
  mcpHeadersText,
  mcpOauthClientSecret,
  mcpTimeoutText,
  hasStoredMcpOauthSession,
  mcpMetadataChips,
  closeMcpEditor,
  setEditingMcp,
  setMcpHeadersText,
  setMcpOauthClientSecret,
  setMcpTimeoutText,
  getLocalizedMcpTransportLabel,
  handleDeleteMcp,
  handleSaveMcp,
  handleResetMcpOAuthSession,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <RemoteConfigMcpModal
      showMcpEditor={showMcpEditor}
      mcpDraft={editingMcp}
      mcpEditorIsExisting={Boolean(
        editingMcp && mcpServers.some((server) => server.id === editingMcp.id),
      )}
      mcpToken={editingMcp?.token || ''}
      mcpHeadersText={mcpHeadersText}
      mcpTimeoutText={mcpTimeoutText}
      mcpOauthClientSecret={mcpOauthClientSecret}
      mcpMetadataChips={mcpMetadataChips}
      hasStoredMcpOauthSession={hasStoredMcpOauthSession}
      closeMcpEditor={closeMcpEditor}
      mcpCloseAccessibilityLabel={t('common.back')}
      mcpCloseIcon="back"
      mcpDeleteButtonLabel={t('settings.deleteMcpServer')}
      setMcpDraft={setEditingMcp}
      setMcpToken={(value) =>
        setEditingMcp((current) => (current ? { ...current, token: value } : current))
      }
      setMcpHeadersText={setMcpHeadersText}
      setMcpTimeoutText={setMcpTimeoutText}
      setMcpOauthClientSecret={setMcpOauthClientSecret}
      getLocalizedMcpTransportLabel={getLocalizedMcpTransportLabel}
      handleResetMcpOAuthSession={handleResetMcpOAuthSession}
      handleDeleteMcpConfig={handleDeleteMcp}
      handleSaveMcpConfig={handleSaveMcp}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
