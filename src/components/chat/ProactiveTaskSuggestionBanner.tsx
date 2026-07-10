import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowRight, Sparkles, X } from 'lucide-react-native';
import type { Conversation } from '../../types/conversation';
import {
  isStoreHydrated,
  subscribeToStoreHydration,
  type PersistHydratableStore,
} from '../../store/persistHydration';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { useProactiveProposalStore } from '../../services/agents/proactiveProposalStore';
import { selectProactiveTaskProposal } from '../../services/agents/proactiveTaskProposal';

export interface ProactiveTaskSuggestionBannerProps {
  conversation?: Conversation;
  disabled?: boolean;
  enabled: boolean;
  now?: () => number;
  onContinue: () => void;
}

function useProposalStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(() =>
    isStoreHydrated(useProactiveProposalStore as PersistHydratableStore),
  );

  useEffect(() => {
    if (hydrated) {
      return;
    }
    const refresh = () => {
      if (isStoreHydrated(useProactiveProposalStore as PersistHydratableStore)) {
        setHydrated(true);
      }
    };
    const unsubscribe = subscribeToStoreHydration(
      useProactiveProposalStore as PersistHydratableStore,
      refresh,
    );
    refresh();
    return unsubscribe;
  }, [hydrated]);

  return hydrated;
}

export const ProactiveTaskSuggestionBanner: React.FC<ProactiveTaskSuggestionBannerProps> = ({
  conversation,
  disabled = false,
  enabled,
  now = Date.now,
  onContinue,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hydrated = useProposalStoreHydration();
  const receipts = useProactiveProposalStore((state) => state.receipts);
  const presentedThisSession = useProactiveProposalStore((state) => state.presentedThisSession);
  const markPresented = useProactiveProposalStore((state) => state.markPresented);
  const accept = useProactiveProposalStore((state) => state.accept);
  const dismiss = useProactiveProposalStore((state) => state.dismiss);
  const currentTime = now();
  const proposal = useMemo(
    () =>
      hydrated && enabled
        ? selectProactiveTaskProposal({
            conversation,
            now: currentTime,
            presentedThisSession,
            receipts,
          })
        : undefined,
    [conversation, currentTime, enabled, hydrated, presentedThisSession, receipts],
  );

  useEffect(() => {
    if (proposal) {
      markPresented(proposal, currentTime);
    }
  }, [currentTime, markPresented, proposal]);

  if (!proposal) {
    return null;
  }

  const handleContinue = () => {
    if (disabled) {
      return;
    }
    accept(proposal, now());
    onContinue();
  };

  return (
    <View
      style={styles.container}
      accessibilityLiveRegion="polite"
      testID="proactive-task-suggestion"
    >
      <View style={styles.iconContainer}>
        <Sparkles size={16} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{t('chat.proactiveTaskSuggestionTitle')}</Text>
        <Text style={styles.body}>{t('chat.proactiveTaskSuggestionBody')}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('chat.proactiveTaskSuggestionDismiss')}
            onPress={() => dismiss(proposal, now())}
            style={styles.dismissButton}
            testID="proactive-task-suggestion-dismiss"
          >
            <X size={14} color={colors.textSecondary} />
            <Text style={styles.dismissText}>{t('chat.proactiveTaskSuggestionDismiss')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('chat.proactiveTaskSuggestionContinue')}
            disabled={disabled}
            onPress={handleContinue}
            style={[styles.continueButton, disabled ? styles.continueButtonDisabled : null]}
            testID="proactive-task-suggestion-continue"
          >
            <Text style={styles.continueText}>{t('chat.proactiveTaskSuggestionContinue')}</Text>
            <ArrowRight size={14} color={colors.onPrimary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

function createStyles(colors: AppPalette) {
  return StyleSheet.create({
    container: {
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      marginHorizontal: 12,
      marginVertical: 6,
      padding: 12,
    },
    iconContainer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 16,
      height: 30,
      justifyContent: 'center',
      width: 30,
    },
    copy: { flex: 1, gap: 4 },
    title: { color: colors.text, fontSize: 13, fontWeight: '700' },
    body: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-end',
      marginTop: 6,
    },
    dismissButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    dismissText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    continueButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    continueButtonDisabled: { opacity: 0.45 },
    continueText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  });
}
