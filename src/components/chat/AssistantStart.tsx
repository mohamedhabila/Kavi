import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  History,
  MessageCircleQuestion,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';

import { useTranslation } from '../../i18n/useTranslation';
import { type AppPalette, useAppTheme } from '../../theme/useAppTheme';

type RecentConversation = {
  id: string;
  title: string;
};

type AssistantStartProps = {
  hasProviderReady: boolean;
  onOpenProviderSetup: () => void;
  onResumeConversation: (conversationId: string) => void;
  onSelectStarter: (prompt: string) => void;
  providerName?: string;
  recentConversation?: RecentConversation;
};

type Starter = {
  Icon: LucideIcon;
  promptKey: string;
  titleKey: string;
};

const STARTERS: Starter[] = [
  {
    Icon: MessageCircleQuestion,
    titleKey: 'onboarding.outcomeAskTitle',
    promptKey: 'chat.starterAskPrompt',
  },
  {
    Icon: Search,
    titleKey: 'onboarding.outcomeResearchTitle',
    promptKey: 'chat.starterResearchPrompt',
  },
  {
    Icon: CalendarClock,
    titleKey: 'onboarding.outcomePlanTitle',
    promptKey: 'chat.starterPlanPrompt',
  },
  {
    Icon: Brain,
    titleKey: 'onboarding.outcomeRememberTitle',
    promptKey: 'chat.starterRememberPrompt',
  },
  {
    Icon: FilePlus2,
    titleKey: 'onboarding.outcomeCreateTitle',
    promptKey: 'chat.starterCreatePrompt',
  },
  {
    Icon: ShieldCheck,
    titleKey: 'onboarding.outcomeActSafelyTitle',
    promptKey: 'chat.starterActPrompt',
  },
];

export function AssistantStart({
  hasProviderReady,
  onOpenProviderSetup,
  onResumeConversation,
  onSelectStarter,
  providerName,
  recentConversation,
}: AssistantStartProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container} testID="assistant-start">
      <View style={styles.heroIcon}>
        <Sparkles size={24} color={colors.primary} />
      </View>
      <Text style={styles.title}>{t('chat.assistantStartTitle')}</Text>
      <Text style={styles.hint}>{t('chat.assistantStartHint')}</Text>

      {!hasProviderReady ? (
        <View style={styles.setupCard} testID="assistant-start-provider-setup">
          <Text style={styles.setupTitle}>{t('chat.providerSetupTitle')}</Text>
          <Text style={styles.setupHint}>{t('chat.providerSetupHint')}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onOpenProviderSetup}
            accessibilityRole="button"
            accessibilityLabel={t('chat.providerSetupAction')}
          >
            <Text style={styles.primaryButtonText}>{t('chat.providerSetupAction')}</Text>
            <ChevronRight size={18} color={colors.onPrimary} />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {providerName ? (
            <View style={styles.readyRow}>
              <CheckCircle2 size={16} color={colors.success} />
              <Text style={styles.readyText}>
                {t('chat.providerConfigured', { provider: providerName })}
              </Text>
            </View>
          ) : null}
          <View style={styles.starterList}>
            {STARTERS.map(({ Icon, promptKey, titleKey }) => {
              const title = t(titleKey);
              return (
                <TouchableOpacity
                  key={titleKey}
                  style={styles.starterButton}
                  onPress={() => onSelectStarter(t(promptKey))}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  accessibilityHint={t('chat.starterAccessibilityHint')}
                >
                  <View style={styles.starterIcon}>
                    <Icon size={19} color={colors.primary} />
                  </View>
                  <Text style={styles.starterText}>{title}</Text>
                  <ChevronRight size={17} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {recentConversation ? (
        <TouchableOpacity
          style={styles.recentButton}
          onPress={() => onResumeConversation(recentConversation.id)}
          accessibilityRole="button"
          accessibilityLabel={t('chat.continueRecentAccessibility', {
            title: recentConversation.title,
          })}
          testID="assistant-start-recent"
        >
          <History size={19} color={colors.textSecondary} />
          <View style={styles.recentTextBlock}>
            <Text style={styles.recentLabel}>{t('chat.continueRecent')}</Text>
            <Text style={styles.recentTitle} numberOfLines={2}>
              {recentConversation.title}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 24,
    },
    heroIcon: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 16,
      backgroundColor: colors.primarySoft,
      marginBottom: 12,
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '800',
      textAlign: 'center',
    },
    hint: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 18,
    },
    setupCard: {
      width: '100%',
      padding: 18,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: 8,
    },
    setupTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    setupHint: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 6,
    },
    primaryButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    primaryButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    readyRow: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      marginBottom: 10,
    },
    readyText: {
      flexShrink: 1,
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    starterList: {
      width: '100%',
      gap: 8,
    },
    starterButton: {
      width: '100%',
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    starterIcon: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: colors.primarySoft,
    },
    starterText: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    recentButton: {
      width: '100%',
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
    },
    recentTextBlock: {
      flex: 1,
      gap: 2,
    },
    recentLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    recentTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
  });
