import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Globe, Zap } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';

export function DoneStep() {
  const {
    colors,
    configuredProviderName,
    configuredServiceCount,
    handleFinish,
    setStep,
    styles,
    t,
  } = useOnboardingWizardContext();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.centered} showsVerticalScrollIndicator={false}>
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
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>{t('onboarding.quickTips')}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipAskNaturally')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipAttachSomething')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipReviewActions')}`}</Text>
        </View>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => setStep('tools')}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.optionalToolsAction')}
        >
          <Text style={styles.secondaryBtnText}>{t('onboarding.optionalToolsAction')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleFinish}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.startChatting')}
        >
          <Text style={styles.primaryBtnText}>{t('onboarding.startChatting')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
