import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Check,
  MessageCircle,
  Sparkles,
} from 'lucide-react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModelSelector } from '../components/chat/ModelSelector';
import { PersonaSelector } from '../components/chat/PersonaSelector';
import { ChatScreenTelemetryPanel } from './chatScreen/ChatScreenTelemetryPanel';
import { createStyles as createChatStyles } from './ChatScreen.styles';
import { resolveConversationModel } from '../services/llm/support/providerSupport';
import { resolveConversationPersonaForMode } from '../engine/graph/conversation/modeTransitions';
import { useBackToChat } from '../navigation/useBackToChat';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTranslation } from '../i18n/useTranslation';
import { type AppPalette, useAppTheme } from '../theme/useAppTheme';
import type { ConversationMode } from '../types/conversation';

type ConversationSettingsRouteParams = {
  ConversationSettings: {
    conversationId?: string;
    returnTo?: { name: string; params?: Record<string, unknown> };
    showUsage?: boolean;
  };
};

type BehaviorChoiceProps = {
  colors: AppPalette;
  description: string;
  disabled: boolean;
  Icon: typeof Sparkles;
  label: string;
  mode: ConversationMode;
  onSelect: (mode: ConversationMode) => void;
  selected: boolean;
  styles: ReturnType<typeof createStyles>;
  testID: string;
};

function BehaviorChoice({
  description,
  colors,
  disabled,
  Icon,
  label,
  mode,
  onSelect,
  selected,
  styles,
  testID,
}: BehaviorChoiceProps) {
  return (
    <TouchableOpacity
      accessibilityHint={description}
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => onSelect(mode)}
      style={[
        styles.choice,
        selected ? styles.choiceSelected : null,
        disabled ? styles.controlDisabled : null,
      ]}
      testID={testID}
    >
      <View style={[styles.choiceIcon, selected ? styles.choiceIconSelected : null]}>
        <Icon size={20} color={selected ? colors.primary : colors.textSecondary} />
      </View>
      <View style={styles.choiceTextBlock}>
        <Text style={[styles.choiceTitle, selected ? styles.choiceTitleSelected : null]}>
          {label}
        </Text>
        <Text style={styles.choiceDescription}>{description}</Text>
      </View>
      <View style={[styles.radio, selected ? styles.radioSelected : null]}>
        {selected ? <Check size={14} color={colors.onPrimary} /> : null}
      </View>
    </TouchableOpacity>
  );
}

export const ConversationSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ConversationSettingsRouteParams, 'ConversationSettings'>>();
  const backToChat = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const chatStyles = useMemo(() => createChatStyles(colors), [colors]);
  const [showUsageDetails, setShowUsageDetails] = useState(route.params?.showUsage === true);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (route.params?.showUsage === true) {
      setShowUsageDetails(true);
    }
  }, [route.params?.showUsage]);

  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const isLoading = useChatStore((state) => state.isLoading);
  const updateModeInConversation = useChatStore((state) => state.updateModeInConversation);
  const updateModelInConversation = useChatStore((state) => state.updateModelInConversation);
  const updatePersonaInConversation = useChatStore((state) => state.updatePersonaInConversation);

  const providers = useSettingsStore((state) => state.providers);
  const activeModel = useSettingsStore((state) => state.activeModel);
  const activeProviderId = useSettingsStore((state) => state.activeProviderId);
  const defaultConversationMode = useSettingsStore((state) => state.defaultConversationMode);
  const setActiveProviderAndModel = useSettingsStore((state) => state.setActiveProviderAndModel);
  const setLastUsedModel = useSettingsStore((state) => state.setLastUsedModel);

  const conversationId = route.params?.conversationId ?? activeConversationId;
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  const mode = conversation?.mode ?? defaultConversationMode ?? 'agentic';
  const provider = providers.find(
    (candidate) => candidate.id === (conversation?.providerId || activeProviderId),
  );
  const currentModel = resolveConversationModel(provider, {
    conversationModel: conversation?.modelOverride,
    activeModel,
    activeProviderId,
  });

  const handleSelectMode = useCallback(
    (nextMode: ConversationMode) => {
      if (!conversation || isLoading || nextMode === mode) {
        return;
      }

      const nextPersonaId = resolveConversationPersonaForMode({
        conversationPersonaId: conversation.personaId,
        nextMode,
      });
      updateModeInConversation(conversation.id, nextMode);
      updatePersonaInConversation(conversation.id, nextPersonaId);
    },
    [conversation, isLoading, mode, updateModeInConversation, updatePersonaInConversation],
  );

  const handlePersonaSelect = useCallback(
    (personaId: string) => {
      if (!conversation || isLoading) {
        return;
      }
      updatePersonaInConversation(conversation.id, personaId);
    },
    [conversation, isLoading, updatePersonaInConversation],
  );

  const handleModelSelect = useCallback(
    (providerId: string, modelId: string) => {
      if (!conversation || isLoading) {
        return;
      }
      setActiveProviderAndModel(providerId, modelId);
      updateModelInConversation(conversation.id, providerId, modelId);
      setLastUsedModel(providerId, modelId);
    },
    [
      conversation,
      isLoading,
      setActiveProviderAndModel,
      setLastUsedModel,
      updateModelInConversation,
    ],
  );

  if (!conversation) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
            onPress={backToChat}
            style={styles.headerButton}
          >
            <ChevronLeft size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('chat.conversationSettings')}</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.emptyState} testID="conversation-settings-unavailable">
          <Text style={styles.emptyTitle}>{t('chat.conversationUnavailableTitle')}</Text>
          <Text style={styles.emptyHint}>{t('chat.conversationUnavailableHint')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          onPress={backToChat}
          style={styles.headerButton}
          testID="conversation-settings-back"
        >
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('chat.conversationSettings')}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="conversation-settings-scroll"
      >
        <Text style={styles.conversationTitle} numberOfLines={2}>
          {conversation.title}
        </Text>

        {isLoading ? (
          <View style={styles.busyNotice}>
            <Text style={styles.busyNoticeText}>{t('chat.settingsLockedWhileWorking')}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('chat.assistantBehavior')}</Text>
          <Text style={styles.sectionHint}>{t('chat.assistantBehaviorHint')}</Text>
          <View
            accessibilityLabel={t('chat.assistantBehavior')}
            accessibilityRole="radiogroup"
            style={styles.choiceGroup}
          >
            <BehaviorChoice
              colors={colors}
              description={t('chat.automaticModeDescription')}
              disabled={isLoading}
              Icon={Sparkles}
              label={t('chat.automaticMode')}
              mode="agentic"
              onSelect={handleSelectMode}
              selected={mode === 'agentic'}
              styles={styles}
              testID="conversation-mode-automatic"
            />
            <BehaviorChoice
              colors={colors}
              description={t('chat.answerOnlyModeDescription')}
              disabled={isLoading}
              Icon={MessageCircle}
              label={t('chat.answerOnlyMode')}
              mode="chitchat"
              onSelect={handleSelectMode}
              selected={mode === 'chitchat'}
              styles={styles}
              testID="conversation-mode-answer-only"
            />
          </View>
        </View>

        {mode === 'chitchat' ? (
          <View style={styles.section} testID="conversation-style-section">
            <Text style={styles.sectionTitle}>{t('chat.assistantStyle')}</Text>
            <Text style={styles.sectionHint}>{t('chat.assistantStyleHint')}</Text>
            <PersonaSelector
              disabled={isLoading}
              onSelect={handlePersonaSelect}
              selectedPersonaId={conversation.personaId || 'default'}
              variant="full"
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('chat.advancedAiModel')}</Text>
          <Text style={styles.sectionHint}>{t('chat.advancedAiModelHint')}</Text>
          <ModelSelector
            disabled={isLoading}
            onSelect={handleModelSelect}
            selectedModel={currentModel || null}
            selectedProviderId={provider?.id ?? activeProviderId ?? null}
            variant="full"
          />
          <TouchableOpacity
            accessibilityLabel={t('nav.advancedAI')}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Settings', {
                destination: 'advanced-ai',
                returnTo: {
                  name: 'ConversationSettings',
                  params: {
                    ...route.params,
                    conversationId: conversation.id,
                  },
                },
              })
            }
            style={styles.advancedSettingsLink}
            testID="conversation-open-advanced-ai"
          >
            <Text style={styles.advancedSettingsLinkText}>{t('nav.advancedAI')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('chat.usageActivity')}</Text>
          <Text style={styles.sectionHint}>{t('chat.usageActivityHint')}</Text>
          <TouchableOpacity
            accessibilityLabel={
              showUsageDetails ? t('chat.hideUsageDetails') : t('chat.showUsageDetails')
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: showUsageDetails }}
            onPress={() => {
              if (showUsageDetails) {
                setShowLogs(false);
              }
              setShowUsageDetails(!showUsageDetails);
            }}
            style={styles.usageToggle}
            testID="conversation-usage-toggle"
          >
            <View style={styles.usageToggleIcon}>
              <BarChart3 size={20} color={colors.primary} />
            </View>
            <Text style={styles.usageToggleText}>
              {showUsageDetails ? t('chat.hideUsageDetails') : t('chat.showUsageDetails')}
            </Text>
            {showUsageDetails ? (
              <ChevronUp size={19} color={colors.textSecondary} />
            ) : (
              <ChevronDown size={19} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
          {showUsageDetails ? (
            <View style={styles.usageDetails} testID="conversation-usage-details">
              <ChatScreenTelemetryPanel
                activeConversation={conversation}
                colors={colors}
                embedded
                onToggleLogs={() => setShowLogs((current) => !current)}
                showLogs={showLogs}
                styles={chatStyles}
                t={t}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    headerButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 24,
    },
    headerTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
    content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 16, paddingBottom: 40 },
    conversationTitle: {
      marginBottom: 18,
      color: colors.text,
      fontSize: 22,
      fontWeight: '800',
    },
    busyNotice: {
      marginBottom: 16,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.primarySoft,
    },
    busyNoticeText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    section: { marginBottom: 26 },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    sectionHint: {
      marginTop: 4,
      marginBottom: 12,
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    choiceGroup: { gap: 8 },
    choice: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    choiceIcon: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    choiceIconSelected: { backgroundColor: colors.surface },
    choiceTextBlock: { flex: 1, minWidth: 0 },
    choiceTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    choiceTitleSelected: { color: colors.primary },
    choiceDescription: {
      marginTop: 3,
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    radio: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
    },
    radioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
    controlDisabled: { opacity: 0.5 },
    advancedSettingsLink: {
      minHeight: 48,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      marginTop: 6,
      paddingHorizontal: 4,
    },
    advancedSettingsLinkText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
    usageToggle: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    usageToggleIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 11,
      backgroundColor: colors.primarySoft,
    },
    usageToggleText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
    usageDetails: { marginTop: 10 },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    emptyHint: {
      marginTop: 8,
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
  });
