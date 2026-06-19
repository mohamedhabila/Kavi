import React from 'react';
import {
  ConfigEditorModal,
  type ConfigEditorModalShellStyles,
} from '../../../screens/components/ConfigEditorModal';
import { getWorkspaceTargetDisplayName } from '../../../services/workspaces/config';
import type { AppPalette } from '../../../theme/useAppTheme';
import type {
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../../types/remote';
import { WorkspaceAccessSection } from './WorkspaceAccessSection';
import { WorkspaceBasicsSection } from './WorkspaceBasicsSection';
import { WorkspaceRoutingSection } from './WorkspaceRoutingSection';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SharedProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
};

type RemoteWorkWorkspaceEditorModalProps = SharedProps & {
  visible: boolean;
  draft: WorkspaceTargetConfig | null;
  isExisting: boolean;
  titleOverride?: string;
  subtitleOverride?: string;
  browserProviders: BrowserProviderConfig[];
  sshTargets: SshTargetConfig[];
  workspaceAccessToken: string;
  workspaceConfigRootsText: string;
  closeEditor: () => void;
  setDraft: React.Dispatch<React.SetStateAction<WorkspaceTargetConfig | null>>;
  setWorkspaceAccessToken: (value: string) => void;
  setWorkspaceConfigRootsText: (value: string) => void;
  getLocalizedWorkspaceProviderLabel: (provider?: WorkspaceTargetConfig['provider']) => string;
  getWorkspaceAuthModeLabel: (authMode?: WorkspaceTargetConfig['authMode']) => string;
  handleDeleteWorkspaceConfig: (id: string) => void;
  handleSaveWorkspaceConfig: () => void | Promise<void>;
};

export const RemoteWorkWorkspaceEditorModal: React.FC<RemoteWorkWorkspaceEditorModalProps> = ({
  visible,
  draft,
  isExisting,
  titleOverride,
  subtitleOverride,
  browserProviders,
  sshTargets,
  workspaceAccessToken,
  workspaceConfigRootsText,
  closeEditor,
  setDraft,
  setWorkspaceAccessToken,
  setWorkspaceConfigRootsText,
  getLocalizedWorkspaceProviderLabel,
  getWorkspaceAuthModeLabel,
  handleDeleteWorkspaceConfig,
  handleSaveWorkspaceConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <ConfigEditorModal
      visible={visible && Boolean(draft)}
      title={
        titleOverride ||
        (isExisting && draft
          ? t('remoteWork.workspaceEditTitle', { name: getWorkspaceTargetDisplayName(draft) })
          : t('remoteWork.workspaceCreateTitle'))
      }
      subtitle={
        subtitleOverride ||
        (isExisting
          ? t('remoteWork.workspaceEditSubtitle')
          : t('remoteWork.workspaceCreateSubtitle'))
      }
      onClose={closeEditor}
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <WorkspaceBasicsSection
            draft={draft}
            colors={colors}
            styles={styles}
            t={t}
            setDraft={setDraft}
          />
          <WorkspaceAccessSection
            draft={draft}
            browserProviders={browserProviders}
            sshTargets={sshTargets}
            workspaceAccessToken={workspaceAccessToken}
            colors={colors}
            styles={styles}
            t={t}
            setDraft={setDraft}
            setWorkspaceAccessToken={setWorkspaceAccessToken}
            getLocalizedWorkspaceProviderLabel={getLocalizedWorkspaceProviderLabel}
            getWorkspaceAuthModeLabel={getWorkspaceAuthModeLabel}
          />
          <WorkspaceRoutingSection
            draft={draft}
            isExisting={isExisting}
            workspaceConfigRootsText={workspaceConfigRootsText}
            colors={colors}
            styles={styles}
            t={t}
            closeEditor={closeEditor}
            setDraft={setDraft}
            setWorkspaceConfigRootsText={setWorkspaceConfigRootsText}
            handleDeleteWorkspaceConfig={handleDeleteWorkspaceConfig}
            handleSaveWorkspaceConfig={handleSaveWorkspaceConfig}
          />
        </>
      ) : null}
    </ConfigEditorModal>
  );
};
