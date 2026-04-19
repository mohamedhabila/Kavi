import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Cpu, Eye, EyeOff, Key, Trash2 } from 'lucide-react-native';

import {
  applyBrowserProviderPreset,
  BROWSER_PROVIDER_AUTH_OPTIONS,
  BROWSER_PROVIDER_OPTIONS,
  BROWSER_PROVIDER_PRESETS,
  getBrowserProviderAuthHint,
  getBrowserProviderAuthLabel,
  getBrowserProviderLabel,
  getBrowserProviderReadiness,
} from '../../../services/browser/providers';
import { LocalModelDownloadPanel } from '../../../components/localLlm/LocalModelDownloadPanel';
import {
  getSshHostKeyPolicyLabel,
  SSH_HOST_KEY_POLICY_OPTIONS,
} from '../../../services/ssh/connector';
import { SSH_AUTH_MODE_OPTIONS, SSH_PTY_OPTIONS } from '../../../services/ssh/native';
import {
  getWorkspaceProviderLabel,
  WORKSPACE_AUTH_MODE_OPTIONS,
  WORKSPACE_PROVIDER_OPTIONS,
} from '../../../services/workspaces/connector';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  LlmProviderConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../../types';
import type { AppPalette } from '../../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SharedEditorProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  scrollRef: React.RefObject<ScrollView | null>;
  onBack: () => void;
  onTrackedScroll: (y: number) => void;
  onRestore: () => void;
};

type SettingsEditorFrameProps = SharedEditorProps & {
  title: string;
  onSave: () => void | Promise<void>;
  saveDisabled?: boolean;
  children: React.ReactNode;
};

const SettingsEditorFrame: React.FC<SettingsEditorFrameProps> = ({
  title,
  onSave,
  saveDisabled = false,
  children,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity
          onPress={() => void onSave()}
          disabled={saveDisabled}
          accessibilityRole="button"
          accessibilityLabel={t('common.save')}
          accessibilityState={{ disabled: saveDisabled }}
        >
          <Text style={[styles.saveBtn, saveDisabled ? styles.saveBtnDisabled : null]}>
            {t('common.save')}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => onTrackedScroll(event.nativeEvent.contentOffset.y)}
        onContentSizeChange={onRestore}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
};

type SettingsProviderEditorProps = SharedEditorProps & {
  editingProvider: LlmProviderConfig;
  isExisting: boolean;
  isOnDevice: boolean;
  canSave: boolean;
  localCatalog: Array<{ id: string; name: string; sizeLabel: string }>;
  selectedLocalCatalogEntry: any;
  tempApiKey: string;
  showApiKey: boolean;
  editingLocalModelDownloadState: any;
  editingLocalModelWasJustDownloaded: boolean;
  handleDeleteProvider: (id: string) => void;
  handleDownloadSelectedLocalModel: () => void | Promise<void>;
  handleSaveProvider: () => void | Promise<void>;
  isLocalLlmModelInstalled: (provider: LlmProviderConfig, modelId: string) => boolean;
  onToggleShowApiKey: () => void;
  setEditingProvider: (provider: LlmProviderConfig) => void;
  setTempApiKey: (value: string) => void;
};

export const SettingsProviderEditor: React.FC<SettingsProviderEditorProps> = ({
  editingProvider,
  isExisting,
  isOnDevice,
  canSave,
  localCatalog,
  selectedLocalCatalogEntry,
  tempApiKey,
  showApiKey,
  editingLocalModelDownloadState,
  editingLocalModelWasJustDownloaded,
  handleDeleteProvider,
  handleDownloadSelectedLocalModel,
  handleSaveProvider,
  isLocalLlmModelInstalled,
  onToggleShowApiKey,
  setEditingProvider,
  setTempApiKey,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editProvider') : t('settings.newProvider')}
      onSave={handleSaveProvider}
      saveDisabled={!canSave}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      <Text style={styles.label}>{t('settings.providerName')}</Text>
      <TextInput
        style={styles.input}
        value={editingProvider.name}
        onChangeText={(value) => setEditingProvider({ ...editingProvider, name: value })}
        placeholder={t('settings.providerNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      {isOnDevice ? (
        <View style={styles.localProviderNotice}>
          <Cpu size={18} color={colors.primary} />
          <View style={styles.localProviderNoticeBody}>
            <Text style={styles.localProviderNoticeTitle}>
              {t('settings.onDeviceProviderTitle')}
            </Text>
            <Text style={styles.localProviderNoticeText}>{t('settings.onDeviceProviderHint')}</Text>
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.label}>{t('settings.baseUrl')}</Text>
          <TextInput
            style={styles.input}
            value={editingProvider.baseUrl}
            onChangeText={(value) => setEditingProvider({ ...editingProvider, baseUrl: value })}
            placeholder={t('settings.baseUrlPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            keyboardType="url"
          />

          <Text style={styles.label}>{t('settings.apiKey')}</Text>
          <View style={styles.apiKeyRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={tempApiKey}
              onChangeText={setTempApiKey}
              placeholder={t('settings.apiKeyPlaceholder')}
              placeholderTextColor={colors.placeholder}
              secureTextEntry={!showApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
            />
            <TouchableOpacity
              onPress={onToggleShowApiKey}
              style={styles.eyeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('settings.apiKey')}
            >
              {showApiKey ? (
                <EyeOff size={20} color={colors.textSecondary} />
              ) : (
                <Eye size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={styles.label}>{t('settings.defaultModel')}</Text>
      {isOnDevice ? (
        <View style={styles.localModelGrid}>
          {localCatalog.map((entry) => {
            const active = editingProvider.model === entry.id;
            const installed = isLocalLlmModelInstalled(editingProvider, entry.id);
            return (
              <TouchableOpacity
                key={entry.id}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => setEditingProvider({ ...editingProvider, model: entry.id })}
                accessibilityRole="button"
                accessibilityLabel={t('settings.selectOnDeviceModel', { name: entry.name })}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                  {entry.name}
                </Text>
                <Text style={[styles.localModelMeta, active && styles.presetChipTextActive]}>
                  {installed ? t('settings.onDeviceModelInstalled') : entry.sizeLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <TextInput
          style={styles.input}
          value={editingProvider.model}
          onChangeText={(value) => setEditingProvider({ ...editingProvider, model: value })}
          placeholder={t('settings.defaultModelPlaceholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
        />
      )}

      {isOnDevice && selectedLocalCatalogEntry ? (
        <LocalModelDownloadPanel
          entry={selectedLocalCatalogEntry}
          status={editingLocalModelDownloadState.status}
          progress={editingLocalModelDownloadState.progress}
          message={editingLocalModelDownloadState.errorMessage}
          alreadyInstalled={isLocalLlmModelInstalled(editingProvider, selectedLocalCatalogEntry.id)}
          wasJustDownloaded={editingLocalModelWasJustDownloaded}
          onDownload={() => void handleDownloadSelectedLocalModel()}
        />
      ) : null}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingProvider.enabled}
          onValueChange={(value) => setEditingProvider({ ...editingProvider, enabled: value })}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteProvider(editingProvider.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteProvider')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteProvider')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};

type SettingsMcpEditorProps = SharedEditorProps & {
  editingMcp: McpServerConfig;
  normalizedEditingMcp: McpServerConfig | null;
  hasStoredMcpOauthSession: boolean;
  isExisting: boolean;
  mcpHeadersText: string;
  mcpOauthClientSecret: string;
  mcpTimeoutText: string;
  getMcpMetadataChips: (server: McpServerConfig) => string[];
  handleDeleteMcp: (id: string) => void;
  handleResetMcpOAuthSession: () => void;
  handleSaveMcp: () => void | Promise<void>;
  setEditingMcp: (server: McpServerConfig) => void;
  setMcpHeadersText: (value: string) => void;
  setMcpOauthClientSecret: (value: string) => void;
  setMcpTimeoutText: (value: string) => void;
};

export const SettingsMcpEditor: React.FC<SettingsMcpEditorProps> = ({
  editingMcp,
  normalizedEditingMcp,
  hasStoredMcpOauthSession,
  isExisting,
  mcpHeadersText,
  mcpOauthClientSecret,
  mcpTimeoutText,
  getMcpMetadataChips,
  handleDeleteMcp,
  handleResetMcpOAuthSession,
  handleSaveMcp,
  setEditingMcp,
  setMcpHeadersText,
  setMcpOauthClientSecret,
  setMcpTimeoutText,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editMcpServer') : t('settings.newMcpServer')}
      onSave={handleSaveMcp}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      {normalizedEditingMcp ? (
        <View style={styles.mcpMetadataCard}>
          <Text style={styles.secureKeyTitle}>{t('settings.mcpMetadata')}</Text>
          <View style={styles.mcpChipRow}>
            {getMcpMetadataChips(normalizedEditingMcp).map((chip) => (
              <View key={`settings-${chip}`} style={styles.statusPill}>
                <Text style={styles.statusPillText}>{chip}</Text>
              </View>
            ))}
          </View>
          {normalizedEditingMcp.trust?.registryName ? (
            <Text style={styles.setupDetail}>
              {t('mcpStatus.registryName', { name: normalizedEditingMcp.trust.registryName })}
            </Text>
          ) : null}
          {normalizedEditingMcp.trust?.websiteUrl ? (
            <Text style={styles.setupDetail}>
              {t('mcpStatus.website', { url: normalizedEditingMcp.trust.websiteUrl })}
            </Text>
          ) : null}
          <Text style={styles.secureKeyHint}>
            {normalizedEditingMcp.trust?.source === 'official-registry'
              ? t('settings.mcpOfficialRegistryHint')
              : t('settings.mcpManualServerHint')}
          </Text>
          {normalizedEditingMcp.capabilities?.authMode === 'oauth' || hasStoredMcpOauthSession ? (
            <View style={styles.mcpOauthRow}>
              <View
                style={[
                  styles.statusPill,
                  hasStoredMcpOauthSession ? styles.statusPillReady : styles.statusPillMissing,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    hasStoredMcpOauthSession
                      ? styles.statusPillTextReady
                      : styles.statusPillTextMissing,
                  ]}
                >
                  {hasStoredMcpOauthSession
                    ? t('settings.mcpOAuthSessionSaved')
                    : t('settings.mcpOAuthSessionNotConnected')}
                </Text>
              </View>
              {isExisting ? (
                <TouchableOpacity
                  style={styles.inlineLink}
                  onPress={handleResetMcpOAuthSession}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.mcpResetOAuthSession')}
                >
                  <Key size={14} color={colors.primary} />
                  <Text style={styles.inlineLinkText}>{t('settings.mcpResetOAuthSession')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.label}>{t('settings.serverName')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.name}
        onChangeText={(value) => setEditingMcp({ ...editingMcp, name: value })}
        placeholder={t('settings.serverNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>{t('settings.serverUrl')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.url}
        onChangeText={(value) => setEditingMcp({ ...editingMcp, url: value })}
        placeholder={t('settings.serverUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        keyboardType="url"
      />

      <Text style={styles.label}>{t('settings.serverToken')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.token || ''}
        onChangeText={(value) => setEditingMcp({ ...editingMcp, token: value })}
        placeholder={t('settings.serverTokenPlaceholder')}
        placeholderTextColor={colors.placeholder}
        secureTextEntry
        autoCapitalize="none"
      />

      <Text style={styles.label}>{t('settings.mcpOAuthClientId')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.oauth?.clientId || ''}
        onChangeText={(text) =>
          setEditingMcp({ ...editingMcp, oauth: { ...editingMcp.oauth, clientId: text } })
        }
        placeholder={t('settings.mcpOAuthClientIdPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
      />

      <Text style={styles.label}>{t('settings.mcpOAuthClientSecret')}</Text>
      <TextInput
        style={styles.input}
        value={mcpOauthClientSecret}
        onChangeText={setMcpOauthClientSecret}
        placeholder={t('settings.mcpOAuthClientSecretPlaceholder')}
        placeholderTextColor={colors.placeholder}
        secureTextEntry
        autoCapitalize="none"
      />

      <Text style={styles.label}>{t('settings.mcpOAuthAuthorizationUrl')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.oauth?.authorizationUrl || ''}
        onChangeText={(text) =>
          setEditingMcp({ ...editingMcp, oauth: { ...editingMcp.oauth, authorizationUrl: text } })
        }
        placeholder={t('settings.mcpOAuthAuthorizationUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        keyboardType="url"
      />

      <Text style={styles.label}>{t('settings.mcpOAuthTokenUrl')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.oauth?.tokenUrl || ''}
        onChangeText={(text) =>
          setEditingMcp({ ...editingMcp, oauth: { ...editingMcp.oauth, tokenUrl: text } })
        }
        placeholder={t('settings.mcpOAuthTokenUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        keyboardType="url"
      />

      <Text style={styles.label}>{t('settings.mcpOAuthScope')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.oauth?.scope || ''}
        onChangeText={(text) =>
          setEditingMcp({ ...editingMcp, oauth: { ...editingMcp.oauth, scope: text } })
        }
        placeholder={t('settings.mcpOAuthScopePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
      />

      <Text style={styles.label}>{t('settings.mcpOAuthProxyProjectName')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.oauth?.projectNameForProxy || ''}
        onChangeText={(text) =>
          setEditingMcp({
            ...editingMcp,
            oauth: { ...editingMcp.oauth, projectNameForProxy: text },
          })
        }
        placeholder={t('settings.mcpOAuthProxyProjectNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
      />

      <Text style={styles.label}>{t('settings.serverTransport')}</Text>
      <View style={styles.themeRow}>
        {(['auto', 'streamable-http', 'sse'] as const).map((transport) => (
          <TouchableOpacity
            key={transport}
            style={[styles.themeBtn, editingMcp.transport === transport && styles.themeBtnActive]}
            onPress={() => setEditingMcp({ ...editingMcp, transport })}
          >
            <Text
              style={[
                styles.themeBtnText,
                editingMcp.transport === transport && styles.themeBtnTextActive,
              ]}
            >
              {t(
                `settings.serverTransport${transport === 'auto' ? 'Auto' : transport === 'sse' ? 'Sse' : 'Http'}`,
              )}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('settings.serverHeaders')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.serverHeadersHint')}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={mcpHeadersText}
        onChangeText={setMcpHeadersText}
        placeholder={t('settings.serverHeadersPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <Text style={styles.label}>{t('settings.serverTimeoutMs')}</Text>
      <TextInput
        style={styles.input}
        value={mcpTimeoutText}
        onChangeText={setMcpTimeoutText}
        placeholder="20000"
        placeholderTextColor={colors.placeholder}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>{t('settings.serverLegacySseUrl')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.serverLegacySseUrlHint')}</Text>
      <TextInput
        style={styles.input}
        value={editingMcp.sseUrl || ''}
        onChangeText={(value) => setEditingMcp({ ...editingMcp, sseUrl: value })}
        placeholder={t('settings.serverLegacySseUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        keyboardType="url"
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingMcp.enabled}
          onValueChange={(value) => setEditingMcp({ ...editingMcp, enabled: value })}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteMcp(editingMcp.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteMcpServer')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteMcpServer')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};

type SettingsSshEditorProps = SharedEditorProps & {
  editingSsh: SshTargetConfig;
  isExisting: boolean;
  sshFingerprintPending: boolean;
  sshPassphrase: string;
  sshPassword: string;
  sshPortText: string;
  sshPrivateKey: string;
  handleDeleteSsh: (id: string) => void;
  handleFetchSshFingerprint: () => void | Promise<void>;
  handleSaveSsh: () => void | Promise<void>;
  setEditingSsh: (target: SshTargetConfig) => void;
  setSshPassphrase: (value: string) => void;
  setSshPassword: (value: string) => void;
  setSshPortText: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
};

export const SettingsSshEditor: React.FC<SettingsSshEditorProps> = ({
  editingSsh,
  isExisting,
  sshFingerprintPending,
  sshPassphrase,
  sshPassword,
  sshPortText,
  sshPrivateKey,
  handleDeleteSsh,
  handleFetchSshFingerprint,
  handleSaveSsh,
  setEditingSsh,
  setSshPassphrase,
  setSshPassword,
  setSshPortText,
  setSshPrivateKey,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  const currentHostKeyPolicy = editingSsh.hostKeyPolicy || 'trust-on-first-use';
  const currentAuthMode = editingSsh.authMode || 'password';
  const currentPtyType = editingSsh.ptyType || 'xterm';

  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editSshTarget') : t('settings.newSshTarget')}
      onSave={handleSaveSsh}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      <Text style={styles.label}>{t('settings.sshTargetName')}</Text>
      <TextInput
        style={styles.input}
        value={editingSsh.name}
        onChangeText={(value) => setEditingSsh({ ...editingSsh, name: value })}
        placeholder={t('settings.sshTargetNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>{t('settings.sshHost')}</Text>
      <TextInput
        style={styles.input}
        value={editingSsh.host}
        onChangeText={(value) => setEditingSsh({ ...editingSsh, host: value })}
        placeholder={t('settings.sshHostPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.sshPort')}</Text>
      <TextInput
        style={styles.input}
        value={sshPortText}
        onChangeText={setSshPortText}
        placeholder="22"
        placeholderTextColor={colors.placeholder}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>{t('settings.sshUsername')}</Text>
      <TextInput
        style={styles.input}
        value={editingSsh.username}
        onChangeText={(value) => setEditingSsh({ ...editingSsh, username: value })}
        placeholder={t('settings.sshUsernamePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.sshRemoteRoot')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.sshRemoteRootHint')}</Text>
      <TextInput
        style={styles.input}
        value={editingSsh.remoteRoot || ''}
        onChangeText={(value) => setEditingSsh({ ...editingSsh, remoteRoot: value })}
        placeholder={t('settings.sshRemoteRootPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.sshHostKeyPolicy')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.sshHostKeyPolicyHint')}</Text>
      <View style={styles.themeRow}>
        {SSH_HOST_KEY_POLICY_OPTIONS.map((policy) => (
          <TouchableOpacity
            key={policy}
            style={[styles.themeBtn, currentHostKeyPolicy === policy && styles.themeBtnActive]}
            onPress={() => setEditingSsh({ ...editingSsh, hostKeyPolicy: policy })}
            accessibilityRole="button"
            accessibilityLabel={getSshHostKeyPolicyLabel({ hostKeyPolicy: policy })}
          >
            <Text
              style={[
                styles.themeBtnText,
                currentHostKeyPolicy === policy && styles.themeBtnTextActive,
              ]}
            >
              {policy === 'strict'
                ? t('settings.sshHostKeyPolicyStrict')
                : t('settings.sshHostKeyPolicyTofu')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('settings.sshTrustedFingerprint')}</Text>
      <Text style={styles.listItemSubtitle}>
        {currentHostKeyPolicy === 'strict'
          ? t('settings.sshTrustedFingerprintStrictHint')
          : t('settings.sshTrustedFingerprintTofuHint')}
      </Text>
      <TextInput
        style={styles.input}
        value={editingSsh.trustedHostFingerprint || ''}
        onChangeText={(value) => setEditingSsh({ ...editingSsh, trustedHostFingerprint: value })}
        placeholder={t('settings.sshTrustedFingerprintPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => void handleFetchSshFingerprint()}
          accessibilityRole="button"
          accessibilityLabel={t('settings.sshFetchFingerprint')}
        >
          <Text style={styles.secondaryBtnText}>
            {sshFingerprintPending
              ? t('settings.sshFetchingFingerprint')
              : t('settings.sshFetchFingerprint')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => setEditingSsh({ ...editingSsh, trustedHostFingerprint: undefined })}
          accessibilityRole="button"
          accessibilityLabel={t('settings.sshResetFingerprint')}
        >
          <Text style={styles.secondaryBtnText}>{t('settings.sshResetFingerprint')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>{t('settings.sshAuthMode')}</Text>
      <View style={styles.themeRow}>
        {SSH_AUTH_MODE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.themeBtn, currentAuthMode === option.value && styles.themeBtnActive]}
            onPress={() => setEditingSsh({ ...editingSsh, authMode: option.value })}
            accessibilityRole="button"
            accessibilityLabel={option.value}
          >
            <Text
              style={[
                styles.themeBtnText,
                currentAuthMode === option.value && styles.themeBtnTextActive,
              ]}
            >
              {option.value === 'private-key'
                ? t('settings.sshAuthPrivateKey')
                : t('settings.sshAuthPassword')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {currentAuthMode === 'password' ? (
        <>
          <Text style={styles.label}>{t('settings.sshPassword')}</Text>
          <TextInput
            style={styles.input}
            value={sshPassword}
            onChangeText={setSshPassword}
            placeholder={t('settings.sshPasswordPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>{t('settings.sshPrivateKey')}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.sshPrivateKeyHint')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={sshPrivateKey}
            onChangeText={setSshPrivateKey}
            placeholder={t('settings.sshPrivateKeyPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>{t('settings.sshPassphrase')}</Text>
          <TextInput
            style={styles.input}
            value={sshPassphrase}
            onChangeText={setSshPassphrase}
            placeholder={t('settings.sshPassphrasePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </>
      )}

      <Text style={styles.label}>{t('settings.sshPtyType')}</Text>
      <View style={styles.themeRow}>
        {SSH_PTY_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.themeBtn, currentPtyType === option.value && styles.themeBtnActive]}
            onPress={() => setEditingSsh({ ...editingSsh, ptyType: option.value })}
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Text
              style={[
                styles.themeBtnText,
                currentPtyType === option.value && styles.themeBtnTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingSsh.enabled}
          onValueChange={(value) => setEditingSsh({ ...editingSsh, enabled: value })}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteSsh(editingSsh.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteSshTarget')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteSshTarget')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};

type SettingsWorkspaceEditorProps = SharedEditorProps & {
  editingWorkspace: WorkspaceTargetConfig;
  isExisting: boolean;
  browserProviders: BrowserProviderConfig[];
  sshTargets: SshTargetConfig[];
  workspaceAccessToken: string;
  workspaceConfigRootsText: string;
  handleDeleteWorkspace: (id: string) => void;
  handleSaveWorkspace: () => void | Promise<void>;
  setEditingWorkspace: (target: WorkspaceTargetConfig) => void;
  setWorkspaceAccessToken: (value: string) => void;
  setWorkspaceConfigRootsText: (value: string) => void;
};

export const SettingsWorkspaceEditor: React.FC<SettingsWorkspaceEditorProps> = ({
  editingWorkspace,
  isExisting,
  browserProviders,
  sshTargets,
  workspaceAccessToken,
  workspaceConfigRootsText,
  handleDeleteWorkspace,
  handleSaveWorkspace,
  setEditingWorkspace,
  setWorkspaceAccessToken,
  setWorkspaceConfigRootsText,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  const providerValue = editingWorkspace.provider || 'code-server';
  const authModeValue = editingWorkspace.authMode || 'none';

  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editWorkspaceTarget') : t('settings.newWorkspaceTarget')}
      onSave={handleSaveWorkspace}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      <Text style={styles.label}>{t('settings.workspaceTargetName')}</Text>
      <TextInput
        style={styles.input}
        value={editingWorkspace.name}
        onChangeText={(value) => setEditingWorkspace({ ...editingWorkspace, name: value })}
        placeholder={t('settings.workspaceTargetNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>{t('settings.workspaceRootPath')}</Text>
      <TextInput
        style={styles.input}
        value={editingWorkspace.rootPath}
        onChangeText={(value) => setEditingWorkspace({ ...editingWorkspace, rootPath: value })}
        placeholder={t('settings.workspaceRootPathPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.workspaceProvider')}</Text>
      <View style={styles.themeRow}>
        {WORKSPACE_PROVIDER_OPTIONS.map((provider) => (
          <TouchableOpacity
            key={provider}
            style={[styles.themeBtn, providerValue === provider && styles.themeBtnActive]}
            onPress={() => setEditingWorkspace({ ...editingWorkspace, provider })}
            accessibilityRole="button"
            accessibilityLabel={getWorkspaceProviderLabel(provider)}
          >
            <Text
              style={[styles.themeBtnText, providerValue === provider && styles.themeBtnTextActive]}
            >
              {provider === 'code-server'
                ? t('remoteWork.providerCodeServer')
                : provider === 'openvscode-server'
                  ? t('remoteWork.providerOpenVSCode')
                  : provider === 'custom'
                    ? t('remoteWork.providerCustom')
                    : getWorkspaceProviderLabel(provider)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('settings.workspaceBaseUrl')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.workspaceConnectionHint')}</Text>
      <TextInput
        style={styles.input}
        value={editingWorkspace.baseUrl || ''}
        onChangeText={(value) => setEditingWorkspace({ ...editingWorkspace, baseUrl: value })}
        placeholder={t('settings.workspaceBaseUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.label}>{t('settings.workspaceAuthMode')}</Text>
      <View style={styles.themeRow}>
        {WORKSPACE_AUTH_MODE_OPTIONS.map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.themeBtn, authModeValue === mode && styles.themeBtnActive]}
            onPress={() => setEditingWorkspace({ ...editingWorkspace, authMode: mode })}
            accessibilityRole="button"
            accessibilityLabel={mode}
          >
            <Text
              style={[styles.themeBtnText, authModeValue === mode && styles.themeBtnTextActive]}
            >
              {mode === 'none'
                ? t('settings.workspaceAuthNone')
                : mode === 'bearer'
                  ? t('settings.workspaceAuthBearer')
                  : t('settings.workspaceAuthQueryToken')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {authModeValue === 'query-token' ? (
        <>
          <Text style={styles.label}>{t('settings.workspaceQueryTokenParam')}</Text>
          <TextInput
            style={styles.input}
            value={editingWorkspace.queryTokenParam || ''}
            onChangeText={(value) =>
              setEditingWorkspace({ ...editingWorkspace, queryTokenParam: value })
            }
            placeholder={t('settings.workspaceQueryTokenParamPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}

      {authModeValue !== 'none' ? (
        <>
          <Text style={styles.label}>{t('settings.workspaceAccessToken')}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.workspaceAccessTokenHint')}</Text>
          <TextInput
            style={styles.input}
            value={workspaceAccessToken}
            onChangeText={setWorkspaceAccessToken}
            placeholder={
              editingWorkspace.accessTokenRef
                ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                : t('settings.workspaceAccessTokenPlaceholder')
            }
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </>
      ) : null}

      <Text style={styles.label}>{t('remoteWork.workspaceBrowserProvider')}</Text>
      <Text style={styles.listItemSubtitle}>{t('remoteWork.workspaceBrowserProviderHint')}</Text>
      <View style={styles.themeRow}>
        <TouchableOpacity
          style={[styles.themeBtn, !editingWorkspace.browserProviderId && styles.themeBtnActive]}
          onPress={() => setEditingWorkspace({ ...editingWorkspace, browserProviderId: undefined })}
          accessibilityRole="button"
          accessibilityLabel={t('remoteWork.workspaceBrowserProviderAutoSelect')}
        >
          <Text
            style={[
              styles.themeBtnText,
              !editingWorkspace.browserProviderId && styles.themeBtnTextActive,
            ]}
          >
            {t('remoteWork.workspaceBrowserProviderAutoSelect')}
          </Text>
        </TouchableOpacity>
        {browserProviders.map((provider) => (
          <TouchableOpacity
            key={provider.id}
            style={[
              styles.themeBtn,
              editingWorkspace.browserProviderId === provider.id && styles.themeBtnActive,
            ]}
            onPress={() =>
              setEditingWorkspace({ ...editingWorkspace, browserProviderId: provider.id })
            }
            accessibilityRole="button"
            accessibilityLabel={provider.name}
          >
            <Text
              style={[
                styles.themeBtnText,
                editingWorkspace.browserProviderId === provider.id && styles.themeBtnTextActive,
              ]}
            >
              {provider.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('remoteWork.workspaceSshTarget')}</Text>
      <Text style={styles.listItemSubtitle}>{t('remoteWork.workspaceSshTargetHint')}</Text>
      <View style={styles.themeRow}>
        <TouchableOpacity
          style={[styles.themeBtn, !editingWorkspace.sshTargetId && styles.themeBtnActive]}
          onPress={() => setEditingWorkspace({ ...editingWorkspace, sshTargetId: undefined })}
          accessibilityRole="button"
          accessibilityLabel={t('remoteWork.workspaceNoSshTarget')}
        >
          <Text
            style={[
              styles.themeBtnText,
              !editingWorkspace.sshTargetId && styles.themeBtnTextActive,
            ]}
          >
            {t('common.none')}
          </Text>
        </TouchableOpacity>
        {sshTargets.map((target) => (
          <TouchableOpacity
            key={target.id}
            style={[
              styles.themeBtn,
              editingWorkspace.sshTargetId === target.id && styles.themeBtnActive,
            ]}
            onPress={() => setEditingWorkspace({ ...editingWorkspace, sshTargetId: target.id })}
            accessibilityRole="button"
            accessibilityLabel={target.name}
          >
            <Text
              style={[
                styles.themeBtnText,
                editingWorkspace.sshTargetId === target.id && styles.themeBtnTextActive,
              ]}
            >
              {target.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('remoteWork.workspaceAiCommandTemplate')}</Text>
      <Text style={styles.listItemSubtitle}>{t('remoteWork.workspaceAiCommandTemplateHint')}</Text>
      <TextInput
        style={styles.input}
        value={editingWorkspace.aiTaskCommandTemplate || ''}
        onChangeText={(value) =>
          setEditingWorkspace({ ...editingWorkspace, aiTaskCommandTemplate: value })
        }
        placeholder={
          editingWorkspace.provider === 'cursor'
            ? t('remoteWork.workspaceAiCommandTemplateCursorPlaceholder')
            : t('remoteWork.workspaceAiCommandTemplateDefaultPlaceholder')
        }
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />

      <Text style={styles.label}>{t('settings.workspaceConfigRoots')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.workspaceConfigRootsHint')}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={workspaceConfigRootsText}
        onChangeText={setWorkspaceConfigRootsText}
        placeholder={t('settings.workspaceConfigRootsPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingWorkspace.enabled}
          onValueChange={(value) => setEditingWorkspace({ ...editingWorkspace, enabled: value })}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteWorkspace(editingWorkspace.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteWorkspaceTarget')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteWorkspaceTarget')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};

type SettingsBrowserEditorProps = SharedEditorProps & {
  editingBrowser: BrowserProviderConfig;
  isExisting: boolean;
  browserApiKey: string;
  handleSaveBrowserProvider: () => void | Promise<void>;
  handleDeleteBrowserProvider: (id: string) => void;
  setBrowserApiKey: (value: string) => void;
  setEditingBrowser: (provider: BrowserProviderConfig) => void;
};

export const SettingsBrowserEditor: React.FC<SettingsBrowserEditorProps> = ({
  editingBrowser,
  isExisting,
  browserApiKey,
  handleSaveBrowserProvider,
  handleDeleteBrowserProvider,
  setBrowserApiKey,
  setEditingBrowser,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  const providerValue = editingBrowser.provider || 'browserbase';
  const authModeValue = editingBrowser.authMode || 'api-key-header';

  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editBrowserProvider') : t('settings.newBrowserProvider')}
      onSave={handleSaveBrowserProvider}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      <Text style={styles.label}>{t('settings.browserProviderName')}</Text>
      <TextInput
        style={styles.input}
        value={editingBrowser.name}
        onChangeText={(value) => setEditingBrowser({ ...editingBrowser, name: value })}
        placeholder={t('settings.browserProviderNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>{t('settings.browserProviderType')}</Text>
      <View style={styles.themeRow}>
        {BROWSER_PROVIDER_OPTIONS.map((provider) => (
          <TouchableOpacity
            key={provider}
            style={[styles.themeBtn, providerValue === provider && styles.themeBtnActive]}
            onPress={() =>
              setEditingBrowser({
                ...editingBrowser,
                provider,
                baseUrl:
                  provider === 'browserbase'
                    ? 'https://api.browserbase.com'
                    : provider === 'browserless'
                      ? 'https://production-sfo.browserless.io'
                      : editingBrowser.baseUrl,
                authMode:
                  provider === 'browserbase'
                    ? 'api-key-header'
                    : provider === 'browserless'
                      ? 'query-token'
                      : editingBrowser.authMode,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={getBrowserProviderLabel(provider)}
          >
            <Text
              style={[styles.themeBtnText, providerValue === provider && styles.themeBtnTextActive]}
            >
              {getBrowserProviderLabel(provider)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
        {BROWSER_PROVIDER_PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset.id}
            style={styles.presetChip}
            onPress={() => setEditingBrowser(applyBrowserProviderPreset(editingBrowser, preset.id))}
            accessibilityRole="button"
            accessibilityLabel={preset.label}
          >
            <Text style={styles.presetChipText}>{preset.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.listItemSubtitle}>{getBrowserProviderAuthHint(editingBrowser)}</Text>

      <Text style={styles.label}>{t('settings.browserBaseUrl')}</Text>
      <TextInput
        style={styles.input}
        value={editingBrowser.baseUrl || ''}
        onChangeText={(value) => setEditingBrowser({ ...editingBrowser, baseUrl: value })}
        placeholder={t('settings.browserBaseUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      {providerValue === 'browserbase' ? (
        <>
          <Text style={styles.label}>{t('settings.browserProjectId')}</Text>
          <TextInput
            style={styles.input}
            value={editingBrowser.projectId || ''}
            onChangeText={(value) => setEditingBrowser({ ...editingBrowser, projectId: value })}
            placeholder={t('settings.browserProjectIdPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}

      <Text style={styles.label}>{t('settings.browserAuthMode')}</Text>
      <View style={styles.themeRow}>
        {BROWSER_PROVIDER_AUTH_OPTIONS.map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.themeBtn, authModeValue === mode && styles.themeBtnActive]}
            onPress={() => setEditingBrowser({ ...editingBrowser, authMode: mode })}
            accessibilityRole="button"
            accessibilityLabel={mode}
          >
            <Text
              style={[styles.themeBtnText, authModeValue === mode && styles.themeBtnTextActive]}
            >
              {getBrowserProviderAuthLabel(mode)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {authModeValue === 'query-token' ? (
        <>
          <Text style={styles.label}>{t('settings.browserQueryTokenParam')}</Text>
          <TextInput
            style={styles.input}
            value={editingBrowser.queryTokenParam || ''}
            onChangeText={(value) =>
              setEditingBrowser({ ...editingBrowser, queryTokenParam: value })
            }
            placeholder={t('settings.browserQueryTokenParamPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}

      {authModeValue !== 'none' ? (
        <>
          <Text style={styles.label}>{t('settings.browserApiKey')}</Text>
          <TextInput
            style={styles.input}
            value={browserApiKey}
            onChangeText={setBrowserApiKey}
            placeholder={t('settings.browserApiKeyPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </>
      ) : null}

      <Text style={styles.listItemSubtitle}>
        {getBrowserProviderReadiness(editingBrowser).launchable
          ? t('remoteWork.statusReady')
          : t('remoteWork.statusSetupRequired')}
      </Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingBrowser.enabled}
          onValueChange={(value) => setEditingBrowser({ ...editingBrowser, enabled: value })}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteBrowserProvider(editingBrowser.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteBrowserProvider')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteBrowserProvider')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};

type SettingsExpoAccountEditorProps = SharedEditorProps & {
  editingExpoAccount: ExpoAccountConfig;
  isExisting: boolean;
  expoAccountToken: string;
  handleDeleteExpoAccount: (id: string) => void;
  handleSaveExpoAccount: () => void | Promise<void>;
  setEditingExpoAccount: (account: ExpoAccountConfig) => void;
  setExpoAccountToken: (value: string) => void;
};

export const SettingsExpoAccountEditor: React.FC<SettingsExpoAccountEditorProps> = ({
  editingExpoAccount,
  isExisting,
  expoAccountToken,
  handleDeleteExpoAccount,
  handleSaveExpoAccount,
  setEditingExpoAccount,
  setExpoAccountToken,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  const accountTypeValue = editingExpoAccount.accountType || 'personal';

  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editExpoAccount') : t('settings.newExpoAccount')}
      onSave={handleSaveExpoAccount}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      <Text style={styles.label}>{t('settings.expoAccountName')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoAccount.name}
        onChangeText={(value) => setEditingExpoAccount({ ...editingExpoAccount, name: value })}
        placeholder={t('settings.expoAccountNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>{t('settings.expoOwner')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.expoOwnerHint')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoAccount.owner}
        onChangeText={(value) => setEditingExpoAccount({ ...editingExpoAccount, owner: value })}
        placeholder={t('settings.expoOwnerPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.expoAccountType')}</Text>
      <View style={styles.themeRow}>
        {(['personal', 'robot'] as const).map((accountType) => (
          <TouchableOpacity
            key={accountType}
            style={[styles.themeBtn, accountTypeValue === accountType && styles.themeBtnActive]}
            onPress={() => setEditingExpoAccount({ ...editingExpoAccount, accountType })}
            accessibilityRole="button"
            accessibilityLabel={
              accountType === 'robot'
                ? t('settings.expoAccountTypeRobot')
                : t('settings.expoAccountTypePersonal')
            }
          >
            <Text
              style={[
                styles.themeBtnText,
                accountTypeValue === accountType && styles.themeBtnTextActive,
              ]}
            >
              {accountType === 'robot'
                ? t('settings.expoAccountTypeRobot')
                : t('settings.expoAccountTypePersonal')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('settings.expoAccessToken')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.expoAccessTokenHint')}</Text>
      <TextInput
        style={styles.input}
        value={expoAccountToken}
        onChangeText={setExpoAccountToken}
        placeholder={t('settings.expoAccessTokenPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingExpoAccount.enabled}
          onValueChange={(value) =>
            setEditingExpoAccount({ ...editingExpoAccount, enabled: value })
          }
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteExpoAccount(editingExpoAccount.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteExpoAccount')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteExpoAccount')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};

type SettingsExpoProjectEditorProps = SharedEditorProps & {
  editingExpoProject: ExpoProjectConfig;
  isExisting: boolean;
  expoAccounts: ExpoAccountConfig[];
  sshTargets: SshTargetConfig[];
  handleDeleteExpoProject: (id: string) => void;
  handleSaveExpoProject: () => void | Promise<void>;
  setEditingExpoProject: (project: ExpoProjectConfig) => void;
  toggleExpoPlatform: (platform: 'android' | 'ios' | 'web') => void;
};

export const SettingsExpoProjectEditor: React.FC<SettingsExpoProjectEditorProps> = ({
  editingExpoProject,
  isExisting,
  expoAccounts,
  sshTargets,
  handleDeleteExpoProject,
  handleSaveExpoProject,
  setEditingExpoProject,
  toggleExpoPlatform,
  colors,
  styles,
  t,
  scrollRef,
  onBack,
  onTrackedScroll,
  onRestore,
}) => {
  return (
    <SettingsEditorFrame
      title={isExisting ? t('settings.editExpoProject') : t('settings.newExpoProject')}
      onSave={handleSaveExpoProject}
      colors={colors}
      styles={styles}
      t={t}
      scrollRef={scrollRef}
      onBack={onBack}
      onTrackedScroll={onTrackedScroll}
      onRestore={onRestore}
    >
      <Text style={styles.label}>{t('settings.expoProjectName')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.name}
        onChangeText={(value) => setEditingExpoProject({ ...editingExpoProject, name: value })}
        placeholder={t('settings.expoProjectNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>{t('settings.expoLinkedAccount')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
        {expoAccounts.map((account) => (
          <TouchableOpacity
            key={account.id}
            style={[
              styles.presetChip,
              editingExpoProject.accountId === account.id && styles.presetChipActive,
            ]}
            onPress={() =>
              setEditingExpoProject({
                ...editingExpoProject,
                accountId: account.id,
                owner: editingExpoProject.owner || account.owner,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={account.name}
          >
            <Text
              style={[
                styles.presetChipText,
                editingExpoProject.accountId === account.id && styles.presetChipTextActive,
              ]}
            >
              {account.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>{t('settings.expoOwner')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.owner}
        onChangeText={(value) => setEditingExpoProject({ ...editingExpoProject, owner: value })}
        placeholder={t('settings.expoOwnerPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.expoProjectSlug')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.slug}
        onChangeText={(value) => setEditingExpoProject({ ...editingExpoProject, slug: value })}
        placeholder={t('settings.expoProjectSlugPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.expoExecutionMode')}</Text>
      <View style={styles.themeRow}>
        {(['eas-workflow', 'direct-ssh', 'github-workflow'] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.themeBtn, editingExpoProject.mode === mode && styles.themeBtnActive]}
            onPress={() => setEditingExpoProject({ ...editingExpoProject, mode })}
            accessibilityRole="button"
            accessibilityLabel={
              mode === 'eas-workflow'
                ? t('settings.expoExecutionModeEasWorkflow')
                : mode === 'github-workflow'
                  ? t('settings.expoExecutionModeGithubWorkflow')
                  : t('settings.expoExecutionModeDirectSsh')
            }
          >
            <Text
              style={[
                styles.themeBtnText,
                editingExpoProject.mode === mode && styles.themeBtnTextActive,
              ]}
            >
              {mode === 'eas-workflow'
                ? t('settings.expoExecutionModeEasWorkflow')
                : mode === 'github-workflow'
                  ? t('settings.expoExecutionModeGithubWorkflow')
                  : t('settings.expoExecutionModeDirectSsh')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('settings.expoTargetPlatforms')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
        {(['android', 'ios', 'web'] as const).map((platform) => {
          const active = editingExpoProject.platforms?.includes(platform) || false;
          return (
            <TouchableOpacity
              key={platform}
              style={[styles.presetChip, active && styles.presetChipActive]}
              onPress={() => toggleExpoPlatform(platform)}
              accessibilityRole="button"
              accessibilityLabel={platform}
            >
              <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                {platform}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {editingExpoProject.mode === 'direct-ssh' ? (
        <>
          <Text style={styles.label}>{t('settings.expoSshTarget')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
            {sshTargets.map((target) => (
              <TouchableOpacity
                key={target.id}
                style={[
                  styles.presetChip,
                  editingExpoProject.sshTargetId === target.id && styles.presetChipActive,
                ]}
                onPress={() =>
                  setEditingExpoProject({ ...editingExpoProject, sshTargetId: target.id })
                }
                accessibilityRole="button"
                accessibilityLabel={target.name}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    editingExpoProject.sshTargetId === target.id && styles.presetChipTextActive,
                  ]}
                >
                  {target.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>{t('settings.expoProjectPath')}</Text>
          <TextInput
            style={styles.input}
            value={editingExpoProject.projectPath || ''}
            onChangeText={(value) =>
              setEditingExpoProject({ ...editingExpoProject, projectPath: value })
            }
            placeholder={t('settings.expoProjectPathPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : editingExpoProject.mode === 'github-workflow' ? (
        <>
          <Text style={styles.label}>{t('settings.expoGithubRepository')}</Text>
          <TextInput
            style={styles.input}
            value={editingExpoProject.repoFullName || ''}
            onChangeText={(value) =>
              setEditingExpoProject({ ...editingExpoProject, repoFullName: value })
            }
            placeholder={t('settings.expoGithubRepositoryPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>{t('settings.expoWorkflowFile')}</Text>
          <TextInput
            style={styles.input}
            value={editingExpoProject.workflowFile || ''}
            onChangeText={(value) =>
              setEditingExpoProject({ ...editingExpoProject, workflowFile: value })
            }
            placeholder={t('settings.expoWorkflowFilePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>{t('settings.expoWorkflowRef')}</Text>
          <TextInput
            style={styles.input}
            value={editingExpoProject.workflowRef || ''}
            onChangeText={(value) =>
              setEditingExpoProject({ ...editingExpoProject, workflowRef: value })
            }
            placeholder={t('settings.expoWorkflowRefPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : (
        <Text style={styles.listItemSubtitle}>{t('remoteWork.expoWorkflowManagedHint')}</Text>
      )}

      <Text style={styles.label}>{t('settings.expoDefaultBuildProfile')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.defaultBuildProfile || ''}
        onChangeText={(value) =>
          setEditingExpoProject({ ...editingExpoProject, defaultBuildProfile: value })
        }
        placeholder={t('settings.expoDefaultBuildProfilePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.expoDefaultUpdateBranch')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.defaultUpdateBranch || ''}
        onChangeText={(value) =>
          setEditingExpoProject({ ...editingExpoProject, defaultUpdateBranch: value })
        }
        placeholder={t('settings.expoDefaultUpdateBranchPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.expoUpdateChannel')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.updateChannel || ''}
        onChangeText={(value) =>
          setEditingExpoProject({ ...editingExpoProject, updateChannel: value })
        }
        placeholder={t('settings.expoUpdateChannelPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('settings.expoProductionWebUrl')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.webUrl || ''}
        onChangeText={(value) => setEditingExpoProject({ ...editingExpoProject, webUrl: value })}
        placeholder={t('settings.expoProductionWebUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        keyboardType="url"
      />

      <Text style={styles.label}>{t('settings.expoPreviewUrl')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.previewUrl || ''}
        onChangeText={(value) =>
          setEditingExpoProject({ ...editingExpoProject, previewUrl: value })
        }
        placeholder={t('settings.expoPreviewUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        keyboardType="url"
      />

      <Text style={styles.label}>{t('settings.expoCustomDomain')}</Text>
      <TextInput
        style={styles.input}
        value={editingExpoProject.customDomain || ''}
        onChangeText={(value) =>
          setEditingExpoProject({ ...editingExpoProject, customDomain: value })
        }
        placeholder={t('settings.expoCustomDomainPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          value={editingExpoProject.enabled}
          onValueChange={(value) =>
            setEditingExpoProject({ ...editingExpoProject, enabled: value })
          }
          trackColor={{ true: colors.primary }}
        />
      </View>

      {isExisting ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteExpoProject(editingExpoProject.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteExpoProject')}
        >
          <Trash2 size={18} color={colors.danger} />
          <Text style={styles.deleteBtnText}>{t('settings.deleteExpoProject')}</Text>
        </TouchableOpacity>
      ) : null}
    </SettingsEditorFrame>
  );
};
