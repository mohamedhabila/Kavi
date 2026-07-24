import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Cpu, Eye, EyeOff, Trash2 } from 'lucide-react-native';

import { CapabilityGate, type CapabilityGateState } from '../../../components/CapabilityGate';
import type {
  ProviderConfigurationIssue,
  ProviderConfigurationReadiness,
} from '../../../services/llm/support/providerReadiness';
import type {
  ProviderConnectionFailureReason,
  ProviderConnectionTestResult,
} from '../../../services/llm/support/providerConnection';
import type { LlmProviderConfig } from '../../../types/provider';
import type { AppPalette } from '../../../theme/useAppTheme';
import { SettingsLocalModelControls } from './SettingsLocalModelControls';

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
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity
          onPress={() => void onSave()}
          disabled={saveDisabled}
          style={styles.headerAction}
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
  readiness: ProviderConfigurationReadiness | null;
  connectionTestResult: ProviderConnectionTestResult | null;
  isTestingConnection: boolean;
  localCatalog: Array<{ id: string; name: string; sizeLabel: string }>;
  selectedLocalCatalogEntry: any;
  tempApiKey: string;
  showApiKey: boolean;
  editingLocalModelDownloadState: any;
  editingLocalModelWasJustDownloaded: boolean;
  editingLocalModelRuntimeStatus: any;
  editingLocalModelInvalidInstallIssue: any;
  editingLocalModelFallbackName: string | null;
  canSwitchEditingLocalModelToCpu: boolean;
  handleDeleteProvider: (id: string) => void;
  handleDownloadSelectedLocalModel: () => void | Promise<void>;
  handleClearSelectedLocalModelInstall: () => void;
  handleSwitchSelectedLocalModelToCpu: () => void;
  handleChooseFallbackLocalModel: () => void;
  handleSaveProvider: () => void | Promise<void>;
  handleTestProviderConnection: () => void | Promise<void>;
  isLocalLlmModelInstalled: (provider: LlmProviderConfig, modelId: string) => boolean;
  onToggleShowApiKey: () => void;
  setEditingProvider: (provider: LlmProviderConfig) => void;
  setTempApiKey: (value: string) => void;
};

function getCapabilityGateState(readiness: ProviderConfigurationReadiness): CapabilityGateState {
  switch (readiness.state) {
    case 'checking':
      return 'loading';
    case 'setup-needed':
      return 'setup-needed';
    case 'configured':
      return 'ready';
    case 'active':
      return 'active';
    case 'error':
      return 'error';
    case 'off':
    default:
      return 'unavailable';
  }
}

function getReadinessCopy(readiness: ProviderConfigurationReadiness, t: TranslationFn) {
  switch (readiness.state) {
    case 'checking':
      return {
        title: t('settings.providerReadiness.checking'),
        description: t('settings.providerReadiness.checkingHint'),
      };
    case 'setup-needed':
      return {
        title: t('settings.providerReadiness.setupNeeded'),
        description: t('settings.providerReadiness.setupHint'),
      };
    case 'configured':
      return {
        title: t('settings.providerReadiness.configured'),
        description: t('settings.providerReadiness.configuredHint'),
      };
    case 'active':
      return {
        title: t('settings.providerReadiness.active'),
        description: t('settings.providerReadiness.activeHint'),
      };
    case 'error':
      return {
        title: t('settings.providerReadiness.credentialError'),
        description: t('settings.providerReadiness.errorHint'),
      };
    case 'off':
    default:
      return {
        title: t('settings.providerReadiness.off'),
        description: readiness.issues[0]
          ? t('settings.providerReadiness.offSetupHint')
          : t('settings.providerReadiness.offHint'),
      };
  }
}

function getConnectionFailureHint(reason: ProviderConnectionFailureReason, t: TranslationFn) {
  switch (reason) {
    case 'authentication':
      return t('settings.providerConnection.authenticationHint');
    case 'billing':
      return t('settings.providerConnection.billingHint');
    case 'rate-limited':
      return t('settings.providerConnection.rateLimitedHint');
    case 'timeout':
      return t('settings.providerConnection.timeoutHint');
    case 'network':
      return t('settings.providerConnection.networkHint');
    case 'server':
      return t('settings.providerConnection.serverHint');
    case 'unsupported':
      return t('settings.providerConnection.unsupportedHint');
    case 'rejected':
    default:
      return t('settings.providerConnection.rejectedHint');
  }
}

export const SettingsProviderEditor: React.FC<SettingsProviderEditorProps> = ({
  editingProvider,
  isExisting,
  isOnDevice,
  canSave,
  readiness,
  connectionTestResult,
  isTestingConnection,
  localCatalog,
  selectedLocalCatalogEntry,
  tempApiKey,
  showApiKey,
  editingLocalModelDownloadState,
  editingLocalModelWasJustDownloaded,
  editingLocalModelRuntimeStatus,
  editingLocalModelInvalidInstallIssue,
  editingLocalModelFallbackName,
  canSwitchEditingLocalModelToCpu,
  handleDeleteProvider,
  handleDownloadSelectedLocalModel,
  handleClearSelectedLocalModelInstall,
  handleSwitchSelectedLocalModelToCpu,
  handleChooseFallbackLocalModel,
  handleSaveProvider,
  handleTestProviderConnection,
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
  const readinessCopy = readiness ? getReadinessCopy(readiness, t) : null;
  const connectionCopy = isTestingConnection
    ? {
        title: t('settings.providerConnection.testing'),
        description: t('settings.providerConnection.testingHint'),
      }
    : connectionTestResult?.outcome === 'success'
      ? {
          title: t('settings.providerConnection.success'),
          description: t('settings.providerConnection.successHint'),
        }
      : connectionTestResult?.outcome === 'failure'
        ? {
            title: t('settings.providerConnection.failed'),
            description: getConnectionFailureHint(connectionTestResult.reason, t),
          }
        : null;
  const gateCopy = connectionCopy || readinessCopy;
  const gateState: CapabilityGateState = isTestingConnection
    ? 'loading'
    : connectionTestResult?.outcome === 'success'
      ? readiness?.state === 'active'
        ? 'active'
        : 'ready'
      : connectionTestResult?.outcome === 'failure'
        ? 'error'
        : readiness
          ? getCapabilityGateState(readiness)
          : 'loading';
  const connectionActionLabel = isTestingConnection
    ? t('settings.providerConnection.test')
    : connectionTestResult?.outcome === 'success'
      ? t('settings.providerConnection.testAgain')
      : connectionTestResult?.outcome === 'failure'
        ? t('common.retry')
        : t('settings.providerConnection.test');
  const hasIssue = (issue: ProviderConfigurationIssue) =>
    readiness?.issues.includes(issue) === true;
  const nameError = hasIssue('name-required');
  const baseUrlError =
    hasIssue('base-url-required') || hasIssue('base-url-invalid') || hasIssue('base-url-protocol');
  const apiKeyError = hasIssue('api-key-required');
  const modelError = hasIssue('model-required');
  const localModelError = hasIssue('local-model-required');

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
      {readiness && gateCopy ? (
        <CapabilityGate
          actionDisabled={!readiness.canEnable || isTestingConnection}
          actionLabel={isOnDevice ? undefined : connectionActionLabel}
          advancedLabel={t('navigationHub.advanced')}
          description={gateCopy.description}
          onAction={isOnDevice ? undefined : handleTestProviderConnection}
          state={gateState}
          testID="provider-readiness"
          title={gateCopy.title}
        />
      ) : null}

      <Text style={styles.label}>{t('settings.providerName')}</Text>
      <TextInput
        accessibilityLabel={t('settings.providerName')}
        style={[styles.input, nameError ? styles.inputError : null]}
        value={editingProvider.name}
        onChangeText={(value) => setEditingProvider({ ...editingProvider, name: value })}
        placeholder={t('settings.providerNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />
      {nameError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {t('settings.providerValidation.nameRequired')}
        </Text>
      ) : null}

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
            accessibilityLabel={t('settings.baseUrl')}
            style={[styles.input, baseUrlError ? styles.inputError : null]}
            value={editingProvider.baseUrl}
            onChangeText={(value) => setEditingProvider({ ...editingProvider, baseUrl: value })}
            placeholder={t('settings.baseUrlPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            keyboardType="url"
          />
          {baseUrlError ? (
            <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
              {hasIssue('base-url-required')
                ? t('settings.providerValidation.baseUrlRequired')
                : hasIssue('base-url-protocol')
                  ? t('settings.providerValidation.baseUrlProtocol')
                  : t('settings.providerValidation.baseUrlInvalid')}
            </Text>
          ) : null}

          <Text style={styles.label}>{t('settings.apiKey')}</Text>
          <View style={styles.apiKeyRow}>
            <TextInput
              accessibilityLabel={t('settings.apiKey')}
              style={[styles.input, { flex: 1 }, apiKeyError ? styles.inputError : null]}
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
              accessibilityLabel={showApiKey ? t('settings.hideApiKey') : t('settings.showApiKey')}
            >
              {showApiKey ? (
                <EyeOff size={20} color={colors.textSecondary} />
              ) : (
                <Eye size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>
          {apiKeyError ? (
            <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
              {t('settings.providerValidation.apiKeyRequired')}
            </Text>
          ) : readiness && !readiness.apiKeyRequired ? (
            <Text style={styles.fieldHint}>{t('settings.providerValidation.apiKeyOptional')}</Text>
          ) : null}
        </>
      )}

      <Text style={styles.label}>{t('settings.defaultModel')}</Text>
      {isOnDevice ? (
        <SettingsLocalModelControls
          editingProvider={editingProvider}
          localCatalog={localCatalog}
          selectedLocalCatalogEntry={selectedLocalCatalogEntry}
          downloadState={editingLocalModelDownloadState}
          wasJustDownloaded={editingLocalModelWasJustDownloaded}
          runtimeStatus={editingLocalModelRuntimeStatus}
          invalidInstallIssue={editingLocalModelInvalidInstallIssue}
          fallbackModelName={editingLocalModelFallbackName}
          canSwitchToCpu={canSwitchEditingLocalModelToCpu}
          styles={styles}
          t={t}
          isLocalLlmModelInstalled={isLocalLlmModelInstalled}
          onProviderChange={setEditingProvider}
          onDownload={handleDownloadSelectedLocalModel}
          onClearInvalidInstall={handleClearSelectedLocalModelInstall}
          onSwitchToCpu={handleSwitchSelectedLocalModelToCpu}
          onChooseFallbackModel={handleChooseFallbackLocalModel}
        />
      ) : (
        <TextInput
          accessibilityLabel={t('settings.defaultModel')}
          style={[styles.input, modelError ? styles.inputError : null]}
          value={editingProvider.model}
          onChangeText={(value) => setEditingProvider({ ...editingProvider, model: value })}
          placeholder={t('settings.defaultModelPlaceholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
        />
      )}
      {!isOnDevice && modelError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {t('settings.providerValidation.modelRequired')}
        </Text>
      ) : null}
      {isOnDevice && localModelError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {t('settings.providerValidation.localModelRequired')}
        </Text>
      ) : null}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('common.enabled')}</Text>
        <Switch
          accessibilityLabel={t('common.enabled')}
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
