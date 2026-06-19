import type { AppPalette } from '../theme/useAppTheme';

export const createChatTelemetryStyles = (colors: AppPalette) => ({
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.danger,
  },
  telemetryCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  telemetryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  telemetryMetric: {
    flex: 1,
  },
  telemetryLabel: {
    fontSize: 11,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  telemetryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  telemetryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  telemetryMeta: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
} as const);
