import type { AppPalette } from '../theme/useAppTheme';

export const createChatHeaderStyles = (colors: AppPalette) => ({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.header,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minWidth: 0,
  },
  headerMenuButton: {
    flexShrink: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
  },
  modeBadgeAgentic: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  modeBadgeDirect: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modeBadgeTextAgentic: {
    color: colors.primary,
  },
  modeBadgeTextDirect: {
    color: colors.textSecondary,
  },
  headerPersonaSelector: {
    flexShrink: 0,
  },
  headerModelSelector: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
  },
  headerRuntimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  headerRuntimeBadgeGpu: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  headerRuntimeBadgeCpu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  headerRuntimeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    flexShrink: 1,
  },
  headerRuntimeBadgeTextGpu: {
    color: colors.primary,
  },
  headerRuntimeBadgeTextCpu: {
    color: colors.textSecondary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  headerActionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
} as const);
