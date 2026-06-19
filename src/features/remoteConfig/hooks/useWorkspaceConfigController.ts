import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  createWorkspaceDraft,
  formatPathList,
  parsePathList,
  prepareWorkspaceDraft,
} from '../../../screens/configDrafts';
import { deleteSecure, saveSecure } from '../../../services/storage/SecureStorage';
import {
  getWorkspaceTargetDisplayName,
  normalizeWorkspaceTargetLinks,
} from '../../../services/workspaces/config';
import { isValidWorkspaceBaseUrl } from '../../../services/workspaces/connector';
import type { WorkspaceTargetConfig } from '../../../types/remote';
import { SharedControllerOptions, confirmDeletion } from './useRemoteConfigControllerShared';

export function useWorkspaceConfigController(
  options: SharedControllerOptions & {
    onSaved?: (target: WorkspaceTargetConfig) => void;
    onDeleted?: (id: string) => void;
  },
) {
  const { settings, t, onSaved, onDeleted } = options;
  const [draft, setDraft] = useState<WorkspaceTargetConfig | null>(null);
  const [workspaceAccessToken, setWorkspaceAccessToken] = useState('');
  const [workspaceConfigRootsText, setWorkspaceConfigRootsText] = useState('');

  const close = useCallback(() => {
    setDraft(null);
    setWorkspaceAccessToken('');
    setWorkspaceConfigRootsText('');
  }, []);

  const openNew = useCallback((overrides: Partial<WorkspaceTargetConfig> = {}) => {
    const nextDraft = createWorkspaceDraft(overrides);
    setDraft(nextDraft);
    setWorkspaceConfigRootsText(formatPathList(nextDraft.configRoots));
    setWorkspaceAccessToken('');
  }, []);

  const openEdit = useCallback((target: WorkspaceTargetConfig) => {
    setDraft(prepareWorkspaceDraft(target));
    setWorkspaceConfigRootsText(formatPathList(target.configRoots));
    setWorkspaceAccessToken('');
  }, []);

  const save = useCallback(async () => {
    if (!draft) return null;
    const rootPath = draft.rootPath.trim();
    const baseUrl = (draft.baseUrl || '').trim();
    const provider = draft.provider || 'code-server';
    const authMode = draft.authMode || 'none';
    const queryTokenParam = (draft.queryTokenParam || '').trim();
    const accessToken = workspaceAccessToken.trim();

    if (!rootPath) {
      Alert.alert(t('common.error'), t('settings.workspaceRootRequired'));
      return null;
    }
    if (baseUrl && !isValidWorkspaceBaseUrl(baseUrl)) {
      Alert.alert(t('common.error'), t('settings.workspaceBaseUrlInvalid'));
      return null;
    }
    if (authMode === 'query-token' && baseUrl && !queryTokenParam) {
      Alert.alert(t('common.error'), t('settings.workspaceQueryTokenParamRequired'));
      return null;
    }
    if (authMode !== 'none' && !accessToken && !draft.accessTokenRef) {
      Alert.alert(t('common.error'), t('settings.workspaceAccessTokenRequired'));
      return null;
    }

    const accessTokenRef = `workspace_access_token_${draft.id}`;
    try {
      if (authMode !== 'none' && accessToken) {
        await saveSecure(accessTokenRef, accessToken);
      } else if (authMode === 'none') {
        await deleteSecure(accessTokenRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return null;
    }

    const normalizedTarget = normalizeWorkspaceTargetLinks(
      {
        ...draft,
        name: getWorkspaceTargetDisplayName({
          ...draft,
          rootPath,
          provider,
        }),
        rootPath,
        configRoots: parsePathList(workspaceConfigRootsText),
        provider,
        baseUrl,
        authMode,
        accessTokenRef: authMode !== 'none' ? draft.accessTokenRef || accessTokenRef : undefined,
        queryTokenParam: authMode === 'query-token' ? queryTokenParam : undefined,
        browserProviderId: (draft.browserProviderId || '').trim() || undefined,
        sshTargetId: (draft.sshTargetId || '').trim() || undefined,
        aiTaskCommandTemplate: (draft.aiTaskCommandTemplate || '').trim() || undefined,
      },
      {
        browserProviders: settings.browserProviders || [],
        sshTargets: settings.sshTargets || [],
      },
    );

    if ((settings.workspaceTargets || []).some((target) => target.id === normalizedTarget.id)) {
      settings.updateWorkspaceTarget(normalizedTarget);
    } else {
      settings.addWorkspaceTarget(normalizedTarget);
    }
    onSaved?.(normalizedTarget);
    close();
    return normalizedTarget;
  }, [close, draft, onSaved, settings, t, workspaceAccessToken, workspaceConfigRootsText]);

  const remove = useCallback(
    (id: string) => {
      confirmDeletion(t, 'settings.deleteWorkspaceTargetConfirm', () => {
        settings.removeWorkspaceTarget(id);
        void deleteSecure(`workspace_access_token_${id}`);
        onDeleted?.(id);
        close();
      });
    },
    [close, onDeleted, settings, t],
  );

  const isExisting = Boolean(
    draft && (settings.workspaceTargets || []).some((target) => target.id === draft.id),
  );

  return {
    draft,
    setDraft,
    workspaceAccessToken,
    setWorkspaceAccessToken,
    workspaceConfigRootsText,
    setWorkspaceConfigRootsText,
    isEditorVisible: Boolean(draft),
    isExisting,
    openNew,
    openEdit,
    close,
    save,
    remove,
  };
}
