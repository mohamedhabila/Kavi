import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight, Menu, Sparkles, type LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

export type NavigationHubItem = {
  id: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  badge?: string;
  onPress: () => void;
};

export type NavigationHubSection = {
  id: string;
  title?: string;
  items: NavigationHubItem[];
};

type NavigationHubScreenProps = {
  title: string;
  intro: string;
  sections: NavigationHubSection[];
  testID: string;
};

export const NavigationHubScreen: React.FC<NavigationHubScreenProps> = ({
  title,
  intro,
  sections,
  testID,
}) => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID={testID}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('chat.openMenu')}
          accessibilityRole="button"
          onPress={() => navigation.openDrawer()}
          style={styles.headerButton}
          testID={`${testID}-open-menu`}
        >
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity
          accessibilityLabel={t('nav.assistant')}
          accessibilityRole="button"
          onPress={() => navigation.navigate('Chat')}
          style={styles.headerButton}
          testID={`${testID}-open-assistant`}
        >
          <Sparkles size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>{intro}</Text>

        {sections.map((section) => (
          <View key={section.id} style={styles.section} testID={`${testID}-${section.id}`}>
            {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
            <View style={styles.card}>
              {section.items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.id}
                    accessibilityHint={item.description}
                    accessibilityLabel={item.title}
                    accessibilityRole="button"
                    onPress={item.onPress}
                    style={[styles.row, index > 0 ? styles.rowBorder : null]}
                    testID={`${testID}-${item.id}`}
                  >
                    <View style={styles.iconWrap}>
                      <Icon size={20} color={colors.primary} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      {item.description ? (
                        <Text style={styles.rowDescription}>{item.description}</Text>
                      ) : null}
                    </View>
                    {item.badge ? (
                      <View style={styles.badge} accessibilityElementsHidden>
                        <Text style={styles.badgeText}>{item.badge}</Text>
                      </View>
                    ) : null}
                    <ChevronRight size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      minHeight: 56,
      paddingHorizontal: 8,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    headerButton: {
      width: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      lineHeight: 24,
      textAlign: 'center',
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 32,
    },
    intro: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 20,
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    row: {
      minHeight: 64,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
      lineHeight: 21,
    },
    rowDescription: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    badge: {
      minWidth: 24,
      minHeight: 24,
      paddingHorizontal: 7,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.primarySoft,
    },
    badgeText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
    },
  });
