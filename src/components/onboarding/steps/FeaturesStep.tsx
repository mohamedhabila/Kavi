import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import {
  Brain,
  CalendarClock,
  FilePlus2,
  MessageCircleQuestion,
  Search,
  ShieldCheck,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';

export function FeaturesStep() {
  const { colors, configuredProviderName, currentProgressIndex, progress, setStep, styles, t } =
    useOnboardingWizardContext();
  const features = [
    {
      icon: <MessageCircleQuestion size={20} color={colors.primary} />,
      title: t('onboarding.outcomeAskTitle'),
      desc: t('onboarding.outcomeAskDescription'),
    },
    {
      icon: <Search size={20} color={colors.primary} />,
      title: t('onboarding.outcomeResearchTitle'),
      desc: t('onboarding.outcomeResearchDescription'),
    },
    {
      icon: <CalendarClock size={20} color={colors.primary} />,
      title: t('onboarding.outcomePlanTitle'),
      desc: t('onboarding.outcomePlanDescription'),
    },
    {
      icon: <Brain size={20} color={colors.primary} />,
      title: t('onboarding.outcomeRememberTitle'),
      desc: t('onboarding.outcomeRememberDescription'),
    },
    {
      icon: <FilePlus2 size={20} color={colors.primary} />,
      title: t('onboarding.outcomeCreateTitle'),
      desc: t('onboarding.outcomeCreateDescription'),
    },
    {
      icon: <ShieldCheck size={20} color={colors.primary} />,
      title: t('onboarding.outcomeActSafelyTitle'),
      desc: t('onboarding.outcomeActSafelyDescription'),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.progressRow, { paddingHorizontal: 24, paddingTop: 16 }]}>
        {progress.map((label: string, index: number) => (
          <View
            key={label}
            style={[
              styles.progressPill,
              index <= currentProgressIndex && styles.progressPillActive,
            ]}
          >
            <Text
              style={[
                styles.progressPillText,
                index <= currentProgressIndex && styles.progressPillTextActive,
              ]}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.stepTitle}>{t('onboarding.exploreTitle')}</Text>
        <Text style={[styles.subtitle, { textAlign: 'left', marginBottom: 16 }]}>
          {t('onboarding.exploreHint')}
        </Text>

        {features.map((feature, index) => (
          <View key={index} style={styles.featureDiscoveryCard}>
            <View style={styles.featureDiscoveryIcon}>{feature.icon}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureDiscoveryTitle}>{feature.title}</Text>
              <Text style={styles.featureDiscoveryDesc}>{feature.desc}</Text>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }]}
          onPress={() => setStep('done')}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.continueToFinish')}
        >
          <Text style={styles.primaryBtnText}>{t('onboarding.next')}</Text>
        </TouchableOpacity>
        {!configuredProviderName ? (
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => setStep('provider')}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={styles.skipBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
