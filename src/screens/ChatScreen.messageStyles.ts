import { StyleSheet } from 'react-native';
import type { AppPalette } from '../theme/useAppTheme';

export const createChatMessageStyles = (colors: AppPalette) => ({
  messageList: {
    paddingVertical: 8,
    paddingBottom: 16,
  },
  messageListEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  historyWindowHeader: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  historyWindowButton: {
    minHeight: 34,
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  historyWindowButtonText: {
    maxWidth: '100%',
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  temporalMarkerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginVertical: 12,
    gap: 8,
  },
  temporalMarkerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.subtleBorder ?? colors.border,
  },
  temporalMarkerText: {
    fontSize: 11,
    color: colors.textTertiary ?? colors.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
} as const);
