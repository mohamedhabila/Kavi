import { ChevronRight, Clock3, Mic } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsNotificationsVoiceSectionProps = {
  colors: AppPalette;
  onOpenScheduler: () => void;
  onOpenVoice: () => void;
  styles: StyleMap;
  t: TranslationFn;
};

export const SettingsNotificationsVoiceSection: React.FC<
  SettingsNotificationsVoiceSectionProps
> = ({ colors, onOpenScheduler, onOpenVoice, styles, t }) => (
  <View style={styles.sectionCard} testID="settings-notifications-voice">
    <View style={styles.sectionCardHeader}>
      <Text style={styles.sectionCardTitle}>
        {t('settings.destinations.notificationsVoice.title')}
      </Text>
      <Text style={styles.sectionCardHint}>
        {t('settings.destinations.notificationsVoice.hint')}
      </Text>
    </View>

    <TouchableOpacity
      accessibilityHint={t('settings.notificationsVoice.voiceHint')}
      accessibilityLabel={t('nav.voice')}
      accessibilityRole="button"
      onPress={onOpenVoice}
      style={styles.featureRow}
      testID="settings-open-voice"
    >
      <Mic size={19} color={colors.primary} />
      <View style={styles.featureContent}>
        <Text style={styles.switchLabel}>{t('nav.voice')}</Text>
        <Text style={styles.featureHint}>{t('settings.notificationsVoice.voiceHint')}</Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} />
    </TouchableOpacity>

    <TouchableOpacity
      accessibilityHint={t('settings.notificationsVoice.automationHint')}
      accessibilityLabel={t('scheduler.title')}
      accessibilityRole="button"
      onPress={onOpenScheduler}
      style={styles.featureRow}
      testID="settings-open-scheduler"
    >
      <Clock3 size={19} color={colors.primary} />
      <View style={styles.featureContent}>
        <Text style={styles.switchLabel}>{t('scheduler.title')}</Text>
        <Text style={styles.featureHint}>{t('settings.notificationsVoice.automationHint')}</Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  </View>
);
