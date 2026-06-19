import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Globe, Monitor } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';
import type { ProviderGuide } from '../onboardingGuides';

export function ProviderStep() {
  const { colors, handleSelectGuide, onComplete, progressHeader, providerGuides, styles, t } =
    useOnboardingWizardContext();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {progressHeader}
        <Text style={styles.stepTitle}>{t('onboarding.chooseMainProviderTitle')}</Text>
        <Text style={styles.stepSubtitle}>{t('onboarding.chooseMainProviderHint')}</Text>

        <View style={styles.providerGrid}>
          {providerGuides.map((guide: ProviderGuide) => (
            <TouchableOpacity
              key={guide.id}
              style={styles.providerCard}
              onPress={() => handleSelectGuide(guide)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.selectProvider', { name: guide.title })}
            >
              {guide.id === 'gemma-local' ? (
                <Monitor size={24} color={colors.primary} />
              ) : (
                <Globe size={24} color={colors.primary} />
              )}
              <Text style={styles.providerName}>{guide.title}</Text>
              <Text style={styles.providerBadge}>
                {guide.id === 'gemma-local'
                  ? t('onboarding.providerBadgeOnDevice')
                  : guide.requiresKey
                    ? t('onboarding.providerBadgeKey')
                    : t('onboarding.providerBadgeLocal')}
              </Text>
              <Text style={styles.providerSummary}>{guide.summary}</Text>
              <View style={styles.guideFooter}>
                <Text style={styles.providerModel}>{guide.freeAccess}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={onComplete}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skip')}
        >
          <Text style={styles.skipBtnText}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
