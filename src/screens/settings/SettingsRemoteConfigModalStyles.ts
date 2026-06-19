import { StyleSheet } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { ConfigEditorModalShellStyles } from '../components/ConfigEditorModal';

type RemoteConfigEditorStyleMap = Record<string, any>;

export function createSettingsRemoteConfigModalStyles(colors: AppPalette): {
  editorStyles: RemoteConfigEditorStyleMap;
  shellStyles: ConfigEditorModalShellStyles;
} {
  const shellStyles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    titleWrap: {
      flex: 1,
      gap: 4,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    body: {
      flex: 1,
    },
  });

  const editorStyles = StyleSheet.create({
    workspaceEditorContent: {
      padding: 16,
      paddingBottom: 24,
      gap: 16,
    },
    workspaceEditorSectionCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: 16,
      gap: 12,
    },
    workspaceEditorSectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    detailLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    detailValue: {
      fontSize: 13,
      color: colors.text,
      flexShrink: 1,
    },
    configInput: {
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 14,
    },
    configTextArea: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
    optionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    horizontalChipRow: {
      gap: 8,
      paddingRight: 4,
    },
    optionChip: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    optionChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    optionChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    optionChipTextActive: {
      color: colors.primary,
    },
    formHint: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    formGrid: {
      gap: 12,
    },
    formGridWide: {
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    formGridItem: {
      flex: 1,
      gap: 12,
    },
    formGridPortItem: {
      maxWidth: 120,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingTop: 4,
    },
    switchLabelWrap: {
      flex: 1,
      gap: 3,
    },
    switchTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    switchHint: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    configActionRow: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
      paddingTop: 4,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    primaryBtnText: {
      color: colors.onPrimary,
      fontWeight: '700',
      fontSize: 13,
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: colors.surfaceAlt,
    },
    secondaryBtnText: {
      color: colors.primary,
      fontWeight: '600',
      fontSize: 13,
    },
    destructiveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    destructiveBtnText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 13,
    },
  });

  return { editorStyles, shellStyles };
}
