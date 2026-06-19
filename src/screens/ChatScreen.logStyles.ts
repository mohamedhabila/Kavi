import type { AppPalette } from '../theme/useAppTheme';
import { MAX_LOG_PANEL_HEIGHT } from './chatScreenConstants';

export const createChatLogStyles = (colors: AppPalette) => ({
  logsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logsToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  logsToggleBadge: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
  },
  logsToggleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  logsPanel: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logsScroll: {
    maxHeight: MAX_LOG_PANEL_HEIGHT,
  },
  logsScrollContent: {
    paddingBottom: 4,
  },
  logsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  logsCount: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  logEntry: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  logKindBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  logKindText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  logTimestamp: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  logTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  logDetail: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  logsEmpty: {
    fontSize: 12,
    color: colors.textSecondary,
  },
} as const);
