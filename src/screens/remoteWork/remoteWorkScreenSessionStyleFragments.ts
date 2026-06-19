import type { AppPalette } from '../../theme/useAppTheme';

export const createRemoteWorkScreenSessionStyleFragments = (colors: AppPalette) => ({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
    maxWidth: '45%',
  },
  badgeReady: {
    backgroundColor: colors.primarySoft,
  },
  badgeWarn: {
    backgroundColor: colors.surfaceAlt,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextReady: {
    color: colors.primary,
  },
  badgeTextWarn: {
    color: colors.textSecondary,
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
  probeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  probeText: {
    flex: 1,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
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
  disabledBtn: {
    opacity: 0.45,
  },
  workspaceEditorContent: {
    padding: 16,
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
  sessionContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sessionTitleWrap: {
    flex: 1,
    gap: 2,
  },
  sessionSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  sessionError: {
    color: colors.danger,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  disconnectText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  shellBody: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  shellStatus: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  shellTerminal: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sessionHint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  promptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  promptCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  promptTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  promptBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  promptInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.panel,
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  configDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
});
