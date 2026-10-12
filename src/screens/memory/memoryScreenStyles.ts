import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';

export type MemoryScreenStyles = ReturnType<typeof createMemoryScreenStyles>;

export function createMemoryScreenStyles(colors: AppPalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, flex: 1 },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
    },
    toolbar: { paddingHorizontal: 16, gap: 8 },
    search: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 44,
      paddingHorizontal: 14,
    },
    statusLine: { fontSize: 12, color: colors.textTertiary },
    notice: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
    listContent: { padding: 16, paddingBottom: 32 },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      paddingTop: 24,
      textAlign: 'center',
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 8,
      marginBottom: 10,
      padding: 14,
    },
    cardText: { color: colors.text, fontSize: 15, lineHeight: 21 },
    cardMeta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    cardDate: { color: colors.textTertiary, fontSize: 12 },
    badge: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
    cardActions: { flexDirection: 'row', gap: 4, marginLeft: -8 },
    cardAction: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 8,
    },
    cardActionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    dangerText: { color: colors.danger },
  });
}
