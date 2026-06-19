import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Cpu, Eye, EyeOff, Trash2 } from 'lucide-react-native';

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
          style={styles.input}
          value={editingProvider.model}
          onChangeText={(value) => setEditingProvider({ ...editingProvider, model: value })}
          placeholder={t('settings.defaultModelPlaceholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
        />
      )}

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
