import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';

export const createSettingsScreenBaseStyleFragments = (colors: AppPalette) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  saveBtn: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  saveBtnDisabled: {
    color: colors.textTertiary,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  overviewCard: {
    marginTop: 4,
  },
  sectionCardHeader: {
    marginBottom: 8,
  },
  sectionCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCardHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 4,
  },
  sectionChipScroller: {
    marginBottom: 16,
  },
  sectionChipRow: {
    paddingRight: 8,
  },
  sectionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  sectionChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  sectionChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sectionChipTextActive: {
    color: colors.primary,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  apiKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eyeBtn: {
    padding: 8,
  },
  localProviderNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  localProviderNoticeBody: {
    flex: 1,
    gap: 4,
  },
  localProviderNoticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  localProviderNoticeText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  localModelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  localModelMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  switchLabel: {
    fontSize: 15,
    color: colors.text,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  themeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  themeBtnText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  themeBtnTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  presetRow: {
    marginBottom: 12,
    maxHeight: 40,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    marginRight: 8,
  },
  presetChipActive: {
    backgroundColor: colors.primary,
  },
  presetChipText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  presetChipTextActive: {
    color: colors.onPrimary,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  listItemSubtitle: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
});
