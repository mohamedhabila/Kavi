import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  applyBrowserProviderPreset,
  BROWSER_PROVIDER_AUTH_OPTIONS,
  BROWSER_PROVIDER_OPTIONS,
  BROWSER_PROVIDER_PRESETS,
  getBrowserProviderAuthHint,
  getBrowserProviderLabel,
} from '../../../services/browser/providers';
import { SSH_HOST_KEY_POLICY_OPTIONS } from '../../../services/ssh/connector';
import { SSH_AUTH_MODE_OPTIONS } from '../../../services/ssh/native';
import {
  WORKSPACE_AUTH_MODE_OPTIONS,
  WORKSPACE_PROVIDER_OPTIONS,
} from '../../../services/workspaces/connector';
import { getWorkspaceTargetDisplayName } from '../../../services/workspaces/config';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../../types';
import type { AppPalette } from '../../../theme/useAppTheme';
import { createExpoAccountDraft, createExpoProjectDraft } from '../../configDrafts';
import { ConfigEditorModal, type ConfigEditorModalShellStyles } from '../ConfigEditorModal';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

const EXPO_MODE_OPTIONS: ExpoProjectConfig['mode'][] = [
  'eas-workflow',
  'direct-ssh',
  'github-workflow',
];

const EXPO_PLATFORM_OPTIONS: Array<'android' | 'ios' | 'web'> = ['android', 'ios', 'web'];

const MCP_TRANSPORT_OPTIONS: Array<NonNullable<McpServerConfig['transport']>> = [
  'auto',
  'streamable-http',
  'sse',
];

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
        isExisting && draft
          ? t('remoteWork.workspaceEditTitle', { name: getWorkspaceTargetDisplayName(draft) })
          : t('remoteWork.workspaceCreateTitle')
      }
      subtitle={
        isExisting ? t('remoteWork.workspaceEditSubtitle') : t('remoteWork.workspaceCreateSubtitle')
      }
      onClose={closeEditor}
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceBasicsSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.workspaceTargetName')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.name}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, name: value } : current))
              }
              placeholder={t('settings.workspaceTargetNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.detailLabel}>{t('settings.workspaceRootPath')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.rootPath}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, rootPath: value } : current))
              }
              placeholder={t('settings.workspaceRootPathPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.detailLabel}>{t('settings.workspaceBaseUrl')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.baseUrl || ''}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, baseUrl: value } : current))
              }
              placeholder={t('settings.workspaceBaseUrlPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.formHint}>{t('settings.workspaceConnectionHint')}</Text>
          </View>

          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceAccessSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.workspaceProvider')}</Text>
            <View style={styles.optionRow}>
              {WORKSPACE_PROVIDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.provider === option ? styles.optionChipActive : null,
                  ]}
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
                  style={[
                    styles.optionChip,
                    draft.authMode === option ? styles.optionChipActive : null,
                  ]}
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
                    setDraft((current) =>
                      current ? { ...current, queryTokenParam: value } : current,
                    )
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
                style={[
                  styles.optionChip,
                  !draft.browserProviderId ? styles.optionChipActive : null,
                ]}
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
                  setDraft((current) =>
                    current ? { ...current, sshTargetId: undefined } : current,
                  )
                }
              >
                <Text
                  style={[
                    styles.optionChipText,
                    !draft.sshTargetId ? styles.optionChipTextActive : null,
                  ]}
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
                    setDraft((current) =>
                      current ? { ...current, sshTargetId: target.id } : current,
                    )
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
                setDraft((current) =>
                  current ? { ...current, aiTaskCommandTemplate: value } : current,
                )
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

          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceRoutingSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.workspaceConfigRoots')}</Text>
            <TextInput
              style={[styles.configInput, styles.configTextArea]}
              value={workspaceConfigRootsText}
              onChangeText={setWorkspaceConfigRootsText}
              placeholder=".github&#10;.vscode"
              placeholderTextColor={colors.placeholder}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.formHint}>{t('settings.workspaceConfigRootsHint')}</Text>

            <View style={styles.switchRow}>
              <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
              <Switch
                value={draft.enabled}
                onValueChange={(value) =>
                  setDraft((current) => (current ? { ...current, enabled: value } : current))
                }
                trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
                thumbColor={draft.enabled ? colors.primary : colors.textSecondary}
              />
            </View>

            <View style={styles.configActionRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => void handleSaveWorkspaceConfig()}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.saveWorkspaceTarget')}
              >
                <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={closeEditor}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              {isExisting ? (
                <TouchableOpacity
                  style={styles.destructiveBtn}
                  onPress={() => handleDeleteWorkspaceConfig(draft.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.deleteWorkspaceTarget')}
                >
                  <Text style={styles.destructiveBtnText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </ConfigEditorModal>
  );
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
  setDraft: React.Dispatch<React.SetStateAction<SshTargetConfig | null>>;
  setSshPassphrase: (value: string) => void;
  setSshPassword: (value: string) => void;
  setSshPortText: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
  getLocalizedSshHostKeyPolicyOptionLabel: (policy?: SshTargetConfig['hostKeyPolicy']) => string;
  handleDeleteSshConfig: (id: string) => void | Promise<void>;
  handleFetchFingerprint: () => void | Promise<void>;
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
  setDraft,
  setSshPassphrase,
  setSshPassword,
  setSshPortText,
  setSshPrivateKey,
  getLocalizedSshHostKeyPolicyOptionLabel,
  handleDeleteSshConfig,
  handleFetchFingerprint,
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
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceBasicsSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.sshTargetName')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.name}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, name: value } : current))
              }
              placeholder={t('settings.sshTargetNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <View style={[styles.formGrid, isWide ? styles.formGridWide : null]}>
              <View style={styles.formGridItem}>
                <Text style={styles.detailLabel}>{t('settings.sshHost')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={draft.host}
                  onChangeText={(value) =>
                    setDraft((current) => (current ? { ...current, host: value } : current))
                  }
                  placeholder={t('settings.sshHostPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={[styles.formGridItem, styles.formGridPortItem]}>
                <Text style={styles.detailLabel}>{t('settings.sshPort')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={sshPortText}
                  onChangeText={setSshPortText}
                  placeholder="22"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <Text style={styles.detailLabel}>{t('settings.sshUsername')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.username}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, username: value } : current))
              }
              placeholder={t('settings.sshUsernamePlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.detailLabel}>{t('settings.sshRemoteRoot')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.remoteRoot || ''}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, remoteRoot: value } : current))
              }
              placeholder={t('settings.sshRemoteRootPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.formHint}>{t('settings.sshRemoteRootHint')}</Text>
          </View>

          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceAccessSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.sshAuthMode')}</Text>
            <View style={styles.optionRow}>
              {SSH_AUTH_MODE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionChip,
                    draft.authMode === option.value ? styles.optionChipActive : null,
                  ]}
                  onPress={() =>
                    setDraft((current) =>
                      current ? { ...current, authMode: option.value } : current,
                    )
                  }
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      draft.authMode === option.value ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {t(option.labelKey as any)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {draft.authMode === 'password' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.sshPassword')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={sshPassword}
                  onChangeText={setSshPassword}
                  placeholder={
                    draft.passwordRef
                      ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                      : t('settings.sshPasswordPlaceholder')
                  }
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : (
              <>
                <Text style={styles.detailLabel}>{t('settings.sshPrivateKey')}</Text>
                <TextInput
                  style={[styles.configInput, styles.configTextArea]}
                  value={sshPrivateKey}
                  onChangeText={setSshPrivateKey}
                  placeholder={
                    draft.privateKeyRef
                      ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                      : t('settings.sshPrivateKeyPlaceholder')
                  }
                  placeholderTextColor={colors.placeholder}
                  multiline
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.formHint}>{t('settings.sshPrivateKeyHint')}</Text>

                <Text style={styles.detailLabel}>{t('settings.sshPassphrase')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={sshPassphrase}
                  onChangeText={setSshPassphrase}
                  placeholder={t('settings.sshPassphrasePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}

            <Text style={styles.detailLabel}>{t('settings.sshHostKeyPolicy')}</Text>
            <View style={styles.optionRow}>
              {SSH_HOST_KEY_POLICY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.hostKeyPolicy === option ? styles.optionChipActive : null,
                  ]}
                  onPress={() =>
                    setDraft((current) =>
                      current ? { ...current, hostKeyPolicy: option } : current,
                    )
                  }
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      draft.hostKeyPolicy === option ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {getLocalizedSshHostKeyPolicyOptionLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.formHint}>{t('settings.sshHostKeyPolicyHint')}</Text>

            {draft.hostKeyPolicy === 'strict' ? (
              <>
                <View style={styles.inlineLabelRow}>
                  <Text style={styles.detailLabel}>{t('settings.sshTrustedFingerprint')}</Text>
                  <TouchableOpacity
                    onPress={() => void handleFetchFingerprint()}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.sshFetchFingerprint')}
                  >
                    <Text style={styles.inlineActionText}>
                      {sshFingerprintPending
                        ? t('settings.sshFetchingFingerprint')
                        : t('settings.sshFetchFingerprint')}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.configInput}
                  value={draft.trustedHostFingerprint || ''}
                  onChangeText={(value) =>
                    setDraft((current) =>
                      current ? { ...current, trustedHostFingerprint: value } : current,
                    )
                  }
                  placeholder={t('settings.sshTrustedFingerprintPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <Text style={styles.formHint}>{t('settings.sshTrustedFingerprintStrictHint')}</Text>
              </>
            ) : null}

            <View style={styles.switchRow}>
              <View style={styles.switchLabelWrap}>
                <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
                <Text style={styles.switchHint}>{t('remoteWork.enabledSurfaceHint')}</Text>
              </View>
              <Switch
                value={draft.enabled}
                onValueChange={(value) =>
                  setDraft((current) => (current ? { ...current, enabled: value } : current))
                }
                trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
                thumbColor={draft.enabled ? colors.primary : colors.textSecondary}
              />
            </View>

            <View style={styles.configActionRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => void handleSaveSshConfig()}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
              >
                <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={closeEditor}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              {isExisting ? (
                <TouchableOpacity
                  style={styles.destructiveBtn}
                  onPress={() => void handleDeleteSshConfig(draft.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.deleteSshTarget')}
                >
                  <Text style={styles.destructiveBtnText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </ConfigEditorModal>
  );
};

type RemoteWorkBrowserEditorModalProps = SharedProps & {
  visible: boolean;
  draft: BrowserProviderConfig | null;
  isExisting: boolean;
  browserApiKey: string;
  closeEditor: () => void;
  setDraft: React.Dispatch<React.SetStateAction<BrowserProviderConfig | null>>;
  setBrowserApiKey: (value: string) => void;
  getLocalizedBrowserAuthModeLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  handleDeleteBrowserConfig: (id: string) => void;
  handleSaveBrowserConfig: () => void | Promise<void>;
};

export const RemoteWorkBrowserEditorModal: React.FC<RemoteWorkBrowserEditorModalProps> = ({
  visible,
  draft,
  isExisting,
  browserApiKey,
  closeEditor,
  setDraft,
  setBrowserApiKey,
  getLocalizedBrowserAuthModeLabel,
  handleDeleteBrowserConfig,
  handleSaveBrowserConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <ConfigEditorModal
      visible={visible && Boolean(draft)}
      title={isExisting ? t('settings.editBrowserProvider') : t('settings.newBrowserProvider')}
      subtitle={t('remoteWork.browserManageHint')}
      onClose={closeEditor}
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceBasicsSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.browserProviderName')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.name}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, name: value } : current))
              }
              placeholder={t('settings.browserProviderNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.detailLabel}>{t('settings.browserProviderType')}</Text>
            <View style={styles.optionRow}>
              {BROWSER_PROVIDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.provider === option ? styles.optionChipActive : null,
                  ]}
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
                    {getBrowserProviderLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.detailLabel}>{t('settings.quickSetupTitle')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalChipRow}
            >
              {BROWSER_PROVIDER_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={styles.optionChip}
                  onPress={() =>
                    setDraft((current) =>
                      current ? applyBrowserProviderPreset(current, preset.id) : current,
                    )
                  }
                >
                  <Text style={styles.optionChipText}>{preset.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.detailLabel}>{t('settings.browserBaseUrl')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.baseUrl || ''}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, baseUrl: value } : current))
              }
              placeholder={t('settings.browserBaseUrlPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            {draft.provider === 'browserbase' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.browserProjectId')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={draft.projectId || ''}
                  onChangeText={(value) =>
                    setDraft((current) => (current ? { ...current, projectId: value } : current))
                  }
                  placeholder={t('settings.browserProjectIdPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}
          </View>

          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceAccessSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.browserAuthMode')}</Text>
            <View style={styles.optionRow}>
              {BROWSER_PROVIDER_AUTH_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.authMode === option ? styles.optionChipActive : null,
                  ]}
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
                    {getLocalizedBrowserAuthModeLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.formHint}>{getBrowserProviderAuthHint(draft)}</Text>

            {draft.authMode === 'query-token' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.browserQueryTokenParam')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={draft.queryTokenParam || ''}
                  onChangeText={(value) =>
                    setDraft((current) =>
                      current ? { ...current, queryTokenParam: value } : current,
                    )
                  }
                  placeholder={t('settings.browserQueryTokenParamPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}

            {draft.authMode !== 'none' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.browserApiKey')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={browserApiKey}
                  onChangeText={setBrowserApiKey}
                  placeholder={
                    draft.apiKeyRef
                      ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                      : t('settings.browserApiKeyPlaceholder')
                  }
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}

            <View style={styles.switchRow}>
              <View style={styles.switchLabelWrap}>
                <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
                <Text style={styles.switchHint}>{t('remoteWork.enabledSurfaceHint')}</Text>
              </View>
              <Switch
                value={draft.enabled}
                onValueChange={(value) =>
                  setDraft((current) => (current ? { ...current, enabled: value } : current))
                }
                trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
                thumbColor={draft.enabled ? colors.primary : colors.textSecondary}
              />
            </View>

            <View style={styles.configActionRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => void handleSaveBrowserConfig()}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
              >
                <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={closeEditor}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              {isExisting ? (
                <TouchableOpacity
                  style={styles.destructiveBtn}
                  onPress={() => handleDeleteBrowserConfig(draft.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.deleteBrowserProvider')}
                >
                  <Text style={styles.destructiveBtnText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </ConfigEditorModal>
  );
};

type RemoteWorkExpoEditorModalProps = SharedProps & {
  visible: boolean;
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
      title={t('remoteWork.expoTargetsTitle')}
      subtitle={t('remoteWork.expoManageHint')}
      onClose={closeEditor}
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {expoAccountDraft ? (
        <View style={styles.workspaceEditorSectionCard}>
          <Text style={styles.workspaceEditorSectionTitle}>{t('settings.expoAccounts')}</Text>

          {expoAccounts.length ? (
            <View style={styles.optionRow}>
              {expoAccounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={[
                    styles.optionChip,
                    expoAccountDraft.id === account.id ? styles.optionChipActive : null,
                  ]}
                  onPress={() => handleEditExpoAccount(account)}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      expoAccountDraft.id === account.id ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {account.name || account.owner}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.optionChip}
                onPress={() => {
                  setExpoAccountDraft(createExpoAccountDraft());
                  setExpoAccountToken('');
                }}
              >
                <Text style={styles.optionChipText}>{t('settings.addExpoAccount')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.detailLabel}>{t('settings.expoAccountName')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoAccountDraft.name}
            onChangeText={(value) =>
              setExpoAccountDraft((current) => (current ? { ...current, name: value } : current))
            }
            placeholder={t('settings.expoAccountNamePlaceholder')}
            placeholderTextColor={colors.placeholder}
          />

          <Text style={styles.detailLabel}>{t('settings.expoOwner')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoAccountDraft.owner}
            onChangeText={(value) =>
              setExpoAccountDraft((current) => (current ? { ...current, owner: value } : current))
            }
            placeholder={t('settings.expoOwnerPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.formHint}>{t('settings.expoOwnerHint')}</Text>

          <Text style={styles.detailLabel}>{t('settings.expoAccountType')}</Text>
          <View style={styles.optionRow}>
            {(['personal', 'robot'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionChip,
                  expoAccountDraft.accountType === option ? styles.optionChipActive : null,
                ]}
                onPress={() =>
                  setExpoAccountDraft((current) =>
                    current ? { ...current, accountType: option } : current,
                  )
                }
              >
                <Text
                  style={[
                    styles.optionChipText,
                    expoAccountDraft.accountType === option ? styles.optionChipTextActive : null,
                  ]}
                >
                  {option === 'robot'
                    ? t('settings.expoAccountTypeRobot')
                    : t('settings.expoAccountTypePersonal')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.detailLabel}>{t('settings.expoAccessToken')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoAccountToken}
            onChangeText={setExpoAccountToken}
            placeholder={
              expoAccountDraft.tokenRef
                ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                : t('settings.expoAccessTokenPlaceholder')
            }
            placeholderTextColor={colors.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.formHint}>{t('settings.expoAccessTokenHint')}</Text>
          <Text style={styles.detailValue}>
            {expoAccountDraft.lastProjectSyncError
              ? t('remoteWork.expoLastSyncFailed', {
                  message: expoAccountDraft.lastProjectSyncError,
                })
              : t('remoteWork.expoProjectsSyncedCount', {
                  count: expoAccountDraft.syncedProjectCount || 0,
                })}
          </Text>

          <View style={styles.configActionRow}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => void handleSaveExpoAccount()}
              accessibilityRole="button"
              accessibilityLabel={t('common.save')}
            >
              <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void handleSyncExpoAccount(expoAccountDraft.id)}
              accessibilityRole="button"
              accessibilityLabel={t('common.refresh')}
            >
              <Text style={styles.secondaryBtnText}>{t('common.refresh')}</Text>
            </TouchableOpacity>
            {expoAccountEditorIsExisting ? (
              <TouchableOpacity
                style={styles.destructiveBtn}
                onPress={() => handleDeleteExpoAccount(expoAccountDraft.id)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.deleteExpoAccount')}
              >
                <Text style={styles.destructiveBtnText}>{t('common.delete')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {expoProjectDraft ? (
        <View style={styles.workspaceEditorSectionCard}>
          <Text style={styles.workspaceEditorSectionTitle}>{t('settings.expoProjects')}</Text>

          {expoProjects.length ? (
            <View style={styles.optionRow}>
              {expoProjects.map((project) => (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.optionChip,
                    expoProjectDraft.id === project.id ? styles.optionChipActive : null,
                  ]}
                  onPress={() => handleEditExpoProject(project)}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      expoProjectDraft.id === project.id ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {project.name}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.optionChip}
                onPress={() => {
                  const linkedAccount = expoAccounts.find(
                    (account) =>
                      account.id === (expoProjectDraft.accountId || expoAccountDraft?.id),
                  );
                  setExpoProjectDraft(createExpoProjectDraft(linkedAccount, sshTargets[0]?.id));
                }}
              >
                <Text style={styles.optionChipText}>{t('settings.addExpoProject')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.optionChip}
                onPress={() =>
                  void handleSyncExpoAccount(expoProjectDraft.accountId || expoAccountDraft?.id)
                }
              >
                <Text style={styles.optionChipText}>{t('common.refresh')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.detailLabel}>{t('settings.expoProjectName')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoProjectDraft.name}
            onChangeText={(value) =>
              setExpoProjectDraft((current) => (current ? { ...current, name: value } : current))
            }
            placeholder={t('settings.expoProjectNamePlaceholder')}
            placeholderTextColor={colors.placeholder}
          />

          <View style={[styles.formGrid, isWide ? styles.formGridWide : null]}>
            <View style={styles.formGridItem}>
              <Text style={styles.detailLabel}>{t('settings.expoOwner')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.owner}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, owner: value } : current,
                  )
                }
                placeholder={t('settings.expoOwnerPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.formGridItem}>
              <Text style={styles.detailLabel}>{t('settings.expoProjectSlug')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.slug}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, slug: value } : current,
                  )
                }
                placeholder={t('settings.expoProjectSlugPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <Text style={styles.detailLabel}>{t('settings.expoLinkedAccount')}</Text>
          <View style={styles.optionRow}>
            {expoAccounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={[
                  styles.optionChip,
                  expoProjectDraft.accountId === account.id ? styles.optionChipActive : null,
                ]}
                onPress={() =>
                  setExpoProjectDraft((current) =>
                    current
                      ? { ...current, accountId: account.id, owner: current.owner || account.owner }
                      : current,
                  )
                }
              >
                <Text
                  style={[
                    styles.optionChipText,
                    expoProjectDraft.accountId === account.id ? styles.optionChipTextActive : null,
                  ]}
                >
                  {account.name || account.owner}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {!expoAccounts.length ? (
            <Text style={styles.formHint}>{t('settings.expoAccountRequired')}</Text>
          ) : null}

          <Text style={styles.detailLabel}>{t('settings.expoExecutionMode')}</Text>
          <View style={styles.optionRow}>
            {EXPO_MODE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionChip,
                  expoProjectDraft.mode === option ? styles.optionChipActive : null,
                ]}
                onPress={() =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, mode: option } : current,
                  )
                }
              >
                <Text
                  style={[
                    styles.optionChipText,
                    expoProjectDraft.mode === option ? styles.optionChipTextActive : null,
                  ]}
                >
                  {getLocalizedExpoModeLabel(option)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {expoProjectDraft.mode === 'direct-ssh' ? (
            <>
              <Text style={styles.detailLabel}>{t('settings.expoSshTarget')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalChipRow}
              >
                {sshTargets.map((target) => (
                  <TouchableOpacity
                    key={target.id}
                    style={[
                      styles.optionChip,
                      expoProjectDraft.sshTargetId === target.id ? styles.optionChipActive : null,
                    ]}
                    onPress={() =>
                      setExpoProjectDraft((current) =>
                        current ? { ...current, sshTargetId: target.id } : current,
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        expoProjectDraft.sshTargetId === target.id
                          ? styles.optionChipTextActive
                          : null,
                      ]}
                    >
                      {target.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {!sshTargets.length ? (
                <Text style={styles.formHint}>{t('remoteWork.noSshTargetsHint')}</Text>
              ) : null}

              <Text style={styles.detailLabel}>{t('settings.expoProjectPath')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.projectPath || ''}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, projectPath: value } : current,
                  )
                }
                placeholder={t('settings.expoProjectPathPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : expoProjectDraft.mode === 'github-workflow' ? (
            <>
              <Text style={styles.detailLabel}>{t('settings.expoGithubRepository')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.repoFullName || ''}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, repoFullName: value } : current,
                  )
                }
                placeholder={t('settings.expoGithubRepositoryPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.detailLabel}>{t('settings.expoWorkflowFile')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.workflowFile || ''}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, workflowFile: value } : current,
                  )
                }
                placeholder={t('settings.expoWorkflowFilePlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.detailLabel}>{t('settings.expoWorkflowRef')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.workflowRef || ''}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, workflowRef: value } : current,
                  )
                }
                placeholder={t('settings.expoWorkflowRefPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : (
            <Text style={styles.formHint}>{t('remoteWork.expoWorkflowManagedHint')}</Text>
          )}

          <View style={[styles.formGrid, isWide ? styles.formGridWide : null]}>
            <View style={styles.formGridItem}>
              <Text style={styles.detailLabel}>{t('settings.expoDefaultBuildProfile')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.defaultBuildProfile || ''}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, defaultBuildProfile: value } : current,
                  )
                }
                placeholder={t('settings.expoDefaultBuildProfilePlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.formGridItem}>
              <Text style={styles.detailLabel}>{t('settings.expoDefaultUpdateBranch')}</Text>
              <TextInput
                style={styles.configInput}
                value={expoProjectDraft.defaultUpdateBranch || ''}
                onChangeText={(value) =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, defaultUpdateBranch: value } : current,
                  )
                }
                placeholder={t('settings.expoDefaultUpdateBranchPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <Text style={styles.detailLabel}>{t('settings.expoUpdateChannel')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoProjectDraft.updateChannel || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, updateChannel: value } : current,
              )
            }
            placeholder={t('settings.expoUpdateChannelPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.detailLabel}>{t('settings.expoTargetPlatforms')}</Text>
          <View style={styles.optionRow}>
            {EXPO_PLATFORM_OPTIONS.map((platform) => {
              const selected = expoProjectDraft.platforms?.includes(platform);
              return (
                <TouchableOpacity
                  key={platform}
                  style={[styles.optionChip, selected ? styles.optionChipActive : null]}
                  onPress={() => toggleExpoPlatform(platform)}
                >
                  <Text
                    style={[styles.optionChipText, selected ? styles.optionChipTextActive : null]}
                  >
                    {platform}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.detailLabel}>{t('settings.expoProductionWebUrl')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoProjectDraft.webUrl || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) => (current ? { ...current, webUrl: value } : current))
            }
            placeholder={t('settings.expoProductionWebUrlPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={styles.detailLabel}>{t('settings.expoPreviewUrl')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoProjectDraft.previewUrl || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, previewUrl: value } : current,
              )
            }
            placeholder={t('settings.expoPreviewUrlPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={styles.detailLabel}>{t('settings.expoCustomDomain')}</Text>
          <TextInput
            style={styles.configInput}
            value={expoProjectDraft.customDomain || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, customDomain: value } : current,
              )
            }
            placeholder={t('settings.expoCustomDomainPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.switchRow}>
            <View style={styles.switchLabelWrap}>
              <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
              <Text style={styles.switchHint}>{t('remoteWork.enabledSurfaceHint')}</Text>
            </View>
            <Switch
              value={expoProjectDraft.enabled}
              onValueChange={(value) =>
                setExpoProjectDraft((current) =>
                  current ? { ...current, enabled: value } : current,
                )
              }
              trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
              thumbColor={expoProjectDraft.enabled ? colors.primary : colors.textSecondary}
            />
          </View>

          <View style={styles.configActionRow}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => void handleSaveExpoProject()}
              accessibilityRole="button"
              accessibilityLabel={t('common.save')}
            >
              <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={closeEditor}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Text style={styles.secondaryBtnText}>{t('common.close')}</Text>
            </TouchableOpacity>
            {expoProjectEditorIsExisting ? (
              <TouchableOpacity
                style={styles.destructiveBtn}
                onPress={() => handleDeleteExpoProject(expoProjectDraft.id)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.deleteExpoProject')}
              >
                <Text style={styles.destructiveBtnText}>{t('common.delete')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
    </ConfigEditorModal>
  );
};

type RemoteWorkMcpEditorModalProps = SharedProps & {
  visible: boolean;
  draft: McpServerConfig | null;
  isExisting: boolean;
  mcpToken: string;
  closeEditor: () => void;
  setDraft: React.Dispatch<React.SetStateAction<McpServerConfig | null>>;
  setMcpToken: (value: string) => void;
  getLocalizedMcpTransportLabel: (transport?: McpServerConfig['transport']) => string;
  handleDeleteMcpConfig: (id: string) => void;
  handleSaveMcpConfig: () => void | Promise<void>;
};

export const RemoteWorkMcpEditorModal: React.FC<RemoteWorkMcpEditorModalProps> = ({
  visible,
  draft,
  isExisting,
  mcpToken,
  closeEditor,
  setDraft,
  setMcpToken,
  getLocalizedMcpTransportLabel,
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
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceBasicsSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.serverName')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.name}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, name: value } : current))
              }
              placeholder={t('settings.serverNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.detailLabel}>{t('settings.serverUrl')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.url}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, url: value } : current))
              }
              placeholder={t('settings.serverUrlPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.formHint}>{t('settings.mcpManualServerHint')}</Text>

            <Text style={styles.detailLabel}>{t('settings.serverTransport')}</Text>
            <View style={styles.optionRow}>
              {MCP_TRANSPORT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.transport === option ? styles.optionChipActive : null,
                  ]}
                  onPress={() =>
                    setDraft((current) => (current ? { ...current, transport: option } : current))
                  }
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      draft.transport === option ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {getLocalizedMcpTransportLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {draft.transport === 'sse' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.serverLegacySseUrl')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={draft.sseUrl || ''}
                  onChangeText={(value) =>
                    setDraft((current) => (current ? { ...current, sseUrl: value } : current))
                  }
                  placeholder={t('settings.serverLegacySseUrlPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={styles.formHint}>{t('settings.serverLegacySseUrlHint')}</Text>
              </>
            ) : null}

            <Text style={styles.detailLabel}>{t('settings.serverTimeoutMs')}</Text>
            <TextInput
              style={styles.configInput}
              value={String(draft.timeoutMs ?? 30000)}
              onChangeText={(value) => {
                const nextTimeout = Number.parseInt(value, 10);
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        timeoutMs: Number.isFinite(nextTimeout) ? nextTimeout : undefined,
                      }
                    : current,
                );
              }}
              placeholder="30000"
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
            />
          </View>

          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceAccessSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.serverToken')}</Text>
            <TextInput
              style={styles.configInput}
              value={mcpToken}
              onChangeText={setMcpToken}
              placeholder={
                draft.tokenRef
                  ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                  : t('settings.serverTokenPlaceholder')
              }
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.switchRow}>
              <View style={styles.switchLabelWrap}>
                <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
                <Text style={styles.switchHint}>{t('remoteWork.enabledSurfaceHint')}</Text>
              </View>
              <Switch
                value={draft.enabled}
                onValueChange={(value) =>
                  setDraft((current) => (current ? { ...current, enabled: value } : current))
                }
                trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
                thumbColor={draft.enabled ? colors.primary : colors.textSecondary}
              />
            </View>

            <View style={styles.configActionRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => void handleSaveMcpConfig()}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
              >
                <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={closeEditor}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              {isExisting ? (
                <TouchableOpacity
                  style={styles.destructiveBtn}
                  onPress={() => handleDeleteMcpConfig(draft.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.deleteMcpServer')}
                >
                  <Text style={styles.destructiveBtnText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </ConfigEditorModal>
  );
};
