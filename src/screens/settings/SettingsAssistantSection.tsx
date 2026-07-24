import React from 'react';
import { Text, View } from 'react-native';

import type { Locale } from '../../i18n/types';
import type { AppPalette, ThemePreference } from '../../theme/useAppTheme';
import { SettingsAppearanceControls } from './SettingsAppearanceControls';
import { SettingsAssistantBehaviorControls } from './SettingsAssistantBehaviorControls';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type ThinkingOption = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type SettingsAssistantSectionProps = {
  colors: AppPalette;
  defaultConversationMode: 'agentic' | 'chitchat';
  handleLocaleChange: (locale: Locale) => void | Promise<void>;
  linkUnderstandingEnabled: boolean;
  locale: Locale;
  localeDisplayNames: Record<string, string>;
  maxLinks: number;
  mediaUnderstandingEnabled: boolean;
  mode?: 'all' | 'assistant' | 'appearance';
  onLayout: (event: any) => void;
  setDefaultConversationMode: (value: 'agentic' | 'chitchat') => void;
  setLinkUnderstandingEnabled: (value: boolean) => void;
  setMaxLinks: (value: number) => void;
  setMediaUnderstandingEnabled: (value: boolean) => void;
  setShowLanguagePicker: (value: boolean) => void;
  setSystemPrompt: (value: string) => void;
  setTheme: (value: ThemePreference) => void;
  setThinkingLevel: (value: ThinkingOption) => void;
  showLanguagePicker: boolean;
  styles: StyleMap;
  supportedLocales: readonly Locale[];
  systemPrompt: string;
  t: TranslationFn;
  theme: ThemePreference;
  thinkingLevel: ThinkingOption;
  thinkingLevelOptions: Array<{ value: ThinkingOption; label: string; hint: string }>;
};

export const SettingsAssistantSection: React.FC<SettingsAssistantSectionProps> = ({
  colors,
  defaultConversationMode,
  handleLocaleChange,
  linkUnderstandingEnabled,
  locale,
  localeDisplayNames,
  maxLinks,
  mediaUnderstandingEnabled,
  mode = 'all',
  onLayout,
  setDefaultConversationMode,
  setLinkUnderstandingEnabled,
  setMaxLinks,
  setMediaUnderstandingEnabled,
  setShowLanguagePicker,
  setSystemPrompt,
  setTheme,
  setThinkingLevel,
  showLanguagePicker,
  styles,
  supportedLocales,
  systemPrompt,
  t,
  theme,
  thinkingLevel,
  thinkingLevelOptions,
}) => {
  const titleKey =
    mode === 'assistant'
      ? 'settings.destinations.assistantPersonalization.title'
      : mode === 'appearance'
        ? 'settings.destinations.appearanceLanguage.title'
        : 'settings.mainSections.assistant.title';
  const hintKey =
    mode === 'assistant'
      ? 'settings.destinations.assistantPersonalization.hint'
      : mode === 'appearance'
        ? 'settings.destinations.appearanceLanguage.hint'
        : 'settings.mainSections.assistant.hint';

  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>{t(titleKey)}</Text>
        <Text style={styles.sectionCardHint}>{t(hintKey)}</Text>
      </View>

      {mode !== 'assistant' ? (
        <SettingsAppearanceControls
          colors={colors}
          handleLocaleChange={handleLocaleChange}
          locale={locale}
          localeDisplayNames={localeDisplayNames}
          setShowLanguagePicker={setShowLanguagePicker}
          setTheme={setTheme}
          showLanguagePicker={showLanguagePicker}
          styles={styles}
          supportedLocales={supportedLocales}
          t={t}
          theme={theme}
        />
      ) : null}

      {mode !== 'appearance' ? (
        <SettingsAssistantBehaviorControls
          colors={colors}
          defaultConversationMode={defaultConversationMode}
          linkUnderstandingEnabled={linkUnderstandingEnabled}
          maxLinks={maxLinks}
          mediaUnderstandingEnabled={mediaUnderstandingEnabled}
          setDefaultConversationMode={setDefaultConversationMode}
          setLinkUnderstandingEnabled={setLinkUnderstandingEnabled}
          setMaxLinks={setMaxLinks}
          setMediaUnderstandingEnabled={setMediaUnderstandingEnabled}
          setSystemPrompt={setSystemPrompt}
          setThinkingLevel={setThinkingLevel}
          styles={styles}
          systemPrompt={systemPrompt}
          t={t}
          thinkingLevel={thinkingLevel}
          thinkingLevelOptions={thinkingLevelOptions}
        />
      ) : null}
    </View>
  );
};
