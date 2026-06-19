import {
  Brain,
  Check,
  ChevronRight,
  Image,
  Languages,
  Link2,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react-native';
import React from 'react';
import { Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { Locale } from '../../i18n/types';
import type { AppPalette, ThemePreference } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type ThinkingOption = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type SettingsAssistantSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  onLayout: (event: any) => void;
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
  locale: Locale;
  localeDisplayNames: Record<string, string>;
  supportedLocales: readonly Locale[];
  showLanguagePicker: boolean;
  setShowLanguagePicker: (value: boolean) => void;
  handleLocaleChange: (locale: Locale) => void | Promise<void>;
  linkUnderstandingEnabled: boolean;
  setLinkUnderstandingEnabled: (value: boolean) => void;
  maxLinks: number;
  setMaxLinks: (value: number) => void;
  mediaUnderstandingEnabled: boolean;
  setMediaUnderstandingEnabled: (value: boolean) => void;
  defaultConversationMode: 'agentic' | 'chitchat';
  setDefaultConversationMode: (value: 'agentic' | 'chitchat') => void;
  thinkingLevel: ThinkingOption;
  thinkingLevelOptions: Array<{ value: ThinkingOption; label: string; hint: string }>;
  setThinkingLevel: (value: ThinkingOption) => void;
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
};

export const SettingsAssistantSection: React.FC<SettingsAssistantSectionProps> = ({
  colors,
  styles,
  t,
  onLayout,
  theme,
  setTheme,
  locale,
  localeDisplayNames,
  supportedLocales,
  showLanguagePicker,
  setShowLanguagePicker,
  handleLocaleChange,
  linkUnderstandingEnabled,
  setLinkUnderstandingEnabled,
  maxLinks,
  setMaxLinks,
  mediaUnderstandingEnabled,
  setMediaUnderstandingEnabled,
  defaultConversationMode,
  setDefaultConversationMode,
  thinkingLevel,
  thinkingLevelOptions,
  setThinkingLevel,
  systemPrompt,
  setSystemPrompt,
}) => {
  const ThemeButton: React.FC<{
    value: ThemePreference;
    label: string;
    icon: React.ReactNode;
  }> = ({ value, label, icon }) => (
    <TouchableOpacity
      style={[styles.themeBtn, theme === value && styles.themeBtnActive]}
      onPress={() => setTheme(value)}
      accessibilityRole="button"
      accessibilityLabel={t('settings.useTheme', { name: label })}
      accessibilityState={{ selected: theme === value }}
    >
      {icon}
      <Text style={[styles.themeBtnText, theme === value && styles.themeBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>{t('settings.mainSections.assistant.title')}</Text>
        <Text style={styles.sectionCardHint}>{t('settings.mainSections.assistant.hint')}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t('settings.appearance')}</Text>
      <View style={styles.themeRow}>
        <ThemeButton
          value="light"
          label={t('settings.light')}
          icon={<Sun size={18} color={theme === 'light' ? colors.primary : colors.textSecondary} />}
        />
        <ThemeButton
          value="dark"
          label={t('settings.dark')}
          icon={<Moon size={18} color={theme === 'dark' ? colors.primary : colors.textSecondary} />}
        />
        <ThemeButton
          value="system"
          label={t('settings.system')}
          icon={
            <Monitor size={18} color={theme === 'system' ? colors.primary : colors.textSecondary} />
          }
        />
      </View>

      <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
      <TouchableOpacity
        style={styles.listItem}
        onPress={() => setShowLanguagePicker(true)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.language')}
      >
        <Languages size={18} color={colors.primary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{localeDisplayNames[locale]}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.languageHint')}</Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      <Modal
        visible={showLanguagePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLanguagePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('settings.language')}</Text>
            {supportedLocales.map((supportedLocale) => (
              <TouchableOpacity
                key={supportedLocale}
                style={styles.langItem}
                onPress={() => void handleLocaleChange(supportedLocale)}
                accessibilityRole="button"
                accessibilityLabel={localeDisplayNames[supportedLocale]}
              >
                <Text
                  style={[
                    styles.langItemText,
                    locale === supportedLocale && { color: colors.primary, fontWeight: '700' },
                  ]}
                >
                  {localeDisplayNames[supportedLocale]}
                </Text>
                {locale === supportedLocale ? <Check size={18} color={colors.primary} /> : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowLanguagePicker(false)}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.modalCloseBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Text style={styles.sectionTitle}>{t('settings.features')}</Text>

      <View style={styles.featureRow}>
        <Link2 size={18} color={colors.primary} />
        <View style={styles.featureContent}>
          <Text style={styles.switchLabel}>{t('settings.linkUnderstanding')}</Text>
          <Text style={styles.featureHint}>{t('settings.linkUnderstandingHint')}</Text>
        </View>
        <Switch
          value={linkUnderstandingEnabled}
          onValueChange={setLinkUnderstandingEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {linkUnderstandingEnabled ? (
        <View style={styles.featureSubRow}>
          <Text style={styles.featureSubLabel}>{t('settings.maxLinks')}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setMaxLinks(maxLinks - 1)}
              disabled={maxLinks <= 1}
              accessibilityRole="button"
              accessibilityLabel={t('common.remove')}
            >
              <Text style={styles.stepperBtnText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{maxLinks}</Text>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setMaxLinks(maxLinks + 1)}
              disabled={maxLinks >= 10}
              accessibilityRole="button"
              accessibilityLabel={t('common.add')}
            >
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.featureRow}>
        <Image size={18} color={colors.primary} />
        <View style={styles.featureContent}>
          <Text style={styles.switchLabel}>{t('settings.mediaUnderstanding')}</Text>
          <Text style={styles.featureHint}>{t('settings.mediaUnderstandingHint')}</Text>
        </View>
        <Switch
          value={mediaUnderstandingEnabled}
          onValueChange={setMediaUnderstandingEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <Text style={styles.sectionTitle}>{t('settings.defaultConversationMode')}</Text>
      <View style={styles.listItem}>
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{t('settings.defaultConversationModeSummary')}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.defaultConversationModeHint')}</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
        <TouchableOpacity
          style={[
            styles.presetChip,
            defaultConversationMode === 'agentic' && styles.presetChipActive,
          ]}
          onPress={() => setDefaultConversationMode('agentic')}
          accessibilityRole="button"
          accessibilityLabel={t('settings.defaultConversationModeAgenticAccessibility')}
          accessibilityState={{ selected: defaultConversationMode === 'agentic' }}
        >
          <Text
            style={[
              styles.presetChipText,
              defaultConversationMode === 'agentic' && styles.presetChipTextActive,
            ]}
          >
            {t('settings.defaultConversationModeAgentic')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.presetChip,
            defaultConversationMode === 'chitchat' && styles.presetChipActive,
          ]}
          onPress={() => setDefaultConversationMode('chitchat')}
          accessibilityRole="button"
          accessibilityLabel={t('settings.defaultConversationModeChitchatAccessibility')}
          accessibilityState={{ selected: defaultConversationMode === 'chitchat' }}
        >
          <Text
            style={[
              styles.presetChipText,
              defaultConversationMode === 'chitchat' && styles.presetChipTextActive,
            ]}
          >
            {t('settings.defaultConversationModeChitchat')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Text style={styles.sectionTitle}>{t('settings.reasoningTitle')}</Text>
      <View style={styles.listItem}>
        <Brain size={18} color={colors.primary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{t('settings.thinkingLevelTitle')}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.thinkingLevelHint')}</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
        {thinkingLevelOptions.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.presetChip, thinkingLevel === option.value && styles.presetChipActive]}
            onPress={() => setThinkingLevel(option.value)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.useThinkingLevel', { name: option.label })}
            accessibilityState={{ selected: thinkingLevel === option.value }}
          >
            <Brain
              size={14}
              color={thinkingLevel === option.value ? colors.onPrimary : colors.primary}
            />
            <Text
              style={[
                styles.presetChipText,
                thinkingLevel === option.value && styles.presetChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.listItemSubtitle}>
        {thinkingLevelOptions.find((option) => option.value === thinkingLevel)?.hint}
      </Text>

      <Text style={styles.sectionTitle}>{t('settings.systemPrompt')}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={systemPrompt}
        onChangeText={setSystemPrompt}
        placeholder={t('settings.systemPromptPlaceholder')}
        placeholderTextColor={colors.placeholder}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />
    </View>
  );
};
