import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChevronRight, ExternalLink, Key, Server } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LocalModelDownloadPanel } from '../../localLlm/LocalModelDownloadPanel';
import { useOnboardingWizardContext } from '../OnboardingWizardContext';

export function ProviderKeyStep() {
  const {
    apiKey,
    canSaveProvider,
    colors,
    customBaseUrl,
    customModel,
    customName,
    handleDownloadSelectedOnDeviceModel,
    handleOpenUrl,
    handleSaveProvider,
    handleSkipProvider,
    localCatalog,
    onDeviceDownloadState,
    onDeviceModelWasJustDownloaded,
    progressHeader,
    saveError,
    saving,
    selectedGuide,
    selectedGuideIsOnDevice,
    selectedOnDeviceCatalogEntry,
    selectedOnDeviceModelInstalled,
    setApiKey,
    setCustomBaseUrl,
    setCustomModel,
    setCustomName,
    setStep,
    styles,
    t,
  } = useOnboardingWizardContext();

  if (!selectedGuide) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {progressHeader}
        <Key size={40} color={colors.primary} style={styles.stepIcon} />
        <Text style={styles.stepTitle}>{selectedGuide.title}</Text>
        <Text style={styles.stepSubtitle}>{selectedGuide.summary}</Text>

        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>{t('onboarding.accessTitle')}</Text>
          <Text style={styles.guideText}>{selectedGuide.setup}</Text>
          <Text style={styles.guideFree}>{selectedGuide.freeAccess}</Text>
          {selectedGuide.docsUrl ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void handleOpenUrl(selectedGuide.docsUrl)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.openProviderGuide', {
                name: selectedGuide.title,
              })}
            >
              <ExternalLink size={16} color={colors.primary} />
              <Text style={styles.secondaryBtnText}>{t('onboarding.openOfficialGuide')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {!selectedGuide.preset ? (
          <TextInput
            style={styles.input}
            value={customName}
            onChangeText={setCustomName}
            placeholder={t('onboarding.providerNamePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : null}

        {!selectedGuideIsOnDevice ? (
          <TextInput
            style={styles.input}
            value={customBaseUrl}
            onChangeText={setCustomBaseUrl}
            placeholder={t('onboarding.baseUrlPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        ) : null}

        {selectedGuideIsOnDevice ? (
          <View style={styles.optionWrap}>
            {localCatalog.map((entry: { id: string; name: string; sizeLabel: string; summary?: string }) => {
              const active = customModel === entry.id;
              return (
                <TouchableOpacity
                  key={entry.id}
                  style={[styles.optionCard, active && styles.optionCardActive]}
                  onPress={() => setCustomModel(entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('onboarding.selectModel', { name: entry.name })}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={styles.optionTitle}>{entry.name}</Text>
                  <Text style={styles.optionText}>{`${entry.sizeLabel} · ${entry.summary || ''}`}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <TextInput
            style={styles.input}
            value={customModel}
            onChangeText={setCustomModel}
            placeholder={t('onboarding.modelPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}

        {selectedGuide.requiresKey ? (
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={t('onboarding.apiKeyPlaceholder')}
            placeholderTextColor={colors.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : (
          <View style={styles.infoCard}>
            <Server size={18} color={colors.primary} />
            <View style={styles.infoCardBody}>
              <Text style={styles.infoCardTitle}>
                {selectedGuideIsOnDevice
                  ? t('onboarding.onDeviceNoteTitle')
                  : t('onboarding.localNoteTitle')}
              </Text>
              <Text style={styles.infoCardText}>
                {selectedGuideIsOnDevice
                  ? t('onboarding.onDeviceNoteBody')
                  : t('onboarding.localNoteBody')}
              </Text>
            </View>
          </View>
        )}

        {selectedGuideIsOnDevice && selectedOnDeviceCatalogEntry ? (
          <LocalModelDownloadPanel
            entry={selectedOnDeviceCatalogEntry}
            status={onDeviceDownloadState.status}
            progress={onDeviceDownloadState.progress}
            message={onDeviceDownloadState.errorMessage}
            alreadyInstalled={selectedOnDeviceModelInstalled}
            wasJustDownloaded={onDeviceModelWasJustDownloaded}
            onDownload={() => void handleDownloadSelectedOnDeviceModel()}
          />
        ) : null}

        {saveError ? (
          <Text style={[styles.skipBtnText, { color: colors.danger, marginBottom: 12 }]}>
            {saveError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryBtn, !canSaveProvider && styles.disabledBtn]}
          onPress={() => void handleSaveProvider()}
          disabled={!canSaveProvider || saving}
          accessibilityRole="button"
          accessibilityLabel={saving ? t('onboarding.saving') : t('onboarding.saveProvider')}
        >
          <Text style={styles.primaryBtnText}>
            {saving ? t('onboarding.saving') : t('onboarding.saveProvider')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleSkipProvider}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skipProvider')}
        >
          <ChevronRight size={16} color={colors.primary} />
          <Text style={styles.secondaryBtnText}>{t('onboarding.skipProvider')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => setStep('provider')}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={styles.skipBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
