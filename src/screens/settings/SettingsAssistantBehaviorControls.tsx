import { Brain, Image, Link2 } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type ThinkingOption = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type SettingsAssistantBehaviorControlsProps = {
  colors: AppPalette;
  defaultConversationMode: 'agentic' | 'chitchat';
  linkUnderstandingEnabled: boolean;
  maxLinks: number;
  mediaUnderstandingEnabled: boolean;
  setDefaultConversationMode: (value: 'agentic' | 'chitchat') => void;
  setLinkUnderstandingEnabled: (value: boolean) => void;
  setMaxLinks: (value: number) => void;
  setMediaUnderstandingEnabled: (value: boolean) => void;
  setSystemPrompt: (value: string) => void;
  setThinkingLevel: (value: ThinkingOption) => void;
  styles: StyleMap;
  systemPrompt: string;
  t: TranslationFn;
  thinkingLevel: ThinkingOption;
  thinkingLevelOptions: Array<{ value: ThinkingOption; label: string; hint: string }>;
};

export const SettingsAssistantBehaviorControls: React.FC<
  SettingsAssistantBehaviorControlsProps
> = ({
  colors,
  defaultConversationMode,
  linkUnderstandingEnabled,
  maxLinks,
  mediaUnderstandingEnabled,
  setDefaultConversationMode,
  setLinkUnderstandingEnabled,
  setMaxLinks,
  setMediaUnderstandingEnabled,
  setSystemPrompt,
  setThinkingLevel,
  styles,
  systemPrompt,
  t,
  thinkingLevel,
  thinkingLevelOptions,
}) => (
  <>
    <Text style={styles.sectionTitle}>{t('settings.features')}</Text>

    <View style={styles.featureRow}>
      <Link2 size={18} color={colors.primary} />
      <View style={styles.featureContent}>
        <Text style={styles.switchLabel}>{t('settings.linkUnderstanding')}</Text>
        <Text style={styles.featureHint}>{t('settings.linkUnderstandingHint')}</Text>
      </View>
      <Switch
        onValueChange={setLinkUnderstandingEnabled}
        trackColor={{ true: colors.primary }}
        value={linkUnderstandingEnabled}
      />
    </View>

    {linkUnderstandingEnabled ? (
      <View style={styles.featureSubRow}>
        <Text style={styles.featureSubLabel}>{t('settings.maxLinks')}</Text>
        <View style={styles.stepperRow}>
          <TouchableOpacity
            accessibilityLabel={t('common.remove')}
            accessibilityRole="button"
            disabled={maxLinks <= 1}
            onPress={() => setMaxLinks(maxLinks - 1)}
            style={styles.stepperBtn}
          >
            <Text style={styles.stepperBtnText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.stepperValue}>{maxLinks}</Text>
          <TouchableOpacity
            accessibilityLabel={t('common.add')}
            accessibilityRole="button"
            disabled={maxLinks >= 10}
            onPress={() => setMaxLinks(maxLinks + 1)}
            style={styles.stepperBtn}
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
        onValueChange={setMediaUnderstandingEnabled}
        trackColor={{ true: colors.primary }}
        value={mediaUnderstandingEnabled}
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
        accessibilityLabel={t('settings.defaultConversationModeAgenticAccessibility')}
        accessibilityRole="button"
        accessibilityState={{ selected: defaultConversationMode === 'agentic' }}
        onPress={() => setDefaultConversationMode('agentic')}
        style={[
          styles.presetChip,
          defaultConversationMode === 'agentic' && styles.presetChipActive,
        ]}
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
        accessibilityLabel={t('settings.defaultConversationModeChitchatAccessibility')}
        accessibilityRole="button"
        accessibilityState={{ selected: defaultConversationMode === 'chitchat' }}
        onPress={() => setDefaultConversationMode('chitchat')}
        style={[
          styles.presetChip,
          defaultConversationMode === 'chitchat' && styles.presetChipActive,
        ]}
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
          accessibilityLabel={t('settings.useThinkingLevel', { name: option.label })}
          accessibilityRole="button"
          accessibilityState={{ selected: thinkingLevel === option.value }}
          key={option.value}
          onPress={() => setThinkingLevel(option.value)}
          style={[styles.presetChip, thinkingLevel === option.value && styles.presetChipActive]}
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
      multiline
      numberOfLines={4}
      onChangeText={setSystemPrompt}
      placeholder={t('settings.systemPromptPlaceholder')}
      placeholderTextColor={colors.placeholder}
      style={[styles.input, styles.textArea]}
      textAlignVertical="top"
      value={systemPrompt}
    />
  </>
);
