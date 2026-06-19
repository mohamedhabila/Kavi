import React from 'react';
import {
  ConfigEditorModal,
  type ConfigEditorModalShellStyles,
} from '../../../screens/components/ConfigEditorModal';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { SshTargetConfig } from '../../../types/remote';
import { SshAccessSection } from './SshAccessSection';
import { SshBasicsSection } from './SshBasicsSection';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SharedProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
};

type RemoteWorkSshEditorModalProps = SharedProps & {
  visible: boolean;
  draft: SshTargetConfig | null;
  isExisting: boolean;
  isWide: boolean;
  sshPortText: string;
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  sshFingerprintPending: boolean;
  closeEditor: () => void;
  closeAccessibilityLabel?: string;
  closeIcon?: 'close' | 'back';
  deleteButtonLabel?: string;
  setDraft: React.Dispatch<React.SetStateAction<SshTargetConfig | null>>;
  setSshPassphrase: (value: string) => void;
  setSshPassword: (value: string) => void;
  setSshPortText: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
  getLocalizedSshHostKeyPolicyOptionLabel: (policy?: SshTargetConfig['hostKeyPolicy']) => string;
  handleDeleteSshConfig: (id: string) => void | Promise<void>;
  handleFetchFingerprint: () => void | Promise<void>;
  handleResetFingerprint?: () => void | Promise<void>;
  handleSaveSshConfig: () => void | Promise<void>;
};

export const RemoteWorkSshEditorModal: React.FC<RemoteWorkSshEditorModalProps> = ({
  visible,
  draft,
  isExisting,
  isWide,
  sshPortText,
  sshPassword,
  sshPrivateKey,
  sshPassphrase,
  sshFingerprintPending,
  closeEditor,
  closeAccessibilityLabel,
  closeIcon,
  deleteButtonLabel,
  setDraft,
  setSshPassphrase,
  setSshPassword,
  setSshPortText,
  setSshPrivateKey,
  getLocalizedSshHostKeyPolicyOptionLabel,
  handleDeleteSshConfig,
  handleFetchFingerprint,
  handleResetFingerprint,
  handleSaveSshConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <ConfigEditorModal
      visible={visible && Boolean(draft)}
      title={isExisting ? t('settings.editSshTarget') : t('settings.newSshTarget')}
      subtitle={t('remoteWork.sshManageHint')}
      onClose={closeEditor}
      closeAccessibilityLabel={closeAccessibilityLabel || t('common.close')}
      closeIcon={closeIcon}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <SshBasicsSection
            draft={draft}
            isWide={isWide}
            sshPortText={sshPortText}
            colors={colors}
            styles={styles}
            t={t}
            setDraft={setDraft}
            setSshPortText={setSshPortText}
          />
          <SshAccessSection
            draft={draft}
            isExisting={isExisting}
            sshPassword={sshPassword}
            sshPrivateKey={sshPrivateKey}
            sshPassphrase={sshPassphrase}
            sshFingerprintPending={sshFingerprintPending}
            colors={colors}
            styles={styles}
            t={t}
            closeEditor={closeEditor}
            deleteButtonLabel={deleteButtonLabel}
            setDraft={setDraft}
            setSshPassword={setSshPassword}
            setSshPrivateKey={setSshPrivateKey}
            setSshPassphrase={setSshPassphrase}
            getLocalizedSshHostKeyPolicyOptionLabel={getLocalizedSshHostKeyPolicyOptionLabel}
            handleDeleteSshConfig={handleDeleteSshConfig}
            handleFetchFingerprint={handleFetchFingerprint}
            handleResetFingerprint={handleResetFingerprint}
            handleSaveSshConfig={handleSaveSshConfig}
          />
        </>
      ) : null}
    </ConfigEditorModal>
  );
};
