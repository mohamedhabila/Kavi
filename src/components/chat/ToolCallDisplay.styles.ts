import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';

export const createToolCallDisplayStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.toolCard,
      borderRadius: 8,
      marginVertical: 4,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
      gap: 8,
      backgroundColor: colors.toolCardHeader,
    },
    headerTextBlock: {
      flex: 1,
      gap: 2,
    },
    toolName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    summaryText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    waitingBanner: {
      marginTop: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 7,
      backgroundColor: colors.codeBackground,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 2,
    },
    waitingTitle: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.text,
    },
    waitingDetail: {
      fontSize: 10,
      color: colors.textSecondary,
    },
    liveDetailText: {
      marginTop: 4,
      fontSize: 10,
      color: colors.textSecondary,
    },
    viewFileBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
      backgroundColor: colors.primarySoft,
    },
    viewFileBtnText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.primary,
    },
    statusText: {
      fontSize: 11,
      color: colors.textTertiary,
      textTransform: 'capitalize',
    },
    body: {
      padding: 10,
      gap: 6,
    },
    pollCard: {
      paddingHorizontal: 10,
      paddingBottom: 10,
      gap: 8,
    },
    pollQuestion: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      paddingTop: 2,
    },
    pollOption: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: colors.codeBackground,
    },
    pollOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.toolCardHeader,
    },
    pollOptionLabel: {
      color: colors.text,
      fontSize: 12,
      flex: 1,
      paddingRight: 12,
    },
    pollOptionVotes: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0,
    },
    codeBlock: {
      backgroundColor: colors.codeBackground,
      borderRadius: 6,
      padding: 8,
    },
    codeText: {
      fontSize: 12,
      fontFamily: 'monospace',
      color: colors.textSecondary,
      lineHeight: 17,
    },
  });

export type ToolCallDisplayStyles = ReturnType<typeof createToolCallDisplayStyles>;
