import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';

const ONBOARDING_BRAND_ICON = require('../../../../assets/icon.png');

export function WelcomeStep() {
  const { colors, onComplete, setStep, styles, t } = useOnboardingWizardContext();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        <View style={styles.logoBadge}>
          <Image
            source={ONBOARDING_BRAND_ICON}
            style={styles.logoImage}
            resizeMode="cover"
            accessibilityLabel={t('onboarding.appIconAccessibility')}
          />
        </View>
        <Text style={styles.title}>{t('onboarding.welcome')}</Text>
        <Text style={styles.subtitle}>{t('onboarding.welcomeHint')}</Text>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>{t('onboarding.heroTitle')}</Text>
          <Text style={styles.heroText}>{t('onboarding.heroStep1')}</Text>
          <Text style={styles.heroText}>{t('onboarding.heroStep2')}</Text>
          <Text style={styles.heroText}>{t('onboarding.heroStep3')}</Text>
        </View>

        <View style={styles.featureList}>
          {[
            t('onboarding.featureChat'),
            t('onboarding.featureWebSearch'),
            t('onboarding.featureMemory'),
            t('onboarding.featureMcp'),
            t('onboarding.featureCalendar'),
            t('onboarding.featureAutomation'),
            t('onboarding.featureSkills'),
          ].map((feature: string, idx: number) => (
            <View key={idx} style={styles.featureItem}>
              <Check size={16} color={colors.success} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => setStep('provider')}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.getStarted')}
        >
          <Text style={styles.primaryBtnText}>{t('onboarding.getStarted')}</Text>
          <ChevronRight size={18} color={colors.onPrimary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={onComplete}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skip')}
        >
          <Text style={styles.skipBtnText}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
