import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';

export function createLocalModelDownloadPanelStyles(colors: AppPalette) {
  return StyleSheet.create({
    card: {
      borderRadius: 14,
      borderWidth: 1,
      padding: 14,
      marginTop: 16,
      gap: 10,
    },
    cardWarning: {
      borderColor: colors.warning,
      backgroundColor: colors.warningBackground,
    },
    cardReady: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    cardError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerBody: {
      flex: 1,
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    body: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    metrics: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    metricText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    button: {
      minHeight: 44,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonReady: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    buttonReadyText: {
      color: colors.primary,
    },
    recoveryActions: {
      gap: 8,
    },
    recoveryButton: {
      minHeight: 40,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surface,
    },
    recoveryButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
  });
}
