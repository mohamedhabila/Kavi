// ---------------------------------------------------------------------------
// Kavi — Developer Mode Locked State
// ---------------------------------------------------------------------------
// Shown in place of a developer-only screen (Terminal, Code Editor, Remote
// Work, Gateway, the Developer & remote work hub) when the user navigates to
// it directly while Developer Mode is off. The screen stays registered in
// the navigator — only its content is swapped — so a deep link or a stale
// notification still resolves to a coherent, actionable screen instead of a
// blank or broken one.

import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { RouteLeadingButton } from '../../components/navigation/RouteLeadingButton';

type DeveloperModeLockedStateProps = {
  /** i18n key for the screen's own title, shown in the header. */
  titleKey: string;
  testID: string;
};

export const DeveloperModeLockedState: React.FC<DeveloperModeLockedStateProps> = ({
  titleKey,
  testID,
}) => {
  const navigation = useNavigation<any>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID={testID}>
      <View style={styles.header}>
        <RouteLeadingButton style={styles.headerButton} testID={`${testID}-leading`} />
        <Text style={styles.headerTitle}>{t(titleKey)}</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Lock size={28} color={colors.textSecondary} />
        </View>
        <Text style={styles.title}>{t('developerMode.lockedTitle')}</Text>
        <Text style={styles.message}>{t('developerMode.lockedMessage')}</Text>
        <TouchableOpacity
          accessibilityLabel={t('developerMode.openSettingsAccessibility')}
          accessibilityRole="button"
          onPress={() =>
            navigation.navigate('Settings', { destination: 'developer-remote-work' })
          }
          style={styles.button}
          testID={`${testID}-open-settings`}
        >
          <Text style={styles.buttonText}>{t('developerMode.openSettings')}</Text>
        </TouchableOpacity>
      </View>
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
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      marginBottom: 16,
    },
    title: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 8,
    },
    message: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: 24,
    },
    button: {
      minHeight: 44,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
