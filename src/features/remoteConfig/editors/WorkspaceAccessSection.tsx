import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  WORKSPACE_AUTH_MODE_OPTIONS,
  WORKSPACE_PROVIDER_OPTIONS,
} from '../../../services/workspaces/connector';
import type { AppPalette } from '../../../theme/useAppTheme';
import type {
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type WorkspaceAccessSectionProps = {
  draft: WorkspaceTargetConfig;
  browserProviders: BrowserProviderConfig[];
  sshTargets: SshTargetConfig[];
  workspaceAccessToken: string;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  setDraft: React.Dispatch<React.SetStateAction<WorkspaceTargetConfig | null>>;
  setWorkspaceAccessToken: (value: string) => void;
  getLocalizedWorkspaceProviderLabel: (provider?: WorkspaceTargetConfig['provider']) => string;
  getWorkspaceAuthModeLabel: (authMode?: WorkspaceTargetConfig['authMode']) => string;
};

export const WorkspaceAccessSection: React.FC<WorkspaceAccessSectionProps> = ({
  draft,
  browserProviders,
  sshTargets,
  workspaceAccessToken,
  colors,
  styles,
  t,
  setDraft,
  setWorkspaceAccessToken,
  getLocalizedWorkspaceProviderLabel,
  getWorkspaceAuthModeLabel,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceAccessSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.workspaceProvider')}</Text>
      <View style={styles.optionRow}>
        {WORKSPACE_PROVIDER_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionChip, draft.provider === option ? styles.optionChipActive : null]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, provider: option } : current))
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.provider === option ? styles.optionChipTextActive : null,
              ]}
            >
              {getLocalizedWorkspaceProviderLabel(option)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.detailLabel}>{t('settings.workspaceAuthMode')}</Text>
      <View style={styles.optionRow}>
        {WORKSPACE_AUTH_MODE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionChip, draft.authMode === option ? styles.optionChipActive : null]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, authMode: option } : current))
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.authMode === option ? styles.optionChipTextActive : null,
              ]}
            >
              {getWorkspaceAuthModeLabel(option)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {draft.authMode === 'query-token' ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.workspaceQueryTokenParam')}</Text>
          <TextInput
            style={styles.configInput}
            value={draft.queryTokenParam || ''}
            onChangeText={(value) =>
              setDraft((current) => (current ? { ...current, queryTokenParam: value } : current))
            }
            placeholder={t('settings.workspaceQueryTokenParamPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}

      {draft.authMode !== 'none' ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.workspaceAccessToken')}</Text>
          <TextInput
            style={styles.configInput}
            value={workspaceAccessToken}
            onChangeText={setWorkspaceAccessToken}
            placeholder={
              draft.accessTokenRef
                ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                : t('settings.workspaceAccessTokenPlaceholder')
            }
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={styles.formHint}>{t('settings.workspaceAccessTokenHint')}</Text>
        </>
      ) : null}

      <Text style={styles.detailLabel}>{t('remoteWork.workspaceBrowserProvider')}</Text>
      <View style={styles.optionRow}>
        <TouchableOpacity
          style={[styles.optionChip, !draft.browserProviderId ? styles.optionChipActive : null]}
          onPress={() =>
            setDraft((current) =>
              current ? { ...current, browserProviderId: undefined } : current,
            )
          }
        >
          <Text
            style={[
              styles.optionChipText,
              !draft.browserProviderId ? styles.optionChipTextActive : null,
            ]}
          >
            {t('remoteWork.workspaceBrowserProviderAutoSelect')}
          </Text>
        </TouchableOpacity>
        {browserProviders.map((provider) => (
          <TouchableOpacity
            key={provider.id}
            style={[
              styles.optionChip,
              draft.browserProviderId === provider.id ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setDraft((current) =>
                current ? { ...current, browserProviderId: provider.id } : current,
              )
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.browserProviderId === provider.id ? styles.optionChipTextActive : null,
              ]}
            >
              {provider.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.formHint}>{t('remoteWork.workspaceBrowserProviderHint')}</Text>

      <Text style={styles.detailLabel}>{t('remoteWork.workspaceSshTarget')}</Text>
      <View style={styles.optionRow}>
        <TouchableOpacity
          style={[styles.optionChip, !draft.sshTargetId ? styles.optionChipActive : null]}
          onPress={() =>
            setDraft((current) => (current ? { ...current, sshTargetId: undefined } : current))
          }
        >
          <Text
            style={[styles.optionChipText, !draft.sshTargetId ? styles.optionChipTextActive : null]}
          >
            {t('common.none')}
          </Text>
        </TouchableOpacity>
        {sshTargets.map((target) => (
          <TouchableOpacity
            key={target.id}
            style={[
              styles.optionChip,
              draft.sshTargetId === target.id ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, sshTargetId: target.id } : current))
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.sshTargetId === target.id ? styles.optionChipTextActive : null,
              ]}
            >
              {target.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.formHint}>{t('remoteWork.workspaceSshTargetHint')}</Text>

      <Text style={styles.detailLabel}>{t('remoteWork.workspaceAiCommandTemplate')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.aiTaskCommandTemplate || ''}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, aiTaskCommandTemplate: value } : current))
        }
        placeholder={
          draft.provider === 'cursor'
            ? t('remoteWork.workspaceAiCommandTemplateCursorPlaceholder')
            : t('remoteWork.workspaceAiCommandTemplateDefaultPlaceholder')
        }
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <Text style={styles.formHint}>{t('remoteWork.workspaceAiCommandTemplateHint')}</Text>
    </View>
  );
};
