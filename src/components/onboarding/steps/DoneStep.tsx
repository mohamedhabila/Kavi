import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Globe, Search, Wrench, Zap } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';

export function DoneStep() {
  const {
    colors,
    configuredProviderName,
    configuredServiceCount,
    handleFinish,
    styles,
    t,
    webProviderOptions,
    webSearchProvider,
  } = useOnboardingWizardContext();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        <Zap size={48} color={colors.success} />
        <Text style={styles.title}>{t('onboarding.step4Title')}</Text>
        <Text style={styles.subtitle}>
          {configuredProviderName
            ? configuredServiceCount > 0
              ? t('onboarding.doneConfiguredWithServices', {
                  provider: configuredProviderName,
                  count: configuredServiceCount,
                  label:
                    configuredServiceCount === 1
                      ? t('onboarding.serviceKeySingular')
                      : t('onboarding.serviceKeyPlural'),
                })
              : t('onboarding.doneConfiguredNoServices', { provider: configuredProviderName })
            : t('onboarding.doneSkippedProvider')}
        </Text>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Globe size={18} color={colors.primary} />
            <Text style={styles.summaryTitle}>{t('onboarding.summaryChatProvider')}</Text>
            <Text style={styles.summaryText}>
              {configuredProviderName || t('onboarding.notConfiguredYet')}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Search size={18} color={colors.primary} />
            <Text style={styles.summaryTitle}>{t('onboarding.summaryWebSearch')}</Text>
            <Text style={styles.summaryText}>
              {webProviderOptions.find((option: { value: string }) => option.value === webSearchProvider)
                ?.title || t('onboarding.webProviders.auto.title')}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Wrench size={18} color={colors.primary} />
            <Text style={styles.summaryTitle}>{t('onboarding.summaryExtraServiceKeys')}</Text>
            <Text style={styles.summaryText}>{configuredServiceCount}</Text>
          </View>
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>{t('onboarding.quickTips')}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipSlashCommands')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipLongPress')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipModelSelector')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipMcpServers')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.settingsKeysTip')}`}</Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleFinish}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.startChatting')}
        >
          <Text style={styles.primaryBtnText}>{t('onboarding.startChatting')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
