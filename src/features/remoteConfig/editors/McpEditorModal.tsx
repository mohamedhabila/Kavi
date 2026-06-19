import React from 'react';
import {
  ConfigEditorModal,
  type ConfigEditorModalShellStyles,
} from '../../../screens/components/ConfigEditorModal';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { McpServerConfig } from '../../../types/remote';
import { McpAccessSection } from './McpAccessSection';
import { McpBasicsSection } from './McpBasicsSection';
import { McpMetadataSection } from './McpMetadataSection';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SharedProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
};

type RemoteWorkMcpEditorModalProps = SharedProps & {
  visible: boolean;
  draft: McpServerConfig | null;
  isExisting: boolean;
  mcpToken?: string;
  mcpHeadersText?: string;
  mcpTimeoutText?: string;
  mcpOauthClientSecret?: string;
  metadataChips?: string[];
  hasStoredMcpOauthSession?: boolean;
  closeEditor: () => void;
  closeAccessibilityLabel?: string;
  closeIcon?: 'close' | 'back';
  deleteButtonLabel?: string;
  setDraft: React.Dispatch<React.SetStateAction<McpServerConfig | null>>;
  setMcpToken?: (value: string) => void;
  setMcpHeadersText?: (value: string) => void;
  setMcpTimeoutText?: (value: string) => void;
  setMcpOauthClientSecret?: (value: string) => void;
  getLocalizedMcpTransportLabel: (transport?: McpServerConfig['transport']) => string;
  handleResetMcpOAuthSession?: () => void | Promise<void>;
  handleDeleteMcpConfig: (id: string) => void;
  handleSaveMcpConfig: () => void | Promise<void>;
};

export const RemoteWorkMcpEditorModal: React.FC<RemoteWorkMcpEditorModalProps> = ({
  visible,
  draft,
  isExisting,
  mcpToken,
  mcpHeadersText,
  mcpTimeoutText,
  mcpOauthClientSecret,
  metadataChips,
  hasStoredMcpOauthSession,
  closeEditor,
  closeAccessibilityLabel,
  closeIcon,
  deleteButtonLabel,
  setDraft,
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
    <ConfigEditorModal
      visible={visible && Boolean(draft)}
      title={isExisting ? t('settings.editMcpServer') : t('settings.newMcpServer')}
      subtitle={t('remoteWork.mcpManageHint')}
      onClose={closeEditor}
      closeAccessibilityLabel={closeAccessibilityLabel || t('common.close')}
      closeIcon={closeIcon}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <McpMetadataSection
            metadataChips={metadataChips}
            hasStoredMcpOauthSession={hasStoredMcpOauthSession}
            handleResetMcpOAuthSession={handleResetMcpOAuthSession}
            isExisting={isExisting}
            styles={styles}
            t={t}
          />
          <McpBasicsSection
            draft={draft}
            colors={colors}
            styles={styles}
            t={t}
            setDraft={setDraft}
            mcpTimeoutText={mcpTimeoutText}
            setMcpTimeoutText={setMcpTimeoutText}
            getLocalizedMcpTransportLabel={getLocalizedMcpTransportLabel}
          />
          <McpAccessSection
            draft={draft}
            isExisting={isExisting}
            colors={colors}
            styles={styles}
            t={t}
            closeEditor={closeEditor}
            deleteButtonLabel={deleteButtonLabel}
            setDraft={setDraft}
            mcpToken={mcpToken}
            setMcpToken={setMcpToken}
            mcpHeadersText={mcpHeadersText}
            setMcpHeadersText={setMcpHeadersText}
            mcpOauthClientSecret={mcpOauthClientSecret}
            setMcpOauthClientSecret={setMcpOauthClientSecret}
            handleDeleteMcpConfig={handleDeleteMcpConfig}
            handleSaveMcpConfig={handleSaveMcpConfig}
          />
        </>
      ) : null}
    </ConfigEditorModal>
  );
};
