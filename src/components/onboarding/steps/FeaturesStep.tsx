import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { FolderOpen, Globe, Monitor, Server, Terminal, Wrench } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboardingWizardContext } from '../OnboardingWizardContext';

export function FeaturesStep() {
  const { colors, currentProgressIndex, progress, setStep, styles, t } =
    useOnboardingWizardContext();
  const features = [
    {
      icon: <Terminal size={20} color={colors.primary} />,
      title: t('onboarding.featureJavaScriptTerminalTitle'),
      desc: t('onboarding.featureJavaScriptTerminalDescription'),
    },
    {
      icon: <FolderOpen size={20} color={colors.primary} />,
      title: t('onboarding.featureFileWorkspaceTitle'),
      desc: t('onboarding.featureFileWorkspaceDescription'),
    },
    {
      icon: <Monitor size={20} color={colors.primary} />,
      title: t('onboarding.featureRemoteWorkTitle'),
      desc: t('onboarding.featureRemoteWorkDescription'),
    },
    {
      icon: <Server size={20} color={colors.primary} />,
      title: t('onboarding.featureMcpServersTitle'),
      desc: t('onboarding.featureMcpServersDescription'),
    },
    {
      icon: <Wrench size={20} color={colors.primary} />,
      title: t('onboarding.featureBuiltInToolsTitle'),
      desc: t('onboarding.featureBuiltInToolsDescription'),
    },
    {
      icon: <Globe size={20} color={colors.primary} />,
      title: t('onboarding.featurePersonasTitle'),
      desc: t('onboarding.featurePersonasDescription'),
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
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => setStep('tools')}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={styles.skipBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
