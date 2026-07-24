import { Check, ChevronRight, Languages, Monitor, Moon, Sun } from 'lucide-react-native';
import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';

import type { Locale } from '../../i18n/types';
import type { AppPalette, ThemePreference } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsAppearanceControlsProps = {
  colors: AppPalette;
  handleLocaleChange: (locale: Locale) => void | Promise<void>;
  locale: Locale;
  localeDisplayNames: Record<string, string>;
  setShowLanguagePicker: (value: boolean) => void;
  setTheme: (value: ThemePreference) => void;
  showLanguagePicker: boolean;
  styles: StyleMap;
  supportedLocales: readonly Locale[];
  t: TranslationFn;
  theme: ThemePreference;
};

export const SettingsAppearanceControls: React.FC<SettingsAppearanceControlsProps> = ({
  colors,
  handleLocaleChange,
  locale,
  localeDisplayNames,
  setShowLanguagePicker,
  setTheme,
  showLanguagePicker,
  styles,
  supportedLocales,
  t,
  theme,
}) => {
  const ThemeButton: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: ThemePreference;
  }> = ({ icon, label, value }) => (
    <TouchableOpacity
      accessibilityLabel={t('settings.useTheme', { name: label })}
      accessibilityRole="button"
      accessibilityState={{ selected: theme === value }}
      onPress={() => setTheme(value)}
      style={[styles.themeBtn, theme === value && styles.themeBtnActive]}
    >
      {icon}
      <Text style={[styles.themeBtnText, theme === value && styles.themeBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Text style={styles.sectionTitle}>{t('settings.appearance')}</Text>
      <View style={styles.themeRow}>
        <ThemeButton
          icon={<Sun size={18} color={theme === 'light' ? colors.primary : colors.textSecondary} />}
          label={t('settings.light')}
          value="light"
        />
        <ThemeButton
          icon={<Moon size={18} color={theme === 'dark' ? colors.primary : colors.textSecondary} />}
          label={t('settings.dark')}
          value="dark"
        />
        <ThemeButton
          icon={
            <Monitor size={18} color={theme === 'system' ? colors.primary : colors.textSecondary} />
          }
          label={t('settings.system')}
          value="system"
        />
      </View>

      <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
      <TouchableOpacity
        accessibilityLabel={t('settings.language')}
        accessibilityRole="button"
        onPress={() => setShowLanguagePicker(true)}
        style={styles.listItem}
      >
        <Languages size={18} color={colors.primary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{localeDisplayNames[locale]}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.languageHint')}</Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      <Modal
        animationType="slide"
        onRequestClose={() => setShowLanguagePicker(false)}
        transparent
        visible={showLanguagePicker}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('settings.language')}</Text>
            {supportedLocales.map((supportedLocale) => (
              <TouchableOpacity
                accessibilityLabel={localeDisplayNames[supportedLocale]}
                accessibilityRole="button"
                key={supportedLocale}
                onPress={() => void handleLocaleChange(supportedLocale)}
                style={styles.langItem}
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
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              onPress={() => setShowLanguagePicker(false)}
              style={styles.modalCloseBtn}
            >
              <Text style={styles.modalCloseBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};
