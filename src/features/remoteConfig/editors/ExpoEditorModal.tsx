import React from 'react';
import {
  ConfigEditorModal,
  type ConfigEditorModalShellStyles,
} from '../../../screens/components/ConfigEditorModal';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { ExpoAccountConfig, ExpoProjectConfig, SshTargetConfig } from '../../../types/remote';
import { ExpoAccountEditorContent } from './ExpoAccountEditorContent';
import { ExpoProjectEditorContent } from './ExpoProjectEditorContent';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SharedProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
};

type RemoteWorkExpoEditorModalProps = SharedProps & {
  visible: boolean;
  titleOverride?: string;
  subtitleOverride?: string;
  expoAccountDraft: ExpoAccountConfig | null;
  expoProjectDraft: ExpoProjectConfig | null;
  expoAccountEditorIsExisting: boolean;
  expoProjectEditorIsExisting: boolean;
  expoAccountToken: string;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  isWide: boolean;
  sshTargets: SshTargetConfig[];
  closeEditor: () => void;
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
};

export const RemoteWorkExpoEditorModal: React.FC<RemoteWorkExpoEditorModalProps> = ({
  visible,
  titleOverride,
  subtitleOverride,
  expoAccountDraft,
  expoProjectDraft,
  expoAccountEditorIsExisting,
  expoProjectEditorIsExisting,
  expoAccountToken,
  expoAccounts,
  expoProjects,
  isWide,
  sshTargets,
  closeEditor,
  setExpoAccountDraft,
  setExpoAccountToken,
  setExpoProjectDraft,
  getLocalizedExpoModeLabel,
  handleDeleteExpoAccount,
  handleDeleteExpoProject,
  handleEditExpoAccount,
  handleEditExpoProject,
  handleSaveExpoAccount,
  handleSaveExpoProject,
  handleSyncExpoAccount,
  toggleExpoPlatform,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <ConfigEditorModal
      visible={visible && Boolean(expoAccountDraft || expoProjectDraft)}
      title={titleOverride || t('remoteWork.expoTargetsTitle')}
      subtitle={subtitleOverride || t('remoteWork.expoManageHint')}
      onClose={closeEditor}
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {expoAccountDraft ? (
        <ExpoAccountEditorContent
          draft={expoAccountDraft}
          isExisting={expoAccountEditorIsExisting}
          expoAccountToken={expoAccountToken}
          expoAccounts={expoAccounts}
          colors={colors}
          styles={styles}
          t={t}
          setExpoAccountDraft={setExpoAccountDraft}
          setExpoAccountToken={setExpoAccountToken}
          handleDeleteExpoAccount={handleDeleteExpoAccount}
          handleEditExpoAccount={handleEditExpoAccount}
          handleSaveExpoAccount={handleSaveExpoAccount}
          handleSyncExpoAccount={handleSyncExpoAccount}
        />
      ) : null}

      {expoProjectDraft ? (
        <ExpoProjectEditorContent
          draft={expoProjectDraft}
          isExisting={expoProjectEditorIsExisting}
          expoAccountDraft={expoAccountDraft}
          expoAccounts={expoAccounts}
          expoProjects={expoProjects}
          sshTargets={sshTargets}
          isWide={isWide}
          colors={colors}
          styles={styles}
          t={t}
          setExpoProjectDraft={setExpoProjectDraft}
          getLocalizedExpoModeLabel={getLocalizedExpoModeLabel}
          handleDeleteExpoProject={handleDeleteExpoProject}
          handleEditExpoAccount={handleEditExpoAccount}
          handleEditExpoProject={handleEditExpoProject}
          handleSaveExpoProject={handleSaveExpoProject}
          handleSyncExpoAccount={handleSyncExpoAccount}
          toggleExpoPlatform={toggleExpoPlatform}
          closeEditor={closeEditor}
        />
      ) : null}
    </ConfigEditorModal>
  );
};
