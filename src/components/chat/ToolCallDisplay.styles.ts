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
      backgroundColor: colors.toolCardHeader,
    },
    disclosureButton: {
      minWidth: 0,
      minHeight: 48,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 8,
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
    disclosureStatus: {
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4,
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
    waitingDetail: {
      fontSize: 10,
      color: colors.textSecondary,
    },
    liveDetailText: {
      marginTop: 4,
      fontSize: 10,
      color: colors.textSecondary,
    },
    viewResultBtn: {
      minWidth: 64,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      alignSelf: 'stretch',
      paddingHorizontal: 10,
      borderLeftWidth: 1,
      borderLeftColor: colors.border,
      backgroundColor: colors.primarySoft,
    },
    viewResultBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    statusText: {
      flexShrink: 1,
      fontSize: 11,
      color: colors.textTertiary,
    },
    body: {
      padding: 10,
      gap: 10,
    },
    outcomeCard: {
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 8,
      borderWidth: 1,
      gap: 3,
    },
    outcomeCardDanger: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
    },
    outcomeCardWarning: {
      backgroundColor: colors.warningBackground,
      borderColor: colors.warning,
    },
    outcomeTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    outcomeDetail: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    resultSection: {
      gap: 6,
    },
    technicalDisclosure: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    technicalTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    technicalDetails: {
      gap: 10,
    },
    detailSection: {
      gap: 6,
    },
    privacyNotice: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
    },
    detailNotice: {
      color: colors.textTertiary,
      fontSize: 11,
      lineHeight: 15,
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
