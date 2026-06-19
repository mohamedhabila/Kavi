import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  createExpoAccountDraft,
  createExpoProjectDraft,
  prepareExpoAccountDraft,
  prepareExpoProjectDraft,
  toggleExpoProjectPlatform,
} from '../../../screens/configDrafts';
import { syncExpoAccountProjects } from '../../../services/expo/projectSync';
import { deleteSecure, saveSecure } from '../../../services/storage/SecureStorage';
import { useSettingsStore } from '../../../store/useSettingsStore';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../../types/remote';
import { SharedControllerOptions, confirmDeletion } from './useRemoteConfigControllerShared';

export function useExpoConfigController(
  options: SharedControllerOptions & {
    onAccountSaved?: (account: ExpoAccountConfig) => void;
    onAccountDeleted?: (id: string) => void;
    onProjectSaved?: (project: ExpoProjectConfig) => void;
    onProjectDeleted?: (id: string) => void;
    projectEditorShowsAccount?: boolean;
    refreshDraftsAfterSync?: boolean;
  },
) {
  const { settings, t, onAccountSaved, onAccountDeleted, onProjectSaved, onProjectDeleted } =
    options;
  const projectEditorShowsAccount = options.projectEditorShowsAccount === true;
  const refreshDraftsAfterSync = options.refreshDraftsAfterSync === true;
  const [expoAccountDraft, setExpoAccountDraft] = useState<ExpoAccountConfig | null>(null);
  const [expoProjectDraft, setExpoProjectDraft] = useState<ExpoProjectConfig | null>(null);
  const [expoAccountToken, setExpoAccountToken] = useState('');

  const close = useCallback(() => {
    setExpoAccountDraft(null);
    setExpoProjectDraft(null);
    setExpoAccountToken('');
  }, []);

  const openNewAccount = useCallback((overrides: Partial<ExpoAccountConfig> = {}) => {
    setExpoAccountDraft(createExpoAccountDraft(overrides));
    setExpoProjectDraft(null);
    setExpoAccountToken('');
  }, []);

  const openNewProject = useCallback(
    (overrides: Partial<ExpoProjectConfig> = {}) => {
      const firstAccount = (settings.expoAccounts || [])[0];
      if (!firstAccount) {
        Alert.alert(t('common.error'), t('settings.expoAccountRequired'));
        return false;
      }

      setExpoAccountDraft(projectEditorShowsAccount ? prepareExpoAccountDraft(firstAccount) : null);
      setExpoAccountToken('');
      setExpoProjectDraft(
        createExpoProjectDraft(firstAccount, settings.sshTargets?.[0]?.id, overrides),
      );
      return true;
    },
    [projectEditorShowsAccount, settings.expoAccounts, settings.sshTargets, t],
  );

  const openNew = useCallback(() => {
    const firstAccount = (settings.expoAccounts || [])[0];
    setExpoAccountDraft(
      firstAccount ? prepareExpoAccountDraft(firstAccount) : createExpoAccountDraft(),
    );
    setExpoAccountToken('');
    setExpoProjectDraft(createExpoProjectDraft(firstAccount, settings.sshTargets?.[0]?.id));
  }, [settings.expoAccounts, settings.sshTargets]);

  const openEditAccount = useCallback((account: ExpoAccountConfig) => {
    setExpoAccountDraft(prepareExpoAccountDraft(account));
    setExpoProjectDraft(null);
    setExpoAccountToken('');
  }, []);

  const openEditProject = useCallback(
    (project: ExpoProjectConfig) => {
      setExpoProjectDraft(prepareExpoProjectDraft(project));
      const linkedAccount = (settings.expoAccounts || []).find(
        (entry) => entry.id === project.accountId,
      );
      setExpoAccountDraft(
        projectEditorShowsAccount && linkedAccount ? prepareExpoAccountDraft(linkedAccount) : null,
      );
      setExpoAccountToken('');
    },
    [projectEditorShowsAccount, settings.expoAccounts],
  );

  const togglePlatform = useCallback((platform: 'android' | 'ios' | 'web') => {
    setExpoProjectDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        platforms: toggleExpoProjectPlatform(current.platforms, platform),
      };
    });
  }, []);

  const syncAccount = useCallback(
    async (accountId?: string) => {
      const targetAccountId = accountId || expoAccountDraft?.id || settings.expoAccounts?.[0]?.id;
      if (!targetAccountId) {
        Alert.alert(t('common.error'), t('settings.expoAccountRequired'));
        return null;
      }

      try {
        const result = await syncExpoAccountProjects(targetAccountId);
        if (refreshDraftsAfterSync) {
          const syncedState = useSettingsStore.getState();
          const syncedAccount = syncedState.expoAccounts?.find(
            (account) => account.id === targetAccountId,
          );
          const syncedProjects =
            syncedState.expoProjects?.filter((project) => project.accountId === targetAccountId) ||
            [];

          if (syncedAccount) {
            setExpoAccountDraft(
              projectEditorShowsAccount || expoAccountDraft
                ? prepareExpoAccountDraft(syncedAccount)
                : null,
            );
          }
          if (syncedProjects.length > 0) {
            setExpoProjectDraft(prepareExpoProjectDraft(syncedProjects[0]));
          } else if (syncedAccount && projectEditorShowsAccount) {
            setExpoProjectDraft(
              createExpoProjectDraft(syncedAccount, settings.sshTargets?.[0]?.id),
            );
          }
        }
        Alert.alert(
          t('settings.expoProjectsSyncedTitle'),
          t('settings.expoProjectsSyncedCount', { count: result.projectCount }),
        );
        return result;
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('settings.expoProjectsSyncFailed'),
        );
        return null;
      }
    },
    [
      expoAccountDraft,
      projectEditorShowsAccount,
      refreshDraftsAfterSync,
      settings.expoAccounts,
      settings.sshTargets,
      t,
    ],
  );

  const saveAccount = useCallback(async () => {
    if (!expoAccountDraft) return null;
    const owner = expoAccountDraft.owner.trim();
    if (!owner) {
      Alert.alert(t('common.error'), t('settings.expoOwnerRequired'));
      return null;
    }

    const tokenRef = `expo_account_token_${expoAccountDraft.id}`;
    try {
      if (expoAccountToken.trim()) {
        await saveSecure(tokenRef, expoAccountToken.trim());
      } else {
        await deleteSecure(tokenRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return null;
    }

    const normalizedAccount: ExpoAccountConfig = {
      ...expoAccountDraft,
      name: expoAccountDraft.name.trim() || owner,
      owner,
      accountType: expoAccountDraft.accountType || 'personal',
      tokenRef: expoAccountToken.trim() ? tokenRef : undefined,
    };

    if ((settings.expoAccounts || []).some((account) => account.id === normalizedAccount.id)) {
      settings.updateExpoAccount(normalizedAccount);
    } else {
      settings.addExpoAccount(normalizedAccount);
    }
    onAccountSaved?.(normalizedAccount);

    if (normalizedAccount.tokenRef) {
      await syncAccount(normalizedAccount.id);
      close();
      return normalizedAccount;
    }

    close();
    return normalizedAccount;
  }, [close, expoAccountDraft, expoAccountToken, onAccountSaved, settings, syncAccount, t]);

  const removeAccount = useCallback(
    (id: string) => {
      confirmDeletion(t, 'settings.deleteExpoAccountDetachConfirm', () => {
        settings.removeExpoAccount(id);
        void deleteSecure(`expo_account_token_${id}`);
        onAccountDeleted?.(id);
        close();
      });
    },
    [close, onAccountDeleted, settings, t],
  );

  const saveProject = useCallback(async () => {
    if (!expoProjectDraft) return null;
    const linkedAccount = (settings.expoAccounts || []).find(
      (account) => account.id === expoProjectDraft.accountId,
    );
    if (!linkedAccount) {
      Alert.alert(t('common.error'), t('settings.expoLinkedAccountRequired'));
      return null;
    }

    const owner = expoProjectDraft.owner.trim() || linkedAccount.owner.trim();
    const slug = expoProjectDraft.slug.trim();
    if (!owner) {
      Alert.alert(t('common.error'), t('settings.expoProjectOwnerRequired'));
      return null;
    }
    if (!slug) {
      Alert.alert(t('common.error'), t('settings.expoProjectSlugRequired'));
      return null;
    }
    if (!expoProjectDraft.platforms?.length) {
      Alert.alert(t('common.error'), t('settings.expoTargetPlatformsRequired'));
      return null;
    }

    if (expoProjectDraft.mode === 'direct-ssh') {
      if (!expoProjectDraft.sshTargetId) {
        Alert.alert(t('common.error'), t('settings.expoDirectModeMissingSshTarget'));
        return null;
      }
      if (!expoProjectDraft.projectPath?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoDirectModeProjectPathRequired'));
        return null;
      }
    } else if (expoProjectDraft.mode === 'github-workflow') {
      if (!expoProjectDraft.repoFullName?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoWorkflowRepositoryRequired'));
        return null;
      }
      if (!expoProjectDraft.workflowFile?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoWorkflowFileRequired'));
        return null;
      }
    }

    const normalizedProject: ExpoProjectConfig = {
      ...expoProjectDraft,
      name: expoProjectDraft.name.trim() || `${owner}/${slug}`,
      slug,
      owner,
      projectPath: expoProjectDraft.projectPath?.trim() || undefined,
      repoFullName: expoProjectDraft.repoFullName?.trim() || undefined,
      workflowFile: expoProjectDraft.workflowFile?.trim() || undefined,
      workflowRef: expoProjectDraft.workflowRef?.trim() || undefined,
      defaultBuildProfile: expoProjectDraft.defaultBuildProfile?.trim() || undefined,
      defaultUpdateBranch: expoProjectDraft.defaultUpdateBranch?.trim() || undefined,
      updateChannel: expoProjectDraft.updateChannel?.trim() || undefined,
      webUrl: expoProjectDraft.webUrl?.trim() || undefined,
      previewUrl: expoProjectDraft.previewUrl?.trim() || undefined,
      customDomain: expoProjectDraft.customDomain?.trim() || undefined,
      platforms: expoProjectDraft.platforms,
    };

    if ((settings.expoProjects || []).some((project) => project.id === normalizedProject.id)) {
      settings.updateExpoProject(normalizedProject);
    } else {
      settings.addExpoProject(normalizedProject);
    }
    onProjectSaved?.(normalizedProject);
    close();
    return normalizedProject;
  }, [close, expoProjectDraft, onProjectSaved, settings, t]);

  const removeProject = useCallback(
    (id: string) => {
      confirmDeletion(t, 'settings.deleteExpoProjectConfirm', () => {
        settings.removeExpoProject(id);
        onProjectDeleted?.(id);
        close();
      });
    },
    [close, onProjectDeleted, settings, t],
  );

  const accountIsExisting = Boolean(
    expoAccountDraft &&
    (settings.expoAccounts || []).some((account) => account.id === expoAccountDraft.id),
  );
  const projectIsExisting = Boolean(
    expoProjectDraft &&
    (settings.expoProjects || []).some((project) => project.id === expoProjectDraft.id),
  );

  return {
    expoAccountDraft,
    setExpoAccountDraft,
    expoProjectDraft,
    setExpoProjectDraft,
    expoAccountToken,
    setExpoAccountToken,
    isEditorVisible: Boolean(expoAccountDraft || expoProjectDraft),
    accountIsExisting,
    projectIsExisting,
    openNew,
    openNewAccount,
    openNewProject,
    openEditAccount,
    openEditProject,
    close,
    togglePlatform,
    syncAccount,
    saveAccount,
    removeAccount,
    saveProject,
    removeProject,
  };
}
