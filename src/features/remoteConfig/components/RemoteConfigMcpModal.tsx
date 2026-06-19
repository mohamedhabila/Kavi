import React from 'react';

import { RemoteWorkMcpEditorModal } from '../editors/McpEditorModal';
import type { RemoteConfigModalsProps } from './RemoteConfigModals';

type RemoteConfigMcpModalProps = Pick<
  RemoteConfigModalsProps,
  | 'showMcpEditor'
  | 'mcpDraft'
  | 'mcpEditorIsExisting'
  | 'mcpToken'
  | 'mcpHeadersText'
  | 'mcpTimeoutText'
  | 'mcpOauthClientSecret'
  | 'mcpMetadataChips'
  | 'hasStoredMcpOauthSession'
  | 'closeMcpEditor'
  | 'mcpCloseAccessibilityLabel'
  | 'mcpCloseIcon'
  | 'mcpDeleteButtonLabel'
  | 'setMcpDraft'
  | 'setMcpToken'
  | 'setMcpHeadersText'
  | 'setMcpTimeoutText'
  | 'setMcpOauthClientSecret'
  | 'getLocalizedMcpTransportLabel'
  | 'handleResetMcpOAuthSession'
  | 'handleDeleteMcpConfig'
  | 'handleSaveMcpConfig'
  | 'colors'
  | 'styles'
  | 'shellStyles'
  | 't'
>;

export const RemoteConfigMcpModal: React.FC<RemoteConfigMcpModalProps> = ({
  showMcpEditor,
  mcpDraft,
  mcpEditorIsExisting,
  mcpToken,
  mcpHeadersText,
  mcpTimeoutText,
  mcpOauthClientSecret,
  mcpMetadataChips,
  hasStoredMcpOauthSession,
  closeMcpEditor,
  mcpCloseAccessibilityLabel,
  mcpCloseIcon,
  mcpDeleteButtonLabel,
  setMcpDraft,
  setMcpToken,
  setMcpHeadersText,
  setMcpTimeoutText,
  setMcpOauthClientSecret,
  getLocalizedMcpTransportLabel,
  handleResetMcpOAuthSession,
  handleDeleteMcpConfig,
  handleSaveMcpConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <RemoteWorkMcpEditorModal
      visible={showMcpEditor}
      draft={mcpDraft}
      isExisting={mcpEditorIsExisting}
      mcpToken={mcpToken}
      mcpHeadersText={mcpHeadersText}
      mcpTimeoutText={mcpTimeoutText}
      mcpOauthClientSecret={mcpOauthClientSecret}
      metadataChips={mcpMetadataChips}
      hasStoredMcpOauthSession={hasStoredMcpOauthSession}
      closeEditor={closeMcpEditor}
      closeAccessibilityLabel={mcpCloseAccessibilityLabel}
      closeIcon={mcpCloseIcon}
      deleteButtonLabel={mcpDeleteButtonLabel}
      setDraft={setMcpDraft}
      setMcpToken={setMcpToken}
      setMcpHeadersText={setMcpHeadersText}
      setMcpTimeoutText={setMcpTimeoutText}
      setMcpOauthClientSecret={setMcpOauthClientSecret}
      getLocalizedMcpTransportLabel={getLocalizedMcpTransportLabel}
      handleResetMcpOAuthSession={handleResetMcpOAuthSession}
      handleDeleteMcpConfig={handleDeleteMcpConfig}
      handleSaveMcpConfig={handleSaveMcpConfig}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
