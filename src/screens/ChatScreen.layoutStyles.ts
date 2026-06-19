import { StyleSheet } from 'react-native';
import type { AppPalette } from '../theme/useAppTheme';

export const createChatLayoutStyles = (colors: AppPalette) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  localModelInitOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  localModelInitCard: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  localModelInitTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  localModelInitBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
} as const);
