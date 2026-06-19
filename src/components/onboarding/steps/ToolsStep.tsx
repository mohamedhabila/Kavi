import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChevronDown, CloudSun, ExternalLink, Search, Wrench } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';
import type { ServiceGuide } from '../onboardingGuides';

export function ToolsStep() {
  const {
    additionalServices,
    colors,
    handleOpenUrl,
    handleSaveTools,
    primaryServices,
    progressHeader,
    saveError,
    saving,
    serviceKeys,
    setServiceKeys,
    setShowMoreServices,
    setStep,
    setWebSearchProviderState,
    showMoreServices,
    styles,
    t,
    webProviderOptions,
    webSearchProvider,
  } = useOnboardingWizardContext();

  const renderServiceCard = (guide: ServiceGuide) => (
    <View key={guide.storageKey} style={styles.serviceCard}>
      <View style={styles.serviceHeader}>
        <View style={styles.serviceHeaderBody}>
          <Text style={styles.serviceTitle}>{guide.title}</Text>
          <Text style={styles.serviceCategory}>{guide.category}</Text>
        </View>
        {guide.docsUrl ? (
          <TouchableOpacity
            style={styles.serviceGuideButton}
            onPress={() => void handleOpenUrl(guide.docsUrl)}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.openServiceGuide', { name: guide.title })}
          >
            <ExternalLink size={14} color={colors.primary} />
            <Text style={styles.serviceGuideText}>{t('onboarding.guideCta')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.serviceUnlocks}>{guide.unlocks}</Text>
      <TextInput
        style={styles.input}
        value={serviceKeys[guide.storageKey] || ''}
        onChangeText={(value) =>
          setServiceKeys((current: Record<string, string>) => ({
            ...current,
            [guide.storageKey]: value,
          }))
        }
        placeholder={guide.placeholder}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {progressHeader}
        <Wrench size={40} color={colors.primary} style={styles.stepIcon} />
        <Text style={styles.stepTitle}>{t('onboarding.toolsTitle')}</Text>
        <Text style={styles.stepSubtitle}>{t('onboarding.toolsHint')}</Text>

        <View style={styles.guideCard}>
          <Search size={18} color={colors.primary} />
          <View style={styles.infoCardBody}>
            <Text style={styles.infoCardTitle}>{t('onboarding.preferredWebSearchTitle')}</Text>
            <Text style={styles.infoCardText}>{t('onboarding.preferredWebSearchText')}</Text>
          </View>
        </View>

        <View style={styles.optionWrap}>
          {webProviderOptions.map((option: { value: string; title: string; detail: string }) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.optionCard, webSearchProvider === option.value && styles.optionCardActive]}
              onPress={() => setWebSearchProviderState(option.value)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.chooseWebProvider', { name: option.title })}
            >
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionText}>{option.detail}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {primaryServices.length > 0 ? (
          <>
            <View style={styles.sectionIntro}>
              <CloudSun size={18} color={colors.primary} />
              <Text style={styles.sectionIntroText}>{t('onboarding.recommendedKeysIntro')}</Text>
            </View>
            {primaryServices.map(renderServiceCard)}
          </>
        ) : null}

        {additionalServices.length > 0 ? (
          <>
            <TouchableOpacity
              style={styles.moreServicesToggle}
              onPress={() => setShowMoreServices((value: boolean) => !value)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.moreServicesToggle')}
            >
              <Text style={styles.moreServicesText}>
                {t('onboarding.moreServicesLabel', { count: additionalServices.length })}
              </Text>
              <ChevronDown
                size={16}
                color={colors.primary}
                style={{ transform: [{ rotate: showMoreServices ? '180deg' : '0deg' }] }}
              />
            </TouchableOpacity>
            {showMoreServices ? additionalServices.map(renderServiceCard) : null}
          </>
        ) : null}

        {saveError ? (
          <Text style={[styles.skipBtnText, { color: colors.danger, marginBottom: 12 }]}>
            {saveError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => void handleSaveTools()}
          accessibilityRole="button"
          accessibilityLabel={saving ? t('onboarding.saving') : t('onboarding.next')}
        >
          <Text style={styles.primaryBtnText}>
            {saving ? t('onboarding.saving') : t('onboarding.finishSetup')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => setStep('providerKey')}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={styles.skipBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
