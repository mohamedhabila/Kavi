import {
  Bell,
  Bot,
  Brain,
  BrainCircuit,
  ChevronRight,
  Languages,
  MonitorCog,
  Search,
  Server,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { SettingsDestination } from './settingsDestination';

type TranslationFn = (key: string, params?: any) => string;

type SettingsHomeProps = {
  assistantStylesCount: number;
  blockedToolsCount: number;
  colors: AppPalette;
  connectionsCount: number;
  localeLabel: string;
  memoryEnabled: boolean;
  onOpenDestination: (destination: SettingsDestination) => void;
  onOpenDeveloperWork: () => void;
  providersCount: number;
  remoteTargetsCount: number;
  t: TranslationFn;
  themeLabel: string;
};

type HomeItem = {
  badge: string;
  description: string;
  destination?: SettingsDestination;
  icon: LucideIcon;
  id: string;
  onPress?: () => void;
  title: string;
};

const normalizeSearchValue = (value: string): string => value.trim().toLocaleLowerCase();

export const SettingsHome: React.FC<SettingsHomeProps> = ({
  assistantStylesCount,
  blockedToolsCount,
  colors,
  connectionsCount,
  localeLabel,
  memoryEnabled,
  onOpenDestination,
  onOpenDeveloperWork,
  providersCount,
  remoteTargetsCount,
  t,
  themeLabel,
}) => {
  const [query, setQuery] = useState('');
  const styles = useMemo(() => createStyles(colors), [colors]);

  const sections = useMemo<Array<{ id: string; title: string; items: HomeItem[] }>>(
    () => [
      {
        id: 'everyday',
        title: t('settings.home.everydayTitle'),
        items: [
          {
            id: 'assistant-personalization',
            title: t('settings.destinations.assistantPersonalization.title'),
            description: t('settings.destinations.assistantPersonalization.hint'),
            badge: t('settings.home.stylesCount', { count: String(assistantStylesCount) }),
            destination: 'assistant-personalization',
            icon: Bot,
          },
          {
            id: 'memory-privacy',
            title: t('settings.destinations.memoryPrivacy.title'),
            description: t('settings.destinations.memoryPrivacy.hint'),
            badge: memoryEnabled ? t('common.on') : t('common.off'),
            destination: 'memory-privacy',
            icon: Brain,
          },
          {
            id: 'tools-permissions',
            title: t('settings.destinations.toolsPermissions.title'),
            description: t('settings.destinations.toolsPermissions.hint'),
            badge:
              blockedToolsCount > 0
                ? t('settings.home.blockedCount', { count: String(blockedToolsCount) })
                : t('settings.home.ready'),
            destination: 'tools-permissions',
            icon: Wrench,
          },
          {
            id: 'connections',
            title: t('settings.destinations.connections.title'),
            description: t('settings.destinations.connections.hint'),
            badge:
              connectionsCount > 0
                ? t('settings.home.configuredCount', { count: String(connectionsCount) })
                : t('settings.needsSetup'),
            destination: 'connections',
            icon: Server,
          },
          {
            id: 'notifications-voice',
            title: t('settings.destinations.notificationsVoice.title'),
            description: t('settings.destinations.notificationsVoice.hint'),
            badge: t('settings.home.deviceServices'),
            destination: 'notifications-voice',
            icon: Bell,
          },
          {
            id: 'appearance-language',
            title: t('settings.destinations.appearanceLanguage.title'),
            description: t('settings.destinations.appearanceLanguage.hint'),
            badge: t('settings.home.appearanceSummary', {
              language: localeLabel,
              theme: themeLabel,
            }),
            destination: 'appearance-language',
            icon: Languages,
          },
        ],
      },
      {
        id: 'advanced',
        title: t('settings.home.advancedTitle'),
        items: [
          {
            id: 'advanced-ai',
            title: t('settings.destinations.advancedAI.title'),
            description: t('settings.destinations.advancedAI.hint'),
            badge:
              providersCount > 0
                ? t('settings.home.configuredCount', { count: String(providersCount) })
                : t('settings.needsSetup'),
            destination: 'advanced-ai',
            icon: BrainCircuit,
          },
          {
            id: 'developer-remote-work',
            title: t('nav.developerAndRemoteWork'),
            description: t('settings.home.developerRemoteHint'),
            badge:
              remoteTargetsCount > 0
                ? t('settings.home.configuredCount', { count: String(remoteTargetsCount) })
                : t('settings.home.optional'),
            onPress: onOpenDeveloperWork,
            icon: MonitorCog,
          },
        ],
      },
    ],
    [
      assistantStylesCount,
      blockedToolsCount,
      connectionsCount,
      localeLabel,
      memoryEnabled,
      onOpenDeveloperWork,
      providersCount,
      remoteTargetsCount,
      t,
      themeLabel,
    ],
  );

  const normalizedQuery = normalizeSearchValue(query);
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: normalizedQuery
        ? section.items.filter((item) =>
            normalizeSearchValue(`${item.title} ${item.description} ${item.badge}`).includes(
              normalizedQuery,
            ),
          )
        : section.items,
    }))
    .filter((section) => section.items.length > 0);

  return (
    <View testID="settings-home">
      <Text style={styles.intro}>{t('settings.home.intro')}</Text>
      <View style={styles.searchWrap}>
        <Search size={19} color={colors.textTertiary} />
        <TextInput
          accessibilityLabel={t('settings.home.searchLabel')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder={t('settings.home.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          style={styles.searchInput}
          testID="settings-home-search"
          value={query}
        />
        {query ? (
          <TouchableOpacity
            accessibilityLabel={t('settings.home.clearSearch')}
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={styles.clearButton}
            testID="settings-home-clear-search"
          >
            <X size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {visibleSections.map((section) => (
        <View key={section.id} style={styles.section} testID={`settings-home-${section.id}`}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.card}>
            {section.items.map((item, index) => {
              const Icon = item.icon;
              return (
                <TouchableOpacity
                  key={item.id}
                  accessibilityHint={item.description}
                  accessibilityLabel={`${item.title}, ${item.badge}`}
                  accessibilityRole="button"
                  onPress={
                    item.onPress || (() => item.destination && onOpenDestination(item.destination))
                  }
                  style={[styles.row, index > 0 ? styles.rowBorder : null]}
                  testID={`settings-home-${item.id}`}
                >
                  <View style={styles.iconWrap}>
                    <Icon size={20} color={colors.primary} />
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <View style={styles.badge}>
                        <Text numberOfLines={1} style={styles.badgeText}>
                          {item.badge}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rowDescription}>{item.description}</Text>
                  </View>
                  <ChevronRight size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {visibleSections.length === 0 ? (
        <View accessibilityRole="summary" style={styles.empty} testID="settings-home-empty">
          <Text style={styles.emptyTitle}>{t('settings.home.noResultsTitle')}</Text>
          <Text style={styles.emptyHint}>{t('settings.home.noResultsHint')}</Text>
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    intro: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 16,
    },
    searchWrap: {
      minHeight: 48,
      paddingLeft: 14,
      paddingRight: 4,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 14,
      backgroundColor: colors.inputBackground,
      marginBottom: 22,
    },
    searchInput: {
      flex: 1,
      minHeight: 46,
      paddingHorizontal: 10,
      color: colors.text,
      fontSize: 16,
    },
    clearButton: {
      width: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    section: {
      marginBottom: 22,
    },
    sectionTitle: {
      paddingHorizontal: 4,
      marginBottom: 8,
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    row: {
      minHeight: 76,
      paddingHorizontal: 12,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    rowTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rowTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 20,
    },
    rowDescription: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 3,
    },
    badge: {
      maxWidth: '48%',
      minHeight: 24,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    badgeText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    empty: {
      paddingHorizontal: 20,
      paddingVertical: 28,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    emptyHint: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
      textAlign: 'center',
    },
  });
