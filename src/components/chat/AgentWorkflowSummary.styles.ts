import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';

export const createAgentWorkflowSummaryStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      maxWidth: '96%',
      minWidth: '72%',
      marginBottom: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    currentRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surfaceAlt,
    },
    statusDot: {
      width: 9,
      height: 9,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    statusDotSettled: {
      backgroundColor: colors.textTertiary,
    },
    currentCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    eyebrow: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    currentTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
    },
    currentDetail: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    statusPill: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: colors.primarySoft,
    },
    statusPillText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '700',
    },
    section: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.subtleBorder,
    },
    sectionToggle: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    sectionTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    sectionMeta: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    details: {
      paddingHorizontal: 12,
      paddingBottom: 10,
      gap: 8,
    },
    goalRow: {
      gap: 2,
    },
    goalTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '500',
    },
    goalMeta: {
      color: colors.textSecondary,
      fontSize: 11,
    },
    traceIteration: {
      gap: 4,
    },
    traceIterationTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    traceEventRow: {
      gap: 1,
      paddingLeft: 8,
    },
    traceEventType: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '500',
    },
    traceEventDetail: {
      color: colors.textSecondary,
      fontSize: 11,
    },
  });

export type AgentWorkflowSummaryStyles = ReturnType<typeof createAgentWorkflowSummaryStyles>;
